//! Lancement de `git` : sans shell, arguments séparés, sorties stables (décision 0007).

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use super::{Git, RemoteErrorKind, classify_remote_error};
use crate::process::{Captured, run_with_timeout};
use crate::{AppError, Failure, Result};

impl Git {
    /// Commande git prête à recevoir ses arguments, lancée dans `cwd`.
    ///
    /// - `GIT_OPTIONAL_LOCKS=0` : une lecture ne prend pas le verrou de l'index (le terminal
    ///   peut lancer `git add` au même moment).
    /// - `LC_ALL=C` : messages en anglais, reconnus sans dépendre de la langue du système.
    /// - `core.quotePath=false` et `--literal-pathspecs` : chemins lus et passés tels quels
    ///   (accents, guillemets, `*` ou `[` dans un nom).
    fn command(&self, cwd: &Path) -> Command {
        let mut cmd = Command::new(&self.program);
        cmd.current_dir(cwd)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("LC_ALL", "C")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .args(["-c", "core.quotePath=false", "--literal-pathspecs"]);
        cmd
    }

    /// Lance git et rend sa sortie brute, réussie ou non. L'erreur d'entrée-sortie (programme
    /// absent) est rendue telle quelle, pour que l'appelant reconnaisse `NotFound`.
    pub(super) fn output(&self, cwd: &Path, args: &[&str]) -> io::Result<Output> {
        self.command(cwd).args(args).output()
    }

    /// Lance git et exige un code de sortie accepté (`0`, plus `1` si `allow_one` : `git diff
    /// --no-index` rend 1 quand les fichiers diffèrent). Rend la sortie standard.
    pub(super) fn run(&self, cwd: &Path, args: &[&str], allow_one: bool) -> Result<Vec<u8>> {
        let out = self
            .output(cwd, args)
            .map_err(|e| AppError::Io(format!("git: {e}")))?;
        let code = out.status.code();
        if code == Some(0) || (allow_one && code == Some(1)) {
            Ok(out.stdout)
        } else {
            Err(AppError::Io(format!(
                "git {}: {}",
                args.first().copied().unwrap_or_default(),
                String::from_utf8_lossy(&out.stderr).trim()
            )))
        }
    }

    /// Écriture git (lot 2) : `input` passé sur l'entrée standard (patch, message de commit).
    /// Rend la sortie standard ; un code non nul rend `AppError::Git` avec les deux sorties
    /// de git (un hook écrit sur l'une ou l'autre).
    pub(super) fn write(&self, cwd: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>> {
        let mut cmd = self.command(cwd);
        cmd.args(args)
            .stdin(if input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| AppError::Io(format!("git: {e}")))?;
        if let (Some(bytes), Some(mut stdin)) = (input, child.stdin.take()) {
            // Écrit avant de lire les sorties : git lit toute son entrée (patch, message)
            // avant d'écrire. Une erreur d'écriture (git sorti tôt) se lit dans son statut.
            let _ = stdin.write_all(bytes);
        }
        let out = child
            .wait_with_output()
            .map_err(|e| AppError::Io(format!("git: {e}")))?;
        if out.status.success() {
            return Ok(out.stdout);
        }
        let text = [&out.stdout, &out.stderr]
            .iter()
            .map(|b| String::from_utf8_lossy(b).trim().to_owned())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        Err(AppError::Git(if text.is_empty() {
            format!(
                "git {}: {}",
                args.first().copied().unwrap_or_default(),
                out.status
            )
        } else {
            text
        }))
    }

    /// Commande réseau (décision 0010) : récupérer, pousser, tirer. Entrée fermée, aucune
    /// question posée (`GIT_TERMINAL_PROMPT=0`). Le processus a son propre groupe : passé le
    /// délai, git et ses enfants (`ssh`, `git-remote-https`, hooks) sont tués, sans thread
    /// bloqué. Rend la sortie standard ; un échec rend `AppError::Remote` (genre reconnu et
    /// sortie des deux flux), un délai dépassé `RemoteErrorKind::Timeout`.
    pub(super) fn network(&self, cwd: &Path, args: &[&str]) -> Result<String> {
        let mut cmd = self.command(cwd);
        cmd.args(args);
        let captured = run_with_timeout(cmd, None, self.network_timeout)
            .map_err(|e| AppError::Io(format!("git: {e}")))?;
        let Some(Captured {
            status,
            stdout,
            stderr,
        }) = captured
        else {
            return Err(AppError::Remote {
                kind: RemoteErrorKind::Timeout,
                output: String::new(),
            });
        };
        if status.success() {
            return Ok(String::from_utf8_lossy(&stdout).into_owned());
        }
        let output = [&stdout, &stderr]
            .iter()
            .map(|b| String::from_utf8_lossy(b).trim().to_owned())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        Err(AppError::Remote {
            kind: classify_remote_error(&output),
            output,
        })
    }

    /// Vrai si HEAD désigne un commit (faux dans un dépôt neuf).
    pub(super) fn has_head(&self, cwd: &Path) -> Result<bool> {
        let out = self
            .output(cwd, &["rev-parse", "--verify", "-q", "HEAD"])
            .map_err(|e| AppError::Io(format!("git: {e}")))?;
        Ok(out.status.success())
    }
}

/// Dépôt qui contient le dossier racine.
#[derive(Debug)]
pub(super) struct Location {
    /// Racine du dépôt (`--show-toplevel`) : dossier où git est lancé ensuite.
    pub top: PathBuf,
    /// Dossier racine relatif au dépôt, terminé par `/` (vide s'il est la racine du dépôt).
    pub prefix: String,
}

/// Résultat de la recherche du dépôt.
pub(super) enum Located {
    Repo(Location),
    NotARepo,
    GitNotFound,
}

/// Cherche le dépôt qui contient `root` (`git rev-parse --show-toplevel --show-prefix`).
pub(super) fn locate(git: &Git, root: &str) -> Result<Located> {
    let dir = Path::new(root);
    if !dir.is_dir() {
        return Err(AppError::NotFound(root.to_owned()));
    }
    let out = match git.output(dir, &["rev-parse", "--show-toplevel", "--show-prefix"]) {
        Ok(out) => out,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Located::GitNotFound),
        Err(e) => return Err(AppError::Io(format!("git: {e}"))),
    };
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        // Hors dépôt, ou dans `.git` (pas d'arbre de travail) : pas un dépôt pour le volet.
        if stderr.contains("not a git repository") || stderr.contains("work tree") {
            return Ok(Located::NotARepo);
        }
        return Err(AppError::Io(format!("git rev-parse: {}", stderr.trim())));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut lines = text.split('\n');
    let top = lines.next().unwrap_or_default();
    let prefix = lines.next().unwrap_or_default();
    Ok(Located::Repo(Location {
        top: PathBuf::from(top),
        prefix: prefix.to_owned(),
    }))
}

/// Comme `locate`, mais hors dépôt et git absent sont des erreurs (diff demandé sans dépôt).
pub(super) fn require_repo(git: &Git, root: &str) -> Result<Location> {
    match locate(git, root)? {
        Located::Repo(location) => Ok(location),
        Located::NotARepo => Err(Failure::NotARepo(root.to_owned()).into()),
        Located::GitNotFound => Err(AppError::NotFound(git.program.display().to_string())),
    }
}
