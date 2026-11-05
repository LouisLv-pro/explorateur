use std::io;

use serde::Serialize;

/// Erreurs de l'app. Sérialisées vers le front : `{ kind, message }`.
#[derive(Debug, thiserror::Error, Serialize, specta::Type)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("base de données : {0}")]
    Database(String),
    /// Le chemin n'existe pas (ou n'est pas absolu). Porte le chemin demandé.
    #[error("introuvable : {0}")]
    NotFound(String),
    /// Un fichier là où un dossier est attendu. Porte le chemin demandé.
    #[error("pas un dossier : {0}")]
    NotADirectory(String),
    /// Un dossier là où un fichier est attendu. Porte le chemin demandé.
    #[error("pas un fichier : {0}")]
    NotAFile(String),
    /// macOS refuse l'accès. Porte le chemin demandé.
    #[error("accès refusé : {0}")]
    PermissionDenied(String),
    /// Une entrée de ce nom existe déjà. Porte le chemin demandé.
    #[error("existe déjà : {0}")]
    AlreadyExists(String),
    /// Nom de fichier ou de dossier refusé (vide, `.`, `..`, `/`, nul). Porte le nom saisi.
    #[error("nom invalide : {0}")]
    InvalidName(String),
    /// Le fichier a changé sur le disque depuis sa lecture : rien n'est écrit. Porte le chemin.
    #[error("modifié sur le disque : {0}")]
    Conflict(String),
    /// Une commande git d'écriture a échoué (hook, identité absente, rien à committer, patch
    /// refusé). Porte la sortie de git (standard et d'erreur), affichée telle quelle.
    #[error("git : {0}")]
    Git(String),
    /// Un geste réseau git a échoué (récupérer, pousser, tirer : spec `git-distant.md`).
    /// `kind` est le genre reconnu, `output` la sortie de git telle quelle (vide pour
    /// `NoRemote`, `AmbiguousRemote` et `Timeout`).
    #[error("git distant : {output}")]
    Remote {
        kind: crate::git::RemoteErrorKind,
        output: String,
    },
    /// Les issues GitHub ne sont pas disponibles (spec `issues-github.md`) : le front affiche
    /// le message de la raison.
    #[error("GitHub indisponible : {0:?}")]
    GithubUnavailable(crate::github::GithubUnavailable),
    /// L'issue demandée n'existe pas (supprimée, transférée). Le front connaît son numéro.
    #[error("issue introuvable")]
    IssueNotFound,
    /// Autre échec de `gh` (ou sortie illisible) : sa sortie d'erreur, telle quelle.
    #[error("gh : {0}")]
    Gh(String),
    /// Adresse refusée par le champ d'URL du navigateur (spec `navigateur.md`). Porte le genre
    /// du refus, traduit par le front.
    #[error("adresse refusée : {0:?}")]
    InvalidUrl(crate::browser::UrlError),
    /// Échec du navigateur intégré (webview impossible à créer ou à placer).
    #[error("navigateur : {0}")]
    Browser(String),
    /// App lancée hors d'un paquet `.app` (`tauri dev`) : impossible d'en faire l'app par
    /// défaut d'un type (spec `app-par-defaut.md`). Rien n'est demandé à macOS.
    #[error("app lancée hors d'un paquet .app")]
    NotBundled,
    /// Noyau Jupyter inconnu (identifiant jamais donné, déjà arrêté, ou mort).
    #[error("noyau introuvable")]
    KernelNotFound,
    /// Le noyau n'a pas démarré (sorti tout de suite, ou muet pendant 30 s). Porte la fin de
    /// sa sortie d'erreur telle quelle (ou son statut de sortie si elle est vide).
    #[error("démarrage du noyau : {0}")]
    KernelStartFailed(String),
    /// Environnement Python introuvable, ou sans `ipykernel` (spec `notebook.md`).
    #[error("aucun Python avec ipykernel")]
    NoPythonEnv,
    /// Autre erreur d'entrée-sortie.
    #[error("lecture du disque : {0}")]
    Io(String),
    /// Échec dont la phrase est écrite par l'app : Rust n'envoie que le genre et les données
    /// brutes, le front traduit (spec `langue-interface.md`).
    #[error("{0}")]
    Failed(Failure),
}

/// Genre d'un échec décrit par l'app. Sérialisé `{ reason, detail }` : `detail` porte le texte
/// brut de l'outil ou du système, jamais une phrase de l'app.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize, specta::Type)]
#[serde(tag = "reason", content = "detail", rename_all = "camelCase")]
pub enum Failure {
    /// Tâche de fond interrompue (panique). Porte l'erreur de tokio.
    #[error("tâche interrompue : {0}")]
    Interrupted(String),
    /// Outil introuvable ou impossible à lancer.
    #[error("{tool} introuvable : {error}")]
    ToolNotFound { tool: String, error: String },
    /// Outil qui n'a pas répondu à temps. Porte son nom.
    #[error("{0} : délai dépassé")]
    ToolTimeout(String),
    /// Sortie d'un outil illisible. `error` : texte de l'analyseur, vide si la valeur manque.
    #[error("sortie illisible de {tool} : {error}")]
    UnreadableOutput { tool: String, error: String },
    #[error("SDK Android introuvable")]
    AndroidSdkNotFound,
    #[error("appareil Android introuvable")]
    AndroidDeviceNotFound,
    #[error("Flutter introuvable")]
    FlutterNotFound,
    #[error(
        "Flutter ne répond pas : lancez « flutter devices » une fois dans un terminal, puis \
         actualisez"
    )]
    FlutterTimeout,
    /// Dossier hors d'un dépôt git. Porte le dossier.
    #[error("pas un dépôt git : {0}")]
    NotARepo(String),
    /// HEAD détaché : aucune branche à pousser.
    #[error("HEAD détaché : aucune branche à pousser")]
    DetachedHead,
    /// Un fichier non suivi s'annule en entier (corbeille), pas par bloc.
    #[error("un fichier non suivi s'annule en entier")]
    UntrackedHunk,
    /// Dossier de cache de l'app introuvable. Porte l'erreur de Tauri.
    #[error("dossier de cache introuvable : {0}")]
    CacheDirNotFound(String),
    /// Cible sans commande de lancement. Porte son libellé.
    #[error("aucune commande pour la cible {0}")]
    NoCommand(String),
    /// Menu natif impossible à construire. Porte l'erreur de Tauri.
    #[error("menu natif : {0}")]
    NativeMenu(String),
    /// Onglet du navigateur inconnu. Porte son identifiant.
    #[error("onglet inconnu : {0}")]
    UnknownTab(String),
    #[error("fenêtre principale introuvable")]
    MainWindowNotFound,
}

impl From<Failure> for AppError {
    fn from(failure: Failure) -> Self {
        Self::Failed(failure)
    }
}

impl Failure {
    /// Tâche de fond interrompue, d'après l'erreur de `spawn_blocking`.
    pub fn interrupted(err: impl std::fmt::Display) -> AppError {
        Self::Interrupted(err.to_string()).into()
    }
}

impl AppError {
    /// Traduit une erreur d'entrée-sortie sur `path` en erreur de l'app.
    pub fn from_io(err: &io::Error, path: &str) -> Self {
        match err.kind() {
            io::ErrorKind::NotFound => Self::NotFound(path.to_owned()),
            io::ErrorKind::PermissionDenied => Self::PermissionDenied(path.to_owned()),
            io::ErrorKind::NotADirectory => Self::NotADirectory(path.to_owned()),
            _ => Self::Io(format!("{path}: {err}")),
        }
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        Self::Database(err.to_string())
    }
}

impl From<sqlx::migrate::MigrateError> for AppError {
    fn from(err: sqlx::migrate::MigrateError) -> Self {
        Self::Database(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
