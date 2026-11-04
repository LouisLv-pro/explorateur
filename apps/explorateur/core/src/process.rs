//! Lancement d'un processus avec délai, partagé par `git` (réseau) et `gh`.

use std::io::{self, Read, Write};
use std::os::unix::process::CommandExt;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

/// Attente maximale des sorties une fois le processus terminé.
const READ_GRACE: Duration = Duration::from_secs(2);

/// Sorties d'un processus terminé dans le délai.
pub(crate) struct Captured {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// Lance `cmd` dans son propre groupe de processus, avec `input` sur l'entrée standard si
/// donné (sinon l'entrée de `cmd` est conservée). Passé `timeout`, le processus et ses enfants
/// sont tués, sans thread bloqué : rend `Ok(None)`. L'erreur d'entrée-sortie (programme absent)
/// est rendue telle quelle, pour que l'appelant reconnaisse `NotFound`.
pub(crate) fn run_with_timeout(
    mut cmd: Command,
    input: Option<&[u8]>,
    timeout: Duration,
) -> io::Result<Option<Captured>> {
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd.spawn()?;
    if let (Some(bytes), Some(mut stdin)) = (input, child.stdin.take()) {
        // Écrit sur un fil : un processus qui ne lit pas ne bloque pas le délai. Une erreur
        // d'écriture (processus sorti tôt) se lit dans son statut ; le tube se ferme à la fin.
        let bytes = bytes.to_vec();
        thread::spawn(move || {
            let _ = stdin.write_all(&bytes);
        });
    }
    let stdout = collect(child.stdout.take());
    let stderr = collect(child.stderr.take());

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait()? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                kill_group(child.id());
                let _ = child.kill();
                let _ = child.wait();
                return Ok(None);
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    };
    // Un enfant échappé du groupe peut garder les tubes ouverts : lecture bornée.
    Ok(Some(Captured {
        status,
        stdout: stdout.recv_timeout(READ_GRACE).unwrap_or_default(),
        stderr: stderr.recv_timeout(READ_GRACE).unwrap_or_default(),
    }))
}

/// Lit un tube en entier sur un fil ; les octets arrivent par le canal à la fermeture du tube.
fn collect(pipe: Option<impl Read + Send + 'static>) -> mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut bytes);
        }
        let _ = tx.send(bytes);
    });
    rx
}

/// Tue le groupe de processus de `pid` (sans `unsafe` : `/bin/kill`, comme le terminal).
fn kill_group(pid: u32) {
    let _ = Command::new("/bin/kill")
        .args(["-KILL", "--", &format!("-{pid}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}
