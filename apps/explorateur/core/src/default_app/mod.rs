//! App par défaut (spec `app-par-defaut.md`) : groupes d'extensions qu'explorateur peut ouvrir,
//! et leur état d'après macOS. Les appels à macOS (UTI d'une extension, app qui l'ouvre) sont
//! dans src-tauri ; ici, seulement la table et le regroupement par type (UTI).

use serde::Serialize;

/// Groupe de types proposé dans le dialogue, dans l'ordre d'affichage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Group {
    /// Markdown et texte.
    Text,
    /// Données (CSV, JSON, YAML…).
    Data,
    Html,
    Code,
}

/// Extensions de chaque groupe, dans l'ordre d'affichage. Exactement celles de
/// `bundle.fileAssociations` (`src-tauri/tauri.conf.json`) : un test le vérifie.
pub const GROUPS: &[(Group, &[&str])] = &[
    (Group::Text, &["md", "markdown", "txt", "log"]),
    (
        Group::Data,
        &[
            "csv", "json", "jsonc", "yaml", "yml", "toml", "xml", "ini", "conf",
        ],
    ),
    (Group::Html, &["html", "htm"]),
    (
        Group::Code,
        &[
            "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "swift", "kt", "go", "rb", "php",
            "java", "c", "h", "cpp", "hpp", "cs", "sh", "bash", "zsh", "css", "scss", "sql", "lua",
            "vue", "svelte",
        ],
    ),
];

/// État d'une extension d'après macOS, fourni par src-tauri : son UTI, et si explorateur
/// l'ouvre déjà.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeStatus {
    pub ext: String,
    pub uti: String,
    pub is_default: bool,
}

/// Type (UTI) pas encore ouvert par explorateur, avec les extensions de la table qui le
/// partagent (une seule confirmation de macOS pour elles).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PendingType {
    pub uti: String,
    pub extensions: Vec<String>,
}

/// État d'un groupe : nombre de types distincts, combien sont déjà à explorateur, et ceux qui
/// restent à demander, dans l'ordre de la table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupStatus {
    pub group: Group,
    /// Toutes les extensions du groupe dans la table, même sans statut.
    pub extensions: Vec<String>,
    pub types: u32,
    pub default_types: u32,
    pub pending: Vec<PendingType>,
}

/// Regroupe les statuts par groupe de la table. Une extension absente de `statuses` est
/// ignorée ; un statut hors de la table aussi.
pub fn group_statuses(statuses: &[TypeStatus]) -> Vec<GroupStatus> {
    GROUPS
        .iter()
        .map(|(group, exts)| group_status(*group, exts, statuses))
        .collect()
}

/// Un type du groupe : UTI, extensions qui le partagent, et s'il est déjà à explorateur.
struct TypeEntry {
    uti: String,
    extensions: Vec<String>,
    is_default: bool,
}

fn group_status(group: Group, exts: &[&str], statuses: &[TypeStatus]) -> GroupStatus {
    let mut entries: Vec<TypeEntry> = Vec::new();
    for ext in exts {
        let Some(status) = statuses.iter().find(|s| s.ext == *ext) else {
            continue;
        };
        if let Some(entry) = entries.iter_mut().find(|e| e.uti == status.uti) {
            entry.extensions.push((*ext).to_owned());
            // Prudence : un type n'est fait que si toutes ses extensions le disent.
            entry.is_default &= status.is_default;
        } else {
            entries.push(TypeEntry {
                uti: status.uti.clone(),
                extensions: vec![(*ext).to_owned()],
                is_default: status.is_default,
            });
        }
    }
    let types = count(entries.len());
    let default_types = count(entries.iter().filter(|e| e.is_default).count());
    let pending = entries
        .into_iter()
        .filter(|e| !e.is_default)
        .map(|e| PendingType {
            uti: e.uti,
            extensions: e.extensions,
        })
        .collect();
    GroupStatus {
        group,
        extensions: exts.iter().map(|e| (*e).to_owned()).collect(),
        types,
        default_types,
        pending,
    }
}

/// Un groupe a au plus quelques dizaines de types : la conversion ne déborde pas.
fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}
