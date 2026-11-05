//! Noyaux Jupyter (spec `notebook.md`, décision 0024) : l'app lance `ipykernel` elle-même et
//! lui parle en ZeroMQ, sans serveur Jupyter.
//!
//! Chaque noyau a une tâche tokio qui possède le processus et les sockets. Les méthodes de
//! `KernelSessions` sont bloquantes : elles envoient un ordre à cette tâche par un canal, ou
//! lancent un travail sur le runtime de `KernelSessions` et attendent sa réponse sur un canal
//! `std`. Elles marchent donc depuis n'importe quel thread, dans un runtime tokio ou non.
//!
//! Sans `unsafe` (interdit dans le workspace), l'interruption passe par `/bin/kill -INT`.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, DirBuilder, OpenOptions};
use std::future::Future;
use std::io::{self, Write};
use std::net::{IpAddr, Ipv4Addr};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError, mpsc as std_mpsc};
use std::time::Duration;

use jupyter_protocol::{
    ConnectionInfo, ExecuteRequest, InterruptRequest, JupyterMessage, KernelInfoRequest,
    ShutdownRequest, Transport,
};
use jupyter_zmq_client::{
    ClientControlConnection, Connection, DealerSendConnection, RawMessage,
    create_client_control_connection, create_client_iopub_connection,
    create_client_shell_connection_with_identity, peek_ports_with_listeners,
    peer_identity_for_session,
};
use serde::Serialize;
use serde_json::{Map, Value, json};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, ChildStderr, Command};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use uuid::Uuid;
use zeromq::SocketRecv;

use super::envs::{probe, read_kernelspec};
use crate::process::run_with_timeout;
use crate::{AppError, Result};

/// Délai de démarrage : réponse à `kernel_info_request` attendue en 30 s au plus.
const START_TIMEOUT: Duration = Duration::from_secs(30);
/// Intervalle entre deux `kernel_info_request` pendant le démarrage.
const KERNEL_INFO_RETRY: Duration = Duration::from_millis(500);
/// Pause entre deux tentatives de connexion aux sockets du noyau.
const CONNECT_RETRY: Duration = Duration::from_millis(200);
/// Après `shutdown_request`, délai avant de tuer le processus.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);
/// Attente maximale de la tâche d'un noyau qu'on arrête (arrêt doux, puis `KILL`).
const STOP_WAIT: Duration = Duration::from_secs(5);
/// Fin de la sortie d'erreur gardée pour `KernelStartFailed` et `Died`.
const STDERR_KEEP: usize = 8 * 1024;
/// Après la fin du processus, délai pour lire ce qui reste dans le tube d'erreur.
const STDERR_DRAIN: Duration = Duration::from_millis(500);
/// Délai de `$SHELL -l -c env` (un profil bloqué ne bloque pas le démarrage).
const LOGIN_ENV_TIMEOUT: Duration = Duration::from_secs(5);

/// Identifiant d'un noyau, donné par `start`, gardé par `restart`.
pub type KernelId = String;

/// État du noyau montré par la barre d'outils.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
pub enum KernelState {
    Starting,
    Idle,
    Busy,
    Dead,
}

/// Fin d'exécution d'une cellule (`status` de l'`execute_reply`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
pub enum ExecutionStatus {
    Ok,
    Error,
    /// Requête non exécutée : une cellule précédente a échoué ou a été interrompue.
    Aborted,
}

/// Message d'un noyau vers le front (un par `tauri::ipc::Channel`).
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum KernelEvent {
    Status {
        state: KernelState,
    },
    /// Le noyau commence la cellule (`execute_input`) : compteur `[n]`.
    ExecutionStarted {
        cell_id: String,
        /// Specta refuse `i64` : exporté comme `number`.
        #[specta(type = i32)]
        execution_count: i64,
    },
    /// Sortie nbformat (`stream`, `display_data`, `execute_result`, `error`).
    Output {
        cell_id: String,
        /// Exporté en `unknown` : le type specta de `Value` contient des `i64`, refusés à
        /// l'export TypeScript. Le front type lui-même les sorties nbformat.
        #[specta(type = specta_typescript::Unknown)]
        output: Value,
    },
    ClearOutput {
        cell_id: String,
        wait: bool,
    },
    /// Toujours après les sorties de la cellule.
    ExecutionFinished {
        cell_id: String,
        status: ExecutionStatus,
    },
    /// Le processus s'est arrêté sans `shutdown`. Porte la fin de sa sortie d'erreur.
    Died {
        message: String,
    },
}

/// Destination des événements d'un noyau (un `Channel` Tauri dans l'app, un canal en test).
pub type EventSink = Arc<dyn Fn(KernelEvent) + Send + Sync>;

/// Message iopub → sortie au format nbformat, prête à ranger dans la cellule. `None` pour ce
/// qui n'en est pas une (`status`, `execute_input`, `clear_output`, `comm_*`,
/// `update_display_data`...). Les champs inconnus de nbformat (`transient`) sont laissés.
pub fn nbformat_output(msg_type: &str, content: &Value) -> Option<Value> {
    let field = |key: &str, default: Value| content.get(key).cloned().unwrap_or(default);
    let empty = || Value::Object(Map::new());
    match msg_type {
        "stream" => Some(json!({
            "output_type": "stream",
            "name": field("name", json!("stdout")),
            "text": field("text", json!("")),
        })),
        "display_data" => Some(json!({
            "output_type": "display_data",
            "data": field("data", empty()),
            "metadata": field("metadata", empty()),
        })),
        "execute_result" => Some(json!({
            "output_type": "execute_result",
            "data": field("data", empty()),
            "metadata": field("metadata", empty()),
            "execution_count": field("execution_count", Value::Null),
        })),
        "error" => Some(json!({
            "output_type": "error",
            "ename": field("ename", json!("")),
            "evalue": field("evalue", json!("")),
            "traceback": field("traceback", json!([])),
        })),
        _ => None,
    }
}

/// Shell de connexion : `$SHELL`, sinon `/bin/zsh` (comme le terminal).
pub(crate) fn login_shell_program() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_owned())
}

/// Environnement du shell de connexion (`$SHELL -l -c env`), lu une fois par session de l'app.
/// Vide en cas d'échec. Une app lancée du Dock n'a pas le `PATH` du shell : sans lui,
/// `!pip install` ou un `subprocess` dans une cellule ne trouveraient pas les outils.
pub fn login_shell_env() -> &'static HashMap<String, String> {
    static ENV: OnceLock<HashMap<String, String>> = OnceLock::new();
    ENV.get_or_init(read_login_shell_env)
}

fn read_login_shell_env() -> HashMap<String, String> {
    let mut cmd = std::process::Command::new(login_shell_program());
    // `env -0` sépare les variables par un octet nul : une valeur peut contenir un saut de ligne.
    cmd.args(["-l", "-c", "/usr/bin/env -0"])
        .stdin(Stdio::null());
    let Ok(Some(captured)) = run_with_timeout(cmd, None, LOGIN_ENV_TIMEOUT) else {
        return HashMap::new();
    };
    if !captured.status.success() {
        return HashMap::new();
    }
    captured
        .stdout
        .split(|b| *b == 0)
        .filter_map(|entry| {
            let text = std::str::from_utf8(entry).ok()?;
            let (key, value) = text.split_once('=')?;
            // Un profil qui écrit sur la sortie standard colle son texte à la première variable.
            let key = key.rsplit('\n').next().unwrap_or(key);
            let keep = !key.is_empty() && !matches!(key, "PWD" | "OLDPWD" | "SHLVL" | "_");
            keep.then(|| (key.to_owned(), value.to_owned()))
        })
        .collect()
}

/// Comment lancer le noyau d'un environnement.
struct Launch {
    program: PathBuf,
    /// Arguments ; `{connection_file}` y est remplacé par le chemin du fichier de connexion.
    args: Vec<String>,
    /// Variables ajoutées à l'environnement du shell de connexion.
    env: Vec<(String, String)>,
    /// Vrai si le kernelspec déclare `interrupt_mode: message`, sinon interruption par signal.
    interrupt_by_message: bool,
}

/// Lit un `PythonEnv::id`. `NoPythonEnv` si l'environnement n'existe plus ou n'a pas
/// `ipykernel`. Bloquant (sonde de 5 s au plus pour un venv ou le shell).
fn resolve_launch(env_id: &str, login_env: &HashMap<String, String>) -> Result<Launch> {
    let (kind, path) = env_id.split_once(':').ok_or(AppError::NoPythonEnv)?;
    let path = PathBuf::from(path);
    match kind {
        "venv" | "shell" => {
            if !path.is_absolute() || !path.is_file() || !probe(&path).ok {
                return Err(AppError::NoPythonEnv);
            }
            let mut env = Vec::new();
            // `<venv>/bin/python` : le venv est deux dossiers au-dessus.
            if let (true, Some(venv)) = (kind == "venv", path.parent().and_then(Path::parent)) {
                let base = login_env
                    .get("PATH")
                    .cloned()
                    .or_else(|| std::env::var("PATH").ok())
                    .unwrap_or_default();
                let bin = venv.join("bin");
                let path_var = if base.is_empty() {
                    bin.display().to_string()
                } else {
                    format!("{}:{base}", bin.display())
                };
                env.push(("PATH".to_owned(), path_var));
                env.push(("VIRTUAL_ENV".to_owned(), venv.display().to_string()));
            }
            Ok(Launch {
                program: path,
                args: ["-m", "ipykernel_launcher", "-f", "{connection_file}"]
                    .map(str::to_owned)
                    .to_vec(),
                env,
                interrupt_by_message: false,
            })
        }
        "kernelspec" => {
            let spec = read_kernelspec(&path).ok_or(AppError::NoPythonEnv)?;
            let (program, args) = spec.argv.split_first().ok_or(AppError::NoPythonEnv)?;
            Ok(Launch {
                program: PathBuf::from(program),
                args: args.to_vec(),
                env: spec.env.unwrap_or_default().into_iter().collect(),
                interrupt_by_message: spec.interrupt_mode.as_deref() == Some("message"),
            })
        }
        _ => Err(AppError::NoPythonEnv),
    }
}

/// Ce qu'il faut pour (re)démarrer un noyau : `restart` relance avec les mêmes valeurs.
struct Params {
    notebook_path: PathBuf,
    env_id: String,
    login_env: HashMap<String, String>,
    sink: EventSink,
}

/// Ordre envoyé à la tâche d'un noyau.
enum Order {
    Execute {
        cell_id: String,
        code: String,
    },
    /// Interruption par le canal de contrôle (`interrupt_mode: message`).
    Interrupt,
    /// Arrêt demandé : `done` reçoit un message quand le processus est fini.
    Shutdown {
        done: std_mpsc::Sender<()>,
    },
}

/// Noyau dont le processus a démarré.
struct Running {
    pid: u32,
    connection_file: PathBuf,
    orders: mpsc::UnboundedSender<Order>,
    interrupt_by_message: bool,
}

struct Entry {
    params: Arc<Params>,
    /// `None` pendant un redémarrage, ou si le redémarrage a échoué.
    running: Option<Running>,
}

/// Noyaux ouverts, par identifiant. Possède son propre runtime tokio (deux threads).
pub struct KernelSessions {
    /// `None` si le runtime n'a pas pu être créé : `start` le signale par `KernelStartFailed`.
    /// `Option` aussi pour l'arrêter sans attendre dans `drop`.
    runtime: Option<tokio::runtime::Runtime>,
    kernels: Mutex<HashMap<KernelId, Entry>>,
    next_id: AtomicU64,
}

impl Default for KernelSessions {
    fn default() -> Self {
        Self::new()
    }
}

impl KernelSessions {
    pub fn new() -> Self {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("noyau-jupyter")
            .enable_all()
            .build()
            .ok();
        Self {
            runtime,
            kernels: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    /// Démarre un noyau pour `notebook_path` (dossier de travail : celui du notebook). Rend la
    /// main quand le noyau a répondu à `kernel_info_request` (30 s au plus).
    pub fn start(
        &self,
        notebook_path: &Path,
        env_id: &str,
        login_env: &HashMap<String, String>,
        sink: EventSink,
    ) -> Result<KernelId> {
        let params = Arc::new(Params {
            notebook_path: notebook_path.to_path_buf(),
            env_id: env_id.to_owned(),
            login_env: login_env.clone(),
            sink,
        });
        let running = self.launch(&params)?;
        let id = format!("noyau-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        self.lock().insert(
            id.clone(),
            Entry {
                params,
                running: Some(running),
            },
        );
        Ok(id)
    }

    /// Envoie le code de la cellule. Ne l'attend pas : les événements arrivent par le canal.
    pub fn execute(&self, id: &str, cell_id: &str, code: &str) -> Result<()> {
        let orders = self.with_running(id, |r| r.orders.clone())?;
        orders
            .send(Order::Execute {
                cell_id: cell_id.to_owned(),
                code: code.to_owned(),
            })
            .map_err(|_| AppError::KernelNotFound)
    }

    /// Interrompt la cellule en cours : `SIGINT` au processus, ou `interrupt_request` si le
    /// kernelspec le demande.
    pub fn interrupt(&self, id: &str) -> Result<()> {
        let (pid, by_message, orders) =
            self.with_running(id, |r| (r.pid, r.interrupt_by_message, r.orders.clone()))?;
        if orders.is_closed() {
            return Err(AppError::KernelNotFound);
        }
        if by_message {
            return orders
                .send(Order::Interrupt)
                .map_err(|_| AppError::KernelNotFound);
        }
        std::process::Command::new("/bin/kill")
            .args(["-INT", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| AppError::Io(format!("/bin/kill : {e}")))?;
        Ok(())
    }

    /// Arrête le noyau puis le redémarre avec le même environnement et le même canal. Garde
    /// l'identifiant.
    pub fn restart(&self, id: &str) -> Result<()> {
        let (params, running) = {
            let mut kernels = self.lock();
            let entry = kernels.get_mut(id).ok_or(AppError::KernelNotFound)?;
            (Arc::clone(&entry.params), entry.running.take())
        };
        if let Some(running) = running {
            self.stop(vec![running]);
        }
        let running = self.launch(&params)?;
        let leftover = match self.lock().get_mut(id) {
            Some(entry) => entry.running.replace(running),
            // Arrêté pendant le redémarrage : le nouveau processus ne doit pas rester.
            None => Some(running),
        };
        if let Some(leftover) = leftover {
            self.stop(vec![leftover]);
        }
        Ok(())
    }

    /// Arrête le noyau : `shutdown_request`, puis `KILL` après 2 s. N'émet pas `Died`.
    pub fn shutdown(&self, id: &str) -> Result<()> {
        let entry = self.lock().remove(id).ok_or(AppError::KernelNotFound)?;
        self.stop(entry.running.into_iter().collect());
        Ok(())
    }

    /// Arrête tous les noyaux (fermeture de l'app, changement de dossier racine), en parallèle.
    pub fn shutdown_all(&self) {
        let running: Vec<Running> = self
            .lock()
            .drain()
            .filter_map(|(_, entry)| entry.running)
            .collect();
        self.stop(running);
    }

    /// Pid du processus du noyau.
    pub fn pid(&self, id: &str) -> Option<u32> {
        self.with_running(id, |r| r.pid).ok()
    }

    /// Fichier de connexion du noyau (dans le dossier runtime de Jupyter).
    pub fn connection_file(&self, id: &str) -> Option<PathBuf> {
        self.with_running(id, |r| r.connection_file.clone()).ok()
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<KernelId, Entry>> {
        // Un panic pendant que le verrou est tenu ne doit pas bloquer les autres noyaux.
        self.kernels.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Lit le noyau en marche `id` sans garder le verrou.
    fn with_running<T>(&self, id: &str, read: impl FnOnce(&Running) -> T) -> Result<T> {
        self.lock()
            .get(id)
            .and_then(|e| e.running.as_ref())
            .map(read)
            .ok_or(AppError::KernelNotFound)
    }

    /// Lance le processus et attend qu'il réponde.
    fn launch(&self, params: &Arc<Params>) -> Result<Running> {
        let launch = resolve_launch(&params.env_id, &params.login_env)?;
        (params.sink)(KernelEvent::Status {
            state: KernelState::Starting,
        });
        self.block_on(start_kernel(Arc::clone(params), launch))
    }

    /// Envoie l'ordre d'arrêt à chaque noyau, puis attend qu'ils aient tous fini.
    fn stop(&self, running: Vec<Running>) {
        let waits: Vec<_> = running
            .into_iter()
            .map(|r| {
                let (done, finished) = std_mpsc::channel();
                let sent = r.orders.send(Order::Shutdown { done }).is_ok();
                (r, sent.then_some(finished))
            })
            .collect();
        for (r, finished) in waits {
            if let Some(finished) = finished {
                let _ = finished.recv_timeout(STOP_WAIT);
            }
            // La tâche l'a déjà supprimé ; au cas où elle aurait disparu avant.
            let _ = fs::remove_file(&r.connection_file);
        }
    }

    /// Exécute `fut` sur le runtime et attend son résultat sur un canal `std`. Contrairement à
    /// `Runtime::block_on`, sans panique si l'appelant est lui-même dans un runtime tokio.
    fn block_on<T: Send + 'static>(
        &self,
        fut: impl Future<Output = Result<T>> + Send + 'static,
    ) -> Result<T> {
        let runtime = self
            .runtime
            .as_ref()
            .ok_or_else(|| AppError::KernelStartFailed("runtime tokio indisponible".to_owned()))?;
        let (tx, rx) = std_mpsc::channel();
        runtime.spawn(async move {
            let _ = tx.send(fut.await);
        });
        rx.recv()
            .map_err(|_| AppError::KernelStartFailed("tâche de démarrage interrompue".to_owned()))?
    }
}

impl Drop for KernelSessions {
    fn drop(&mut self) {
        self.shutdown_all();
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_background();
        }
    }
}

/// Message reçu, en JSON brut : la conversion typée de `jupyter-protocol` réécrirait les
/// sorties (types MIME) et refuserait un message qu'elle ne sait pas lire.
struct Incoming {
    msg_type: String,
    parent_id: Option<String>,
    content: Value,
}

/// Décode un message signé ; `None` s'il est illisible ou mal signé.
fn decode(raw: RawMessage) -> Option<Incoming> {
    let header: Value = serde_json::from_slice(raw.jparts.first()?).ok()?;
    let parent: Value = serde_json::from_slice(raw.jparts.get(1)?).ok()?;
    let content: Value = serde_json::from_slice(raw.jparts.get(3)?).ok()?;
    Some(Incoming {
        msg_type: header.get("msg_type")?.as_str()?.to_owned(),
        parent_id: parent
            .get("msg_id")
            .and_then(Value::as_str)
            .map(str::to_owned),
        content,
    })
}

/// Tâche annulée quand elle sort de portée (lecteurs des sockets).
struct AbortOnDrop(JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Lit une socket en continu et transmet les messages par un canal. Une tâche par socket : la
/// boucle du noyau attend sur des canaux, qu'on peut abandonner dans `select!` sans perte.
fn forward<S: SocketRecv + Send + 'static>(
    mut conn: Connection<S>,
) -> (AbortOnDrop, mpsc::UnboundedReceiver<Incoming>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let task = tokio::spawn(async move {
        while let Ok(message) = conn.socket.recv().await {
            let Some(incoming) = RawMessage::from_multipart(message, &conn.mac)
                .ok()
                .and_then(decode)
            else {
                continue;
            };
            if tx.send(incoming).is_err() {
                break;
            }
        }
    });
    (AbortOnDrop(task), rx)
}

/// Sockets d'un noyau connecté.
struct Channels {
    shell: DealerSendConnection,
    control: ClientControlConnection,
    shell_rx: mpsc::UnboundedReceiver<Incoming>,
    iopub_rx: mpsc::UnboundedReceiver<Incoming>,
    _readers: [AbortOnDrop; 2],
}

/// Connecte les sockets, puis renvoie `kernel_info_request` jusqu'à avoir à la fois la réponse
/// (canal shell) et un message sur iopub. Le second point compte : un abonnement iopub (SUB)
/// perd les messages publiés avant la fin de sa poignée de main ; une fois un message reçu,
/// plus rien n'est perdu (même méthode que `jupyter_client`).
async fn connect(info: &ConnectionInfo, session: &str) -> std::result::Result<Channels, String> {
    let iopub = create_client_iopub_connection(info, "", session)
        .await
        .map_err(|e| e.to_string())?;
    let identity = peer_identity_for_session(session).map_err(|e| e.to_string())?;
    let shell = create_client_shell_connection_with_identity(info, session, identity)
        .await
        .map_err(|e| e.to_string())?;
    let control = create_client_control_connection(info, session)
        .await
        .map_err(|e| e.to_string())?;
    let (mut shell, shell_recv) = shell.split();
    let (iopub_reader, mut iopub_rx) = forward(iopub);
    let (shell_reader, mut shell_rx) = forward(shell_recv);

    let mut asked = HashSet::new();
    let (mut replied, mut heard) = (false, false);
    let mut tick = tokio::time::interval(KERNEL_INFO_RETRY);
    while !(replied && heard) {
        tokio::select! {
            _ = tick.tick() => {
                let request: JupyterMessage = KernelInfoRequest {}.into();
                asked.insert(request.header.msg_id.clone());
                shell.send(request).await.map_err(|e| e.to_string())?;
            }
            Some(msg) = shell_rx.recv() => {
                let ours = msg.parent_id.as_ref().is_some_and(|p| asked.contains(p));
                replied |= msg.msg_type == "kernel_info_reply" && ours;
            }
            Some(_) = iopub_rx.recv() => heard = true,
        }
    }
    Ok(Channels {
        shell,
        control,
        shell_rx,
        iopub_rx,
        _readers: [iopub_reader, shell_reader],
    })
}

/// Fin de la sortie d'erreur du processus, partagée avec la tâche qui la lit.
type StderrTail = Arc<Mutex<VecDeque<u8>>>;

/// Lit la sortie d'erreur en continu (un tube plein bloquerait un noyau bavard) et n'en
/// garde que les 8 derniers Kio.
fn read_stderr(pipe: Option<ChildStderr>, tail: StderrTail) -> JoinHandle<()> {
    tokio::spawn(async move {
        let Some(mut pipe) = pipe else { return };
        let mut buf = [0u8; 4096];
        while let Ok(n @ 1..) = pipe.read(&mut buf).await {
            let mut tail = tail.lock().unwrap_or_else(PoisonError::into_inner);
            tail.extend(buf.iter().take(n));
            let excess = tail.len().saturating_sub(STDERR_KEEP);
            tail.drain(..excess);
        }
    })
}

fn tail_text(tail: &StderrTail) -> String {
    let tail = tail.lock().unwrap_or_else(PoisonError::into_inner);
    let bytes: Vec<u8> = tail.iter().copied().collect();
    String::from_utf8_lossy(&bytes).trim().to_owned()
}

/// Écrit le fichier de connexion (droits `0600` : il porte la clé HMAC) dans le dossier
/// runtime de Jupyter, créé s'il manque.
fn write_connection_file(info: &ConnectionInfo) -> io::Result<PathBuf> {
    let dir = jupyter_zmq_client::runtime_dir();
    DirBuilder::new().recursive(true).mode(0o700).create(&dir)?;
    let path = dir.join(format!("kernel-explorateur-{}.json", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)?;
    file.write_all(&serde_json::to_vec(info).map_err(io::Error::other)?)?;
    Ok(path)
}

/// Fichier de connexion supprimé à la destruction tant qu'il n'est pas confié à la tâche du
/// noyau : échec, démarrage annulé (app qui quitte pendant « Démarrage… ») ou panic.
struct PendingConnectionFile(Option<PathBuf>);

impl PendingConnectionFile {
    fn path(&self) -> &Path {
        self.0.as_deref().unwrap_or(Path::new(""))
    }

    /// Le noyau répond : sa tâche supprimera le fichier.
    fn keep(mut self) -> PathBuf {
        self.0.take().unwrap_or_default()
    }
}

impl Drop for PendingConnectionFile {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = fs::remove_file(path);
        }
    }
}

/// Démarre le processus, attend sa réponse, puis lance la tâche qui le suit.
async fn start_kernel(params: Arc<Params>, launch: Launch) -> Result<Running> {
    let failed = |e: &dyn std::fmt::Display| AppError::KernelStartFailed(e.to_string());
    let ip = IpAddr::V4(Ipv4Addr::LOCALHOST);
    // Les ports restent tenus jusqu'au lancement du processus : un autre programme ne peut pas
    // les prendre entre-temps.
    let (ports, listeners) = peek_ports_with_listeners(ip, 5)
        .await
        .map_err(|e| failed(&e))?;
    let &[stdin_port, control_port, hb_port, shell_port, iopub_port] = ports.as_slice() else {
        return Err(failed(&"ports indisponibles"));
    };
    let info = ConnectionInfo {
        transport: Transport::TCP,
        ip: ip.to_string(),
        stdin_port,
        control_port,
        hb_port,
        shell_port,
        iopub_port,
        signature_scheme: "hmac-sha256".to_owned(),
        key: Uuid::new_v4().to_string(),
        kernel_name: None,
    };
    let connection_file =
        PendingConnectionFile(Some(write_connection_file(&info).map_err(|e| failed(&e))?));
    let file_arg = connection_file.path().to_string_lossy().into_owned();

    let mut cmd = Command::new(&launch.program);
    cmd.args(
        launch
            .args
            .iter()
            .map(|a| a.replace("{connection_file}", &file_arg)),
    )
    // Environnement de l'app, complété par celui du shell de connexion (vide en cas d'échec :
    // l'environnement hérité suffit alors à lancer Python).
    .envs(&params.login_env)
    .envs(launch.env.iter().map(|(k, v)| (k, v)))
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::piped())
    // Le processus est tué si sa tâche disparaît (app qui quitte sans arrêt propre).
    .kill_on_drop(true);
    if let Some(dir) = params.notebook_path.parent().filter(|d| d.is_dir()) {
        cmd.current_dir(dir);
    }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            return Err(if e.kind() == io::ErrorKind::NotFound {
                AppError::NoPythonEnv
            } else {
                failed(&e)
            });
        }
    };
    drop(listeners);
    let pid = child.id().unwrap_or_default();
    let stderr = StderrTail::default();
    let mut stderr_task = read_stderr(child.stderr.take(), Arc::clone(&stderr));

    let session = Uuid::new_v4().to_string();
    let mut last_error = None;
    // Une connexion peut être coupée pendant que le noyau ouvre ses sockets (« connection reset
    // by peer ») : on recommence jusqu'au délai de démarrage.
    let attempts = async {
        loop {
            match connect(&info, &session).await {
                Ok(channels) => return channels,
                Err(error) => last_error = Some(error),
            }
            tokio::time::sleep(CONNECT_RETRY).await;
        }
    };
    let outcome = tokio::select! {
        connected = tokio::time::timeout(START_TIMEOUT, attempts) => connected.map_err(|_| None),
        status = child.wait() => {
            let status = status.map_or_else(|e| e.to_string(), |s| s.to_string());
            Err(Some(status))
        }
    };
    let channels = match outcome {
        Ok(channels) => channels,
        Err(reason) => {
            let _ = child.kill().await;
            // Le processus est fini : la tâche de lecture s'arrête à la fin du tube.
            let _ = tokio::time::timeout(STDERR_DRAIN, &mut stderr_task).await;
            drop(connection_file);
            let tail = tail_text(&stderr);
            // La sortie d'erreur explique presque toujours l'échec ; sinon, la raison brute.
            let message = match (tail.is_empty(), reason) {
                (false, _) => tail,
                (true, Some(reason)) => reason,
                (true, None) => last_error
                    .unwrap_or_else(|| format!("aucune réponse en {} s", START_TIMEOUT.as_secs())),
            };
            return Err(AppError::KernelStartFailed(message));
        }
    };
    let connection_file = connection_file.keep();
    (params.sink)(KernelEvent::Status {
        state: KernelState::Idle,
    });

    let (orders, orders_rx) = mpsc::unbounded_channel();
    tokio::spawn(run_kernel(KernelTask {
        child,
        stderr,
        stderr_task,
        connection_file: connection_file.clone(),
        sink: Arc::clone(&params.sink),
        channels,
        orders: orders_rx,
    }));
    Ok(Running {
        pid,
        connection_file,
        orders,
        interrupt_by_message: launch.interrupt_by_message,
    })
}

/// Tout ce que possède la tâche d'un noyau démarré.
struct KernelTask {
    child: Child,
    stderr: StderrTail,
    stderr_task: JoinHandle<()>,
    connection_file: PathBuf,
    sink: EventSink,
    channels: Channels,
    orders: mpsc::UnboundedReceiver<Order>,
}

/// Exécution en cours, rattachée à sa cellule par le `msg_id` de son `execute_request`.
struct Pending {
    cell_id: String,
    /// Statut de l'`execute_reply` (canal shell), une fois reçu.
    reply: Option<ExecutionStatus>,
    /// `status: idle` de la même requête vu sur iopub : toutes ses sorties sont arrivées.
    idle: bool,
}

/// Boucle d'un noyau : ordres du front, messages iopub et shell, fin du processus.
async fn run_kernel(task: KernelTask) {
    let KernelTask {
        mut child,
        stderr,
        mut stderr_task,
        connection_file,
        sink,
        channels,
        mut orders,
    } = task;
    let Channels {
        mut shell,
        mut control,
        mut shell_rx,
        mut iopub_rx,
        _readers,
    } = channels;
    let mut pending: HashMap<String, Pending> = HashMap::new();

    loop {
        tokio::select! {
            order = orders.recv() => match order {
                Some(Order::Execute { cell_id, code }) => {
                    let request: JupyterMessage = ExecuteRequest {
                        code,
                        silent: false,
                        store_history: true,
                        user_expressions: None,
                        // Sans stdin : `input()` lève une erreur au lieu de bloquer le noyau.
                        allow_stdin: false,
                        // Après une erreur, le noyau répond `aborted` aux requêtes en attente.
                        stop_on_error: true,
                    }
                    .into();
                    // Inscrite avant l'envoi : une réponse `aborted` peut arriver aussitôt.
                    pending.insert(
                        request.header.msg_id.clone(),
                        Pending { cell_id, reply: None, idle: false },
                    );
                    let _ = shell.send(request).await;
                }
                Some(Order::Interrupt) => {
                    let _ = control.send(InterruptRequest {}.into()).await;
                }
                Some(Order::Shutdown { done }) => {
                    let _ = control.send(ShutdownRequest { restart: false }.into()).await;
                    if tokio::time::timeout(SHUTDOWN_GRACE, child.wait()).await.is_err() {
                        // `Child::kill` envoie `SIGKILL` et attend la fin du processus.
                        let _ = child.kill().await;
                    }
                    let _ = fs::remove_file(&connection_file);
                    sink(KernelEvent::Status { state: KernelState::Dead });
                    let _ = done.send(());
                    return;
                }
                // `KernelSessions` a disparu sans arrêt : `kill_on_drop` tue le processus.
                None => {
                    let _ = fs::remove_file(&connection_file);
                    return;
                }
            },
            Some(msg) = iopub_rx.recv() => on_iopub(msg, &mut pending, &sink),
            Some(msg) = shell_rx.recv() => on_shell(msg, &mut pending, &sink),
            status = child.wait() => {
                let _ = tokio::time::timeout(STDERR_DRAIN, &mut stderr_task).await;
                let _ = fs::remove_file(&connection_file);
                let tail = tail_text(&stderr);
                let message = match (tail.is_empty(), status) {
                    (false, _) => tail,
                    (true, Ok(status)) => status.to_string(),
                    (true, Err(error)) => error.to_string(),
                };
                sink(KernelEvent::Status { state: KernelState::Dead });
                sink(KernelEvent::Died { message });
                return;
            }
        }
    }
}

/// Message iopub : état, compteur, sorties. Seuls ceux d'une exécution en cours comptent
/// (les `kernel_info_request` du démarrage produisent aussi des états).
fn on_iopub(msg: Incoming, pending: &mut HashMap<String, Pending>, sink: &EventSink) {
    let Some(parent) = msg.parent_id else { return };
    let Some(exec) = pending.get_mut(&parent) else {
        return;
    };
    let cell_id = exec.cell_id.clone();
    let content = &msg.content;
    match msg.msg_type.as_str() {
        "status" => match content.get("execution_state").and_then(Value::as_str) {
            Some("busy") => sink(KernelEvent::Status {
                state: KernelState::Busy,
            }),
            Some("idle") => {
                exec.idle = true;
                sink(KernelEvent::Status {
                    state: KernelState::Idle,
                });
                finish_if_done(&parent, pending, sink);
            }
            _ => {}
        },
        "execute_input" => {
            if let Some(execution_count) = content.get("execution_count").and_then(Value::as_i64) {
                sink(KernelEvent::ExecutionStarted {
                    cell_id,
                    execution_count,
                });
            }
        }
        "clear_output" => sink(KernelEvent::ClearOutput {
            cell_id,
            wait: content
                .get("wait")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        }),
        other => {
            if let Some(output) = nbformat_output(other, content) {
                sink(KernelEvent::Output { cell_id, output });
            }
        }
    }
}

/// Message shell : seule la réponse à un `execute_request` compte ici.
fn on_shell(msg: Incoming, pending: &mut HashMap<String, Pending>, sink: &EventSink) {
    if msg.msg_type != "execute_reply" {
        return;
    }
    let Some(parent) = msg.parent_id else { return };
    let Some(exec) = pending.get_mut(&parent) else {
        return;
    };
    exec.reply = Some(match msg.content.get("status").and_then(Value::as_str) {
        Some("ok") => ExecutionStatus::Ok,
        Some("aborted") => ExecutionStatus::Aborted,
        _ => ExecutionStatus::Error,
    });
    finish_if_done(&parent, pending, sink);
}

/// Émet `ExecutionFinished` quand la réponse (shell) et l'état `idle` (iopub) sont là, dans
/// n'importe quel ordre : shell et iopub sont deux sockets, la réponse peut arriver avant les
/// dernières sorties. Une requête `aborted` n'a pas de sortie : la réponse suffit.
fn finish_if_done(msg_id: &str, pending: &mut HashMap<String, Pending>, sink: &EventSink) {
    let Some(exec) = pending.get(msg_id) else {
        return;
    };
    let status = match exec.reply {
        Some(ExecutionStatus::Aborted) => ExecutionStatus::Aborted,
        Some(status) if exec.idle => status,
        _ => return,
    };
    if let Some(exec) = pending.remove(msg_id) {
        sink(KernelEvent::ExecutionFinished {
            cell_id: exec.cell_id,
            status,
        });
    }
}
