//! Terminal intégré (spec terminal.md, décision 0006) : un shell dans un pseudo-terminal.
//!
//! `portable-pty` ouvre le pseudo-terminal et lance le shell en chef de session (`setsid`).
//! Sans `unsafe` (interdit dans le workspace), les signaux passent par `/bin/kill` et l'état
//! des processus par `/bin/ps`.

use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::{AppError, Result};

mod links;
mod quote;

pub use links::{FileLink, find_file_links};
pub use quote::shell_quote;

/// Commandes en cours des sessions (confirmation de fermeture de l'app) : le `running_command`
/// de chaque session qui en a un, dans l'ordre des sessions, sans doublon.
pub fn running_commands<'a>(
    sessions: impl IntoIterator<Item = &'a TerminalSession>,
) -> Vec<String> {
    let mut commands: Vec<String> = Vec::new();
    for command in sessions
        .into_iter()
        .filter_map(TerminalSession::running_command)
    {
        if !commands.contains(&command) {
            commands.push(command);
        }
    }
    commands
}

/// Délai entre le raccroché (`SIGHUP`) et l'arrêt forcé (`SIGKILL`).
const KILL_DELAY: Duration = Duration::from_secs(2);
/// Attente de la dernière sortie après la fin du shell, avant de signaler cette fin.
const LAST_OUTPUT_WAIT: Duration = Duration::from_millis(500);
/// Délai après un redimensionnement avant de vérifier que le shell ne l'a pas écrasé.
const RESIZE_SETTLE: Duration = Duration::from_millis(20);

/// Programme lancé dans le pseudo-terminal, avec ses arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellCommand {
    pub program: String,
    pub args: Vec<String>,
}

impl ShellCommand {
    /// Shell de connexion de l'utilisateur : `$SHELL` (sinon `/bin/zsh`), argument `-l`.
    pub fn login() -> Self {
        let program = std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "/bin/zsh".to_owned());
        Self {
            program,
            args: vec!["-l".to_owned()],
        }
    }
}

/// Taille du terminal en caractères.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
}

impl TerminalSize {
    fn to_pty(self) -> PtySize {
        PtySize {
            rows: self.rows.max(1),
            cols: self.cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

/// Paramètres d'une session.
#[derive(Debug, Clone)]
pub struct SessionOptions {
    /// Dossier de départ : doit exister et être un dossier.
    pub cwd: String,
    pub size: TerminalSize,
    /// `ShellCommand::login()` dans l'app ; un shell précis dans les tests.
    pub shell: ShellCommand,
}

/// Un shell vivant dans un pseudo-terminal. La lâcher (`drop`) la ferme comme `close`.
pub struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn Write + Send>>,
    /// Dernière taille demandée et son heure, tant qu'elle n'a pas été vérifiée (voir `resize`).
    pending_size: Mutex<Option<(TerminalSize, Instant)>>,
    /// Pid du shell : chef de session et de son propre groupe de processus.
    shell_pid: Option<u32>,
    /// Vrai une fois la session fermée par l'app : la fin du shell n'est plus signalée.
    closed: Arc<AtomicBool>,
    /// Vrai une fois le shell récolté : son pid peut alors être réutilisé, on ne le vise plus.
    exited: Arc<AtomicBool>,
}

impl TerminalSession {
    /// Lance le shell dans `options.cwd`, avec `TERM=xterm-256color`, `COLORTERM=truecolor`,
    /// `TERM_PROGRAM=explorateur`.
    ///
    /// - `on_output` reçoit les octets bruts de la sortie, sur un fil de fond.
    /// - `on_exit` est appelé une fois, avec le code de sortie, quand le shell se termine
    ///   de lui-même (après la dernière sortie).
    ///
    /// Erreurs : `NotFound(cwd)` si le dossier n'existe pas, `NotADirectory(cwd)` si c'est un
    /// fichier ; aucun processus n'est lancé.
    pub fn start(
        options: SessionOptions,
        mut on_output: impl FnMut(&[u8]) + Send + 'static,
        on_exit: impl FnOnce(u32) + Send + 'static,
    ) -> Result<Self> {
        let cwd = &options.cwd;
        let meta = std::fs::metadata(cwd).map_err(|err| AppError::from_io(&err, cwd))?;
        if !meta.is_dir() {
            return Err(AppError::NotADirectory(cwd.clone()));
        }

        let pair = native_pty_system()
            .openpty(options.size.to_pty())
            .map_err(pty_error)?;

        let mut cmd = CommandBuilder::new(&options.shell.program);
        cmd.args(&options.shell.args);
        cmd.cwd(Path::new(cwd));
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "explorateur");
        let mut child = pair.slave.spawn_command(cmd).map_err(pty_error)?;
        // Seul le shell garde le côté esclave : sa fin ferme la lecture (fin de fichier).
        drop(pair.slave);

        let shell_pid = child.process_id();
        let mut reader = pair.master.try_clone_reader().map_err(pty_error)?;
        let writer = pair.master.take_writer().map_err(pty_error)?;
        let closed = Arc::new(AtomicBool::new(false));

        // Fil de lecture : transmet la sortie jusqu'à la fin de fichier (ou EIO sur macOS).
        let (done_tx, done_rx) = mpsc::channel::<()>();
        thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => on_output(buf.get(..n).unwrap_or_default()),
                }
            }
            let _ = done_tx.send(());
        });

        // Fil d'attente : récolte le shell, puis signale sa fin après la dernière sortie.
        let exited = Arc::new(AtomicBool::new(false));
        let closed_wait = Arc::clone(&closed);
        let exited_wait = Arc::clone(&exited);
        thread::spawn(move || {
            let code = child.wait().map_or(1, |status| status.exit_code());
            exited_wait.store(true, Ordering::SeqCst);
            // Un processus de fond peut garder le terminal ouvert : attente bornée.
            let _ = done_rx.recv_timeout(LAST_OUTPUT_WAIT);
            if !closed_wait.load(Ordering::SeqCst) {
                on_exit(code);
            }
        });

        Ok(Self {
            master: pair.master,
            writer: Mutex::new(writer),
            pending_size: Mutex::new(None),
            shell_pid,
            closed,
            exited,
        })
    }

    /// Écrit `data` tel quel sur l'entrée du shell (rien n'est ajouté).
    pub fn write(&self, data: &[u8]) -> Result<()> {
        self.confirm_size()?;
        let mut writer = self.writer.lock().unwrap_or_else(PoisonError::into_inner);
        writer
            .write_all(data)
            .and_then(|()| writer.flush())
            .map_err(|err| AppError::Io(format!("terminal: {err}")))
    }

    /// Change la taille du pseudo-terminal ; le shell reçoit `SIGWINCH`.
    ///
    /// readline (bash) relit puis réécrit la taille à chaque prompt (`set_winsize`) : une
    /// taille changée entre ces deux appels est écrasée par l'ancienne. Elle est donc vérifiée,
    /// et réappliquée au besoin, avant la saisie suivante (`write`).
    pub fn resize(&self, size: TerminalSize) -> Result<()> {
        self.master.resize(size.to_pty()).map_err(pty_error)?;
        *self
            .pending_size
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some((size, Instant::now()));
        Ok(())
    }

    /// Réapplique la dernière taille demandée si le shell l'a écrasée. Attend d'abord
    /// `RESIZE_SETTLE` après le redimensionnement : l'écrasement suit de près le prompt.
    fn confirm_size(&self) -> Result<()> {
        let Some((size, at)) = self
            .pending_size
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
        else {
            return Ok(());
        };
        thread::sleep(RESIZE_SETTLE.saturating_sub(at.elapsed()));
        let wanted = size.to_pty();
        let current = self.master.get_size().map_err(pty_error)?;
        if (current.rows, current.cols) != (wanted.rows, wanted.cols) {
            self.master.resize(wanted).map_err(pty_error)?;
        }
        Ok(())
    }

    /// Processus en cours : nom court (sans chemin, ex. `sleep`) de la commande au premier plan
    /// si ce n'est pas le shell lui-même, sinon `None`.
    pub fn running_command(&self) -> Option<String> {
        let leader = u32::try_from(self.master.process_group_leader()?).ok()?;
        if Some(leader) == self.shell_pid {
            return None;
        }
        let out = Command::new("/bin/ps")
            .args(["-o", "comm=", "-p", &leader.to_string()])
            .output()
            .ok()?;
        let comm = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        let name = comm.rsplit('/').next().unwrap_or_default();
        // Un shell de connexion s'affiche `-zsh`.
        let name = name.trim_start_matches('-');
        (!name.is_empty()).then(|| name.to_owned())
    }

    /// Termine le groupe de processus de la session : signal de raccroché (`SIGHUP`), puis
    /// arrêt forcé (`SIGKILL`) après 2 s s'il reste des processus. Ne bloque pas l'appelant.
    pub fn close(self) {
        // Le travail est fait par `Drop`.
    }

    /// Groupes de processus de la session : celui du shell, celui du premier plan, et tous
    /// ceux attachés au terminal (tâches de fond).
    fn process_groups(&self) -> Vec<u32> {
        let mut groups: Vec<u32> = Vec::new();
        if !self.exited.load(Ordering::SeqCst) {
            groups.extend(self.shell_pid);
        }
        if let Some(leader) = self
            .master
            .process_group_leader()
            .and_then(|pid| u32::try_from(pid).ok())
        {
            groups.push(leader);
        }
        if let Some(tty) = self.master.tty_name() {
            let tty = tty.to_string_lossy();
            let tty = tty.trim_start_matches("/dev/");
            if let Ok(out) = Command::new("/bin/ps")
                .args(["-o", "pgid=", "-t", tty])
                .output()
            {
                groups.extend(
                    String::from_utf8_lossy(&out.stdout)
                        .split_whitespace()
                        .filter_map(|s| s.parse::<u32>().ok()),
                );
            }
        }
        // Jamais le groupe 0 ou 1 (« tous les processus » pour `kill`).
        groups.retain(|&g| g > 1);
        groups.sort_unstable();
        groups.dedup();
        groups
    }

    /// Marque la session fermée, envoie `SIGHUP` à ses groupes et les renvoie. Vide si la
    /// session était déjà fermée.
    fn hang_up(&self) -> Vec<u32> {
        if self.closed.swap(true, Ordering::SeqCst) {
            return Vec::new();
        }
        let groups = self.process_groups();
        signal_groups(&groups, "-HUP");
        groups
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        let groups = self.hang_up();
        if !groups.is_empty() {
            thread::spawn(move || finish_groups(&groups));
        }
    }
}

/// Ferme toutes les sessions et attend la fin de leurs processus (au plus 2 s, puis arrêt
/// forcé). Bloquant : pour la sortie de l'app, où un fil de fond n'aurait pas le temps de finir.
pub fn close_all(sessions: Vec<TerminalSession>) {
    let mut groups = Vec::new();
    for session in &sessions {
        groups.extend(session.hang_up());
    }
    // Déjà fermées : leur `Drop` ne fait plus que libérer le pseudo-terminal.
    drop(sessions);
    finish_groups(&groups);
}

/// Attend que les groupes disparaissent, au plus `KILL_DELAY`, puis force l'arrêt des restants.
fn finish_groups(groups: &[u32]) {
    let deadline = Instant::now() + KILL_DELAY;
    loop {
        let alive: Vec<u32> = groups.iter().copied().filter(|&g| group_alive(g)).collect();
        if alive.is_empty() {
            return;
        }
        if Instant::now() >= deadline {
            signal_groups(&alive, "-KILL");
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

/// Envoie `signal` (ex. `-HUP`) à chaque groupe de processus.
fn signal_groups(groups: &[u32], signal: &str) {
    if groups.is_empty() {
        return;
    }
    let mut cmd = Command::new("/bin/kill");
    cmd.arg(signal).arg("--");
    for g in groups {
        cmd.arg(format!("-{g}"));
    }
    let _ = cmd
        .stderr(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .status();
}

/// Vrai s'il reste au moins un processus dans le groupe (`kill -0`).
fn group_alive(group: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-0", "--", &format!("-{group}")])
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

fn pty_error(err: impl std::fmt::Display) -> AppError {
    AppError::Io(format!("terminal: {err}"))
}
