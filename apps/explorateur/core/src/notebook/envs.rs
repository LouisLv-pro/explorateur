//! Environnements Python proposés pour un notebook (spec `notebook.md`, décision 0024) : venvs
//! du dossier du notebook et de ses parents, kernelspecs des dossiers Jupyter, `python3` du
//! shell de connexion. Chaque Python candidat est lancé une fois (sonde) : cette recherche ne
//! se fait que sur un geste de l'utilisateur.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::kernel::{login_shell_env, login_shell_program};
use crate::process::run_with_timeout;

/// Délai d'une sonde : un Python bloqué (ou très lent) est listé sans `ipykernel`.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
/// Code de la sonde : `sys.prefix` (identité de l'environnement), version, puis l'import
/// d'`ipykernel`. Les deux lignes sont écrites avant l'import, donc lues même s'il échoue.
const PROBE_CODE: &str =
    "import sys; print(sys.prefix); print(sys.version.split()[0]); import ipykernel";
/// Noms de dossier de venv, dans l'ordre où ils sont proposés.
const VENV_NAMES: [&str; 3] = [".venv", "venv", "env"];

/// Origine d'un environnement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum PythonEnvKind {
    Venv,
    Kernelspec,
    Shell,
}

/// Environnement Python proposé dans le sélecteur du notebook.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnv {
    /// `venv:<python>`, `kernelspec:<dossier>` ou `shell:<python>` : opaque pour le front,
    /// rendu tel quel à `start`.
    pub id: String,
    pub label: String,
    pub kind: PythonEnvKind,
    /// Faux : listé mais non sélectionnable.
    pub has_ipykernel: bool,
}

/// Où chercher, hors venvs. `EnvSearch::system()` remplit les valeurs réelles ; les tests en
/// construisent un à la main.
#[derive(Debug, Clone, Default)]
pub struct EnvSearch {
    /// Dossiers de données Jupyter (chacun peut contenir `kernels/<nom>/kernel.json`).
    pub jupyter_data_dirs: Vec<PathBuf>,
    /// `python3` du shell de connexion, s'il est trouvé.
    pub shell_python: Option<PathBuf>,
}

impl EnvSearch {
    /// Valeurs réelles : `JUPYTER_PATH`, `~/Library/Jupyter`, `/usr/local/share/jupyter`,
    /// `/usr/share/jupyter`, et `$SHELL -l -c 'command -v python3'`. Bloquant (lance le shell).
    pub fn system() -> Self {
        let mut dirs = Vec::new();
        // Une app lancée du Dock n'a pas l'environnement du shell : `JUPYTER_PATH` est lu
        // dans celui du shell de connexion d'abord.
        let jupyter_path = login_shell_env()
            .get("JUPYTER_PATH")
            .cloned()
            .or_else(|| std::env::var("JUPYTER_PATH").ok());
        if let Some(value) = jupyter_path {
            dirs.extend(std::env::split_paths(&value).filter(|p| !p.as_os_str().is_empty()));
        }
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join("Library/Jupyter"));
        }
        dirs.push(PathBuf::from("/usr/local/share/jupyter"));
        dirs.push(PathBuf::from("/usr/share/jupyter"));
        Self {
            jupyter_data_dirs: dirs,
            shell_python: login_shell_python(),
        }
    }
}

/// Chemin de `python3` d'après le shell de connexion (absolu et existant), sinon `None`.
fn login_shell_python() -> Option<PathBuf> {
    let mut cmd = Command::new(login_shell_program());
    cmd.args(["-l", "-c", "command -v python3"])
        .stdin(Stdio::null());
    let captured = run_with_timeout(cmd, None, PROBE_TIMEOUT).ok()??;
    if !captured.status.success() {
        return None;
    }
    // Le profil du shell peut écrire avant : seule la dernière ligne est la réponse.
    let stdout = String::from_utf8_lossy(&captured.stdout);
    let path = PathBuf::from(stdout.lines().map(str::trim).rfind(|l| !l.is_empty())?);
    (path.is_absolute() && path.is_file()).then_some(path)
}

/// Résultat d'une sonde. Tout est faux ou absent si le Python n'a pas répondu à temps.
#[derive(Debug, Default)]
pub(crate) struct Probe {
    /// `import ipykernel` a réussi (code de sortie 0).
    pub ok: bool,
    pub prefix: Option<String>,
    pub version: Option<String>,
}

/// Lance `python -c "<sonde>"` (5 s au plus, processus tué au-delà).
pub(crate) fn probe(python: &Path) -> Probe {
    let mut cmd = Command::new(python);
    // Dossier de travail neutre : `-c` met le dossier courant en tête de `sys.path`.
    cmd.args(["-c", PROBE_CODE])
        .stdin(Stdio::null())
        .current_dir("/");
    let Ok(Some(captured)) = run_with_timeout(cmd, None, PROBE_TIMEOUT) else {
        return Probe::default();
    };
    let stdout = String::from_utf8_lossy(&captured.stdout);
    let mut lines = stdout.lines().map(str::trim);
    let mut next_line = || lines.next().filter(|l| !l.is_empty()).map(str::to_owned);
    let prefix = next_line();
    let version = next_line();
    Probe {
        ok: captured.status.success(),
        prefix,
        version,
    }
}

/// Champs utiles d'un `kernel.json`. Les autres sont ignorés.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct KernelJson {
    #[serde(default)]
    pub argv: Vec<String>,
    pub display_name: String,
    /// `message` : interruption par le canal de contrôle ; sinon par signal.
    #[serde(default)]
    pub interrupt_mode: Option<String>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
}

/// Lit `<dir>/kernel.json` ; `None` s'il est absent ou illisible.
pub(crate) fn read_kernelspec(dir: &Path) -> Option<KernelJson> {
    let text = fs::read_to_string(dir.join("kernel.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// Environnement trouvé, avant sonde.
struct Candidate {
    kind: PythonEnvKind,
    id: String,
    label: String,
    /// Exécutable (venv, shell) ou `argv[0]` (kernelspec), pour les doublons.
    exe: Option<PathBuf>,
    /// Vrai pour un venv ou le shell ; un kernelspec n'est pas sondé (supposé avoir ipykernel).
    probed: bool,
}

impl Candidate {
    fn python(kind: PythonEnvKind, prefix: &str, python: PathBuf, label: String) -> Self {
        Self {
            kind,
            id: format!("{prefix}:{}", python.display()),
            label,
            exe: Some(python),
            probed: true,
        }
    }

    /// Clés d'identité (voir `list_python_envs`).
    fn keys(&self, probe: Option<&Probe>) -> Vec<PathBuf> {
        let Some(exe) = self.exe.as_deref().filter(|e| e.is_absolute()) else {
            return Vec::new();
        };
        let mut keys: Vec<PathBuf> = place(exe).into_iter().collect();
        if self.probed {
            match probe.and_then(|p| p.prefix.as_deref()) {
                Some(prefix) => keys.push(PathBuf::from(prefix)),
                // Sans prefix seulement : le `bin/python` d'un venv est un lien vers le Python
                // de base, deux venvs auraient le même exécutable canonique.
                None => keys.extend(fs::canonicalize(exe).ok()),
            }
        }
        keys
    }

    fn into_env(self, probe: Option<Probe>) -> PythonEnv {
        let (has_ipykernel, version) = match (self.probed, probe) {
            (true, Some(p)) => (p.ok, p.version),
            (true, None) => (false, None),
            (false, _) => (true, None),
        };
        let label = match version {
            Some(v) => format!("{} · Python {v}", self.label),
            None => self.label,
        };
        PythonEnv {
            id: self.id,
            label,
            kind: self.kind,
            has_ipykernel,
        }
    }
}

/// `place(exe)` : dossier de `exe` rendu canonique, joint au nom du fichier. Le dernier lien
/// n'est pas suivi, contrairement à `canonicalize(exe)`. `None` si `exe` n'existe pas.
fn place(exe: &Path) -> Option<PathBuf> {
    fs::symlink_metadata(exe).ok()?;
    Some(fs::canonicalize(exe.parent()?).ok()?.join(exe.file_name()?))
}

/// Environnements pour `notebook_path`, dans l'ordre venvs, kernelspecs, shell, sans doublon.
///
/// Doublons : chaque environnement a des clés (`place(exe)` ; pour un venv ou le shell, en plus,
/// `sys.prefix` donné par la sonde, sinon l'exécutable canonique). Un environnement qui partage
/// une clé avec un environnement déjà gardé est écarté. Bloquant : les sondes tournent en
/// parallèle, 5 s au plus chacune.
pub fn list_python_envs(notebook_path: &Path, root: &Path, search: &EnvSearch) -> Vec<PythonEnv> {
    let mut candidates = venv_candidates(notebook_path, root);
    candidates.extend(kernelspec_candidates(&search.jupyter_data_dirs));
    if let Some(python) = &search.shell_python {
        candidates.push(Candidate::python(
            PythonEnvKind::Shell,
            "shell",
            python.clone(),
            "python3 (shell)".to_owned(),
        ));
    }

    let probes = probe_all(&candidates);
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut envs = Vec::new();
    for (candidate, probe) in candidates.into_iter().zip(probes) {
        let keys = candidate.keys(probe.as_ref());
        if keys.iter().any(|k| seen.contains(k)) {
            continue;
        }
        seen.extend(keys);
        envs.push(candidate.into_env(probe));
    }
    envs
}

/// Venvs du dossier du notebook puis de chaque parent jusqu'à `root` inclus (le plus proche
/// d'abord). Hors de `root`, seul le dossier du notebook est regardé.
fn venv_candidates(notebook_path: &Path, root: &Path) -> Vec<Candidate> {
    let Some(start) = notebook_path.parent() else {
        return Vec::new();
    };
    let dirs: Vec<&Path> = if start.starts_with(root) {
        start
            .ancestors()
            .take_while(|d| d.starts_with(root))
            .collect()
    } else {
        vec![start]
    };
    let mut found = Vec::new();
    for dir in dirs {
        let folder = dir.file_name().map_or_else(
            || dir.display().to_string(),
            |n| n.to_string_lossy().into_owned(),
        );
        for name in VENV_NAMES {
            let python = dir.join(name).join("bin").join("python");
            if python.is_file() {
                found.push(Candidate::python(
                    PythonEnvKind::Venv,
                    "venv",
                    python,
                    format!("{name} ({folder})"),
                ));
            }
        }
    }
    found
}

/// Kernelspecs `<dossier>/kernels/<nom>/kernel.json`, dossiers dans l'ordre donné, noms triés.
/// Un nom déjà vu dans un dossier précédent est ignoré (comme Jupyter) ; un `kernel.json`
/// illisible aussi.
fn kernelspec_candidates(data_dirs: &[PathBuf]) -> Vec<Candidate> {
    let mut names = HashSet::new();
    let mut found = Vec::new();
    for data in data_dirs {
        let Ok(entries) = fs::read_dir(data.join("kernels")) else {
            continue;
        };
        let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        dirs.sort();
        for dir in dirs {
            let Some(spec) = read_kernelspec(&dir) else {
                continue;
            };
            let name = dir.file_name().map(|n| n.to_os_string());
            if !names.insert(name) {
                continue;
            }
            found.push(Candidate {
                kind: PythonEnvKind::Kernelspec,
                id: format!("kernelspec:{}", dir.display()),
                label: spec.display_name,
                exe: spec.argv.first().map(PathBuf::from),
                probed: false,
            });
        }
    }
    found
}

/// Sonde chaque candidat qui doit l'être, tous en même temps (un thread par sonde).
fn probe_all(candidates: &[Candidate]) -> Vec<Option<Probe>> {
    thread::scope(|scope| {
        let handles: Vec<_> = candidates
            .iter()
            .map(|c| match (&c.exe, c.probed) {
                (Some(exe), true) => Some(scope.spawn(move || probe(exe))),
                _ => None,
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.and_then(|h| h.join().ok()))
            .collect()
    })
}
