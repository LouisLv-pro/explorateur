//! Notebooks Jupyter (spec `notebook.md`, décision 0024) : environnements Python trouvés sur le
//! disque et noyaux lancés par l'app. La lecture du fichier est dans `preview`, le rendu et
//! l'édition dans le front.

mod envs;
mod kernel;

pub use envs::{EnvSearch, PythonEnv, PythonEnvKind, list_python_envs};
pub use kernel::{
    EventSink, ExecutionStatus, KernelEvent, KernelId, KernelSessions, KernelState,
    login_shell_env, nbformat_output,
};
