//! Git : statut du dépôt du dossier racine et diffs de ses fichiers (spec `git.md`, lot 1).
//!
//! Appelle le `git` de l'utilisateur, sans shell (décision 0007 de l'app) : `command.rs`
//! (lancement, dépôt du dossier racine), `status.rs` (liste des modifications), `diff.rs`
//! (blocs, contexte masqué, mots surlignés par la crate `similar`).

mod command;
mod diff;
mod link;
mod marks;
mod remote;
mod status;
mod write;

use std::path::PathBuf;
use std::time::Duration;

pub(crate) use diff::{MAX_DIFF_LINES, mark_word_changes};
pub use link::FileLinkInfo;
pub use marks::{GutterBlock, GutterKind, PathMark, PathStatuses};
pub use remote::{RemoteErrorKind, RemoteState, classify_remote_error};
pub use write::CommitOptions;

use serde::{Deserialize, Serialize};

use crate::Result;

/// Racine du dépôt git (`--show-toplevel`) qui contient `root`. `None` hors d'un dépôt, si git
/// est absent ou en cas d'erreur : l'appelant (modèles d'issue) n'a pas besoin de la raison.
pub fn repo_top(git: &Git, root: &std::path::Path) -> Option<PathBuf> {
    match command::locate(git, &root.to_string_lossy()) {
        Ok(command::Located::Repo(location)) => Some(location.top),
        _ => None,
    }
}

/// Délai des commandes réseau (récupérer, pousser, tirer) : au-delà, git est arrêté.
pub const NETWORK_TIMEOUT: Duration = Duration::from_secs(60);

/// Programme git appelé. `Git::new` permet d'en désigner un autre (tests : git absent).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Git {
    pub program: PathBuf,
    network_timeout: Duration,
}

impl Git {
    /// Git à ce chemin (absolu, ou nom cherché dans le `PATH`).
    pub fn new(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            network_timeout: NETWORK_TIMEOUT,
        }
    }

    /// Même git, avec un autre délai pour les commandes réseau (tests).
    #[must_use]
    pub fn with_network_timeout(mut self, timeout: Duration) -> Self {
        self.network_timeout = timeout;
        self
    }
}

/// État git du dossier racine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RepoStatus {
    /// Le dossier racine n'est dans aucun dépôt.
    NotARepo,
    /// Le programme git n'existe pas. Porte le chemin cherché.
    GitNotFound { path: String },
    /// Dépôt trouvé : branche courante et modifications par section, chacune triée par
    /// chemin, les fichiers hors du dossier racine en fin de section.
    Repo {
        head: Head,
        /// Section « Indexées » : HEAD comparé à l'index.
        staged: Vec<FileChange>,
        /// Section « Modifications » : index comparé au disque, non suivis et conflits.
        unstaged: Vec<FileChange>,
    },
}

/// Branche courante, ou HEAD détaché.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Head {
    /// Branche courante (aussi sans commit encore).
    Branch { name: String },
    /// HEAD détaché : hash court du commit (`git rev-parse --short HEAD`).
    Detached { short_hash: String },
}

/// Statut d'une modification, exporté par sa lettre.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum ChangeStatus {
    #[serde(rename = "M")]
    Modified,
    #[serde(rename = "A")]
    Added,
    #[serde(rename = "D")]
    Deleted,
    #[serde(rename = "R")]
    Renamed,
    #[serde(rename = "U")]
    Untracked,
    #[serde(rename = "!")]
    Conflict,
}

/// Une ligne de la liste des modifications. Le front la renvoie telle quelle à `get_diff`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// Chemin affiché, séparé par `/` : relatif au dossier racine, ou au dépôt si le fichier
    /// est hors du dossier racine.
    pub path: String,
    /// Chemin relatif au dépôt (celui que git attend).
    pub repo_path: String,
    /// Renommé : ancien chemin affiché (même convention que `path`).
    pub orig_path: Option<String>,
    /// Renommé : ancien chemin relatif au dépôt.
    pub orig_repo_path: Option<String>,
    pub status: ChangeStatus,
    /// Vrai dans la section « Indexées ».
    pub staged: bool,
    /// Lignes ajoutées (`+N`). Un non suivi compte toutes ses lignes.
    pub added: u32,
    /// Lignes supprimées (`−M`).
    pub removed: u32,
    /// Fichier du dépôt hors du dossier racine (intertitre « Hors du dossier »).
    pub outside_root: bool,
}

/// Diff d'un fichier : HEAD et index (indexé), ou index et disque (non indexé).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    /// Changement de mode (`chmod`) : ancien mode (`100644`), sinon `None`.
    pub old_mode: Option<String>,
    /// Changement de mode : nouveau mode (`100755`), sinon `None`.
    pub new_mode: Option<String>,
    pub content: DiffContent,
}

/// Contenu d'un diff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DiffContent {
    /// Diff texte en blocs (contexte de 3 lignes).
    Text {
        hunks: Vec<Hunk>,
        /// Lignes masquées après le dernier bloc, jusqu'à la fin du fichier.
        hidden_after: u32,
        /// Nombre de lignes de tous les blocs (contexte, ajoutées, supprimées).
        line_count: u32,
        /// Plus de 2 000 lignes : replié avec « Afficher le diff (N lignes) ».
        too_long: bool,
    },
    /// Fichier binaire : tailles en octets avant et après (`None` si absent de ce côté).
    Binary {
        #[specta(type = Option<i32>)]
        old_size: Option<u64>,
        #[specta(type = Option<i32>)]
        new_size: Option<u64>,
    },
    /// Contenu identique (renommage ou changement de mode seul).
    Identical,
}

/// Bloc d'un diff. Le front le renvoie tel quel pour indexer, désindexer ou annuler ce bloc.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    /// Première ligne de l'ancienne version (0 si elle n'a aucune ligne), comme `@@ -a,b`.
    pub old_start: u32,
    pub old_count: u32,
    /// Première ligne de la nouvelle version (0 si elle n'a aucune ligne), comme `+c,d @@`.
    pub new_start: u32,
    pub new_count: u32,
    /// Lignes masquées avant ce bloc (depuis le bloc précédent ou le début du fichier).
    pub hidden_before: u32,
    pub lines: Vec<DiffLine>,
}

/// Une ligne d'un bloc.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    /// Numéro dans l'ancienne version (absent pour une ligne ajoutée).
    pub old_number: Option<u32>,
    /// Numéro dans la nouvelle version (absent pour une ligne supprimée).
    pub new_number: Option<u32>,
    /// Texte sans le préfixe `+`/`-`/espace ni la fin de ligne.
    pub text: String,
    /// Suivie de `\ No newline at end of file`.
    pub no_newline: bool,
    /// Mots surlignés : plages de caractères changés par rapport à la ligne appariée, en
    /// unités UTF-16 (indices de chaîne JavaScript). Vide pour le contexte et une ligne sans
    /// ligne appariée.
    pub changes: Vec<CharRange>,
}

/// Type d'une ligne de diff.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    Context,
    Added,
    Removed,
}

/// Plage `[start, end)` en unités UTF-16.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct CharRange {
    pub start: u32,
    pub end: u32,
}

/// Statut et repères du dépôt, lus par un seul `git status` (spec `gros-depots.md`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitSnapshot {
    /// Ce que rend `get_status`.
    pub status: RepoStatus,
    /// Ce que rend `get_path_statuses`.
    pub marks: PathStatuses,
}

/// Statut et repères de l'arborescence en un seul `git status` : `get_status` et
/// `get_path_statuses` en sont chacun une moitié. Hors dépôt et git absent : états du statut,
/// repères vides.
pub fn get_snapshot(git: &Git, root: &str) -> Result<GitSnapshot> {
    status::get_snapshot(git, root)
}

/// Statut du dépôt qui contient `root` (`git status --porcelain=v2`, `git diff --numstat`).
/// Hors dépôt et git absent sont des états, pas des erreurs. Un dossier non suivi de plus de
/// 50 fichiers est une seule modification (chemin à `/` final, compteurs à 0).
pub fn get_status(git: &Git, root: &str) -> Result<RepoStatus> {
    Ok(status::get_snapshot(git, root)?.status)
}

/// Diff de `change` : HEAD et index s'il est indexé, index et disque sinon ; un non suivi
/// est tout ajouté.
pub fn get_diff(git: &Git, root: &str, change: &FileChange) -> Result<Diff> {
    diff::get_diff(git, root, change)
}

/// Lignes masquées (contexte) du diff de `change` : `gap` vaut `i` pour celles avant le bloc
/// `i`, et le nombre de blocs pour celles après le dernier.
pub fn get_hidden_lines(
    git: &Git,
    root: &str,
    change: &FileChange,
    gap: u32,
) -> Result<Vec<DiffLine>> {
    diff::get_hidden_lines(git, root, change, gap)
}

/// Indexe `change` (« Indexer ») : modifié, supprimé, non suivi, ou conflit (marqué résolu).
pub fn stage_file(git: &Git, root: &str, change: &FileChange) -> Result<()> {
    write::stage_file(git, root, change)
}

/// Désindexe `change` (« Désindexer ») : l'index revient à HEAD pour ce fichier (et l'ancien
/// chemin d'un renommage) ; sans commit, le fichier sort de l'index. Le disque ne change pas.
pub fn unstage_file(git: &Git, root: &str, change: &FileChange) -> Result<()> {
    write::unstage_file(git, root, change)
}

/// « Tout indexer » : toutes les modifications du dépôt, non suivies et hors du dossier
/// racine comprises.
pub fn stage_all(git: &Git, root: &str) -> Result<()> {
    write::stage_all(git, root)
}

/// « Tout désindexer » : l'index revient à HEAD (vide sans commit). Le disque ne change pas.
pub fn unstage_all(git: &Git, root: &str) -> Result<()> {
    write::unstage_all(git, root)
}

/// Indexe le seul bloc `hunk` du diff non indexé de `change` (patch construit en Rust,
/// `git apply --cached`). Le disque ne change pas. Bloc périmé : `AppError::Git`, rien change.
pub fn stage_hunk(git: &Git, root: &str, change: &FileChange, hunk: &Hunk) -> Result<()> {
    write::stage_hunk(git, root, change, hunk)
}

/// Désindexe le seul bloc `hunk` du diff indexé de `change` (`git apply --cached --reverse`).
pub fn unstage_hunk(git: &Git, root: &str, change: &FileChange, hunk: &Hunk) -> Result<()> {
    write::unstage_hunk(git, root, change, hunk)
}

/// « Annuler les modifications » de `change` (section « Modifications ») : un fichier suivi
/// revient à sa version indexée (l'index ne change pas) ; un non suivi est passé à `trash`
/// par son chemin absolu (`files::move_to_trash` dans l'app), jamais supprimé.
pub fn discard_file(
    git: &Git,
    root: &str,
    change: &FileChange,
    trash: &dyn Fn(&str) -> Result<()>,
) -> Result<()> {
    write::discard_file(git, root, change, trash)
}

/// Annule le seul bloc `hunk` du diff non indexé de `change` sur le disque
/// (`git apply --reverse`). L'index et les autres blocs ne changent pas.
pub fn discard_hunk(git: &Git, root: &str, change: &FileChange, hunk: &Hunk) -> Result<()> {
    write::discard_hunk(git, root, change, hunk)
}

/// Committe l'index (`git commit -F -`, message sur l'entrée standard) et rend le hash court
/// du commit créé. Échec (hook, identité, rien à committer) : `AppError::Git` avec la sortie
/// de git, aucun commit créé.
pub fn commit(git: &Git, root: &str, message: &str, options: CommitOptions) -> Result<String> {
    write::commit(git, root, message, options)
}

/// Repères de l'arborescence et des onglets (lot 3) : fichiers modifiés, dossiers qui en
/// contiennent, entrées ignorées, sous `root` seulement. Hors dépôt ou git absent : vide.
pub fn get_path_statuses(git: &Git, root: &str) -> Result<PathStatuses> {
    status::get_path_statuses(git, root)
}

/// Fichiers de `root` que git ne traite pas comme ignorés (`git ls-files -co
/// --exclude-standard`, lancé dans `root`) : suivis et non suivis, chemins relatifs à `root`
/// séparés par `/`, sans doublon. Un fichier suivi supprimé du disque y figure encore : à
/// l'appelant de vérifier le disque. `None` hors dépôt, git absent ou en cas d'échec.
pub(crate) fn list_unignored_files(git: &Git, root: &str) -> Option<Vec<String>> {
    // `-z` : chemins séparés par un octet nul, rendus tels quels.
    let out = git
        .output(
            std::path::Path::new(root),
            &["ls-files", "-co", "--exclude-standard", "-z"],
        )
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let mut files: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .collect();
    // Un conflit liste le même fichier à plusieurs étapes, l'une après l'autre.
    files.dedup();
    Some(files)
}

/// Texte indexé (`git show :<chemin>`) du fichier `path`, relatif à `root` : base de la
/// gouttière. `None` si le fichier n'est pas dans l'index (non suivi, supprimé de l'index),
/// hors dépôt ou git absent.
pub fn get_index_text(git: &Git, root: &str, path: &str) -> Result<Option<String>> {
    marks::get_index_text(git, root, path)
}

/// Chemin dans le dépôt, hash de HEAD, fichier suivi / modifié : de quoi fabriquer le lien
/// GitHub de `path` (relatif à `root`). `None` hors dépôt ou git absent.
pub fn file_link_info(git: &Git, root: &str, path: &str) -> Result<Option<FileLinkInfo>> {
    link::file_link_info(git, root, path)
}

/// Blocs de la gouttière entre le texte indexé et le texte de l'éditeur, dans l'ordre des
/// lignes (fonction pure, diff de lignes `similar`).
pub fn gutter_blocks(index_text: &str, editor_text: &str) -> Vec<GutterBlock> {
    marks::gutter_blocks(index_text, editor_text)
}

/// État réseau de la branche courante (amont, `↑A ↓B`, ou branche à publier), lu sur le
/// disque sans appel réseau : les nombres comparent à la dernière récupération.
pub fn get_remote_state(git: &Git, root: &str) -> Result<RemoteState> {
    remote::get_remote_state(git, root)
}

/// Récupère le distant (`git fetch --prune`) : remote de l'amont, sinon `origin`, sinon le
/// seul remote. Délai : `NETWORK_TIMEOUT`.
pub fn git_fetch(git: &Git, root: &str) -> Result<()> {
    remote::git_fetch(git, root)
}

/// Pousse la branche courante vers son amont (`git push`, hooks `pre-push` compris) ; sans
/// amont, la publie (`git push -u <remote> <branche>`).
pub fn git_push(git: &Git, root: &str) -> Result<()> {
    remote::git_push(git, root)
}

/// Tire l'amont en fast-forward (`git pull --ff-only`) et rend le nombre de commits tirés.
pub fn git_pull(git: &Git, root: &str) -> Result<u32> {
    remote::git_pull(git, root)
}

/// Message complet du dernier commit, sans le saut de ligne final (`None` sans commit).
pub fn last_commit_message(git: &Git, root: &str) -> Result<Option<String>> {
    write::last_commit_message(git, root)
}
