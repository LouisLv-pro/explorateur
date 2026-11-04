//! Statut du dépôt : `git status --porcelain=v2 -z` et `git diff --numstat -z`. Un seul
//! `git status` sert la liste des modifications et les repères (spec `gros-depots.md`).

use std::collections::HashMap;
use std::fs;

use super::command::{Located, Location, locate};
use super::marks::build_marks;
use super::{ChangeStatus, FileChange, Git, GitSnapshot, Head, PathStatuses, RepoStatus};
use crate::Result;
use crate::preview::MAX_TEXT_BYTES;

/// Octets lus pour reconnaître un fichier binaire (la règle de git : un octet nul au début).
const BINARY_SNIFF: usize = 8000;

/// Un dossier non suivi de plus de fichiers que cela reste une seule modification (replié).
const MAX_UNFOLDED_FILES: usize = 50;

/// Lecture d'un `git status` : le dépôt et ses entrées (dossiers non suivis dépliés ou
/// repliés), avant les compteurs.
struct Scan {
    location: Location,
    parsed: Porcelain,
}

enum Scanned {
    Repo(Scan),
    NotARepo,
    GitNotFound,
}

/// Lance l'unique `git status` du dépôt (tout le dépôt, ignorés compris). Les dossiers non
/// suivis arrivent d'abord repliés (`--untracked-files=normal`), puis ceux de 50 fichiers au
/// plus sont dépliés.
fn scan(git: &Git, root: &str) -> Result<Scanned> {
    let location = match locate(git, root)? {
        Located::Repo(location) => location,
        Located::NotARepo => return Ok(Scanned::NotARepo),
        Located::GitNotFound => return Ok(Scanned::GitNotFound),
    };
    let raw = git.run(
        &location.top,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "--find-renames",
            "--ignored=matching",
            "--untracked-files=normal",
        ],
        false,
    )?;
    let mut parsed = parse_porcelain(&String::from_utf8_lossy(&raw));
    parsed.entries = unfold_small_dirs(git, &location, parsed.entries);
    Ok(Scanned::Repo(Scan { location, parsed }))
}

/// Remplace chaque dossier non suivi de 50 fichiers au plus par ses fichiers. Si git échoue
/// pour un dossier, il reste replié, sans erreur.
fn unfold_small_dirs(git: &Git, location: &Location, entries: Vec<Entry>) -> Vec<Entry> {
    let mut unfolded = Vec::with_capacity(entries.len());
    for entry in entries {
        if entry.status != ChangeStatus::Untracked || !entry.repo_path.ends_with('/') {
            unfolded.push(entry);
            continue;
        }
        match untracked_files(git, location, &entry.repo_path) {
            Some(files) if !files.is_empty() && files.len() <= MAX_UNFOLDED_FILES => {
                unfolded.extend(files.into_iter().map(|repo_path| Entry {
                    repo_path,
                    orig_repo_path: None,
                    status: ChangeStatus::Untracked,
                    staged: false,
                }));
            }
            _ => unfolded.push(entry),
        }
    }
    unfolded
}

/// Fichiers non suivis et non ignorés sous `dir` (chemin du dépôt, `/` final), sous-dossiers
/// compris. `None` si git échoue. Lit toute la sortie : l'arrêter à 51 fichiers demanderait
/// de lancer git à la main (lecture du tube, puis arrêt du processus).
fn untracked_files(git: &Git, location: &Location, dir: &str) -> Option<Vec<String>> {
    let raw = git
        .run(
            &location.top,
            &["ls-files", "-o", "--exclude-standard", "-z", "--", dir],
            false,
        )
        .ok()?;
    Some(
        String::from_utf8_lossy(&raw)
            .split('\0')
            .filter(|path| !path.is_empty())
            .map(str::to_owned)
            .collect(),
    )
}

/// Statut et repères d'un seul `git status`. Hors dépôt et git absent : états du statut,
/// repères vides.
pub(super) fn get_snapshot(git: &Git, root: &str) -> Result<GitSnapshot> {
    match scan(git, root)? {
        Scanned::Repo(scan) => {
            let marks = build_marks(&scan.parsed, &scan.location.prefix);
            let status = build_status(git, scan)?;
            Ok(GitSnapshot { status, marks })
        }
        Scanned::NotARepo => Ok(GitSnapshot {
            status: RepoStatus::NotARepo,
            marks: PathStatuses::default(),
        }),
        Scanned::GitNotFound => Ok(GitSnapshot {
            status: RepoStatus::GitNotFound {
                path: git.program.display().to_string(),
            },
            marks: PathStatuses::default(),
        }),
    }
}

/// Repères seuls : même `git status`, sans les compteurs de lignes.
pub(super) fn get_path_statuses(git: &Git, root: &str) -> Result<PathStatuses> {
    match scan(git, root)? {
        Scanned::Repo(scan) => Ok(build_marks(&scan.parsed, &scan.location.prefix)),
        Scanned::NotARepo | Scanned::GitNotFound => Ok(PathStatuses::default()),
    }
}

/// Statut complet : branche, puis les modifications avec leurs compteurs de lignes.
fn build_status(git: &Git, scan: Scan) -> Result<RepoStatus> {
    let Scan { location, parsed } = scan;
    let head = match parsed.branch {
        Some(name) => Head::Branch { name },
        None => {
            let hash = git.run(&location.top, &["rev-parse", "--short", "HEAD"], false)?;
            Head::Detached {
                short_hash: String::from_utf8_lossy(&hash).trim().to_owned(),
            }
        }
    };
    let staged_counts = numstat(git, &location, true)?;
    let unstaged_counts = numstat(git, &location, false)?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    for entry in parsed.entries {
        let (counts, list) = if entry.staged {
            (&staged_counts, &mut staged)
        } else {
            (&unstaged_counts, &mut unstaged)
        };
        let (added, removed) = if entry.status == ChangeStatus::Untracked {
            count_file_lines(&location, &entry.repo_path)
        } else {
            counts.get(&entry.repo_path).copied().unwrap_or((0, 0))
        };
        list.push(file_change(&location.prefix, entry, added, removed));
    }
    sort_section(&mut staged);
    sort_section(&mut unstaged);
    Ok(RepoStatus::Repo {
        head,
        staged,
        unstaged,
    })
}

/// Une modification lue dans `git status`, avant ses compteurs. Un dossier non suivi replié a
/// un `repo_path` qui finit par `/`.
pub(super) struct Entry {
    pub repo_path: String,
    pub orig_repo_path: Option<String>,
    pub status: ChangeStatus,
    pub staged: bool,
}

pub(super) struct Porcelain {
    /// Branche courante, `None` si HEAD est détaché.
    pub branch: Option<String>,
    pub entries: Vec<Entry>,
    /// Entrées ignorées (`--ignored`), chemins du dépôt ; un dossier finit par `/`.
    pub ignored: Vec<String>,
}

/// Lit la sortie de `git status --porcelain=v2 -z --branch`. Chaque enregistrement finit par
/// un octet nul ; un renommage est suivi d'un second enregistrement, l'ancien chemin.
pub(super) fn parse_porcelain(text: &str) -> Porcelain {
    let mut branch = None;
    let mut entries = Vec::new();
    let mut ignored = Vec::new();
    let mut records = text.split('\0');
    while let Some(record) = records.next() {
        let Some((kind, rest)) = record.split_once(' ') else {
            continue;
        };
        match kind {
            "#" => {
                if let Some(name) = rest.strip_prefix("branch.head ") {
                    branch = (name != "(detached)").then(|| name.to_owned());
                }
            }
            // `1 XY sub mH mI mW hH hI chemin`
            "1" => {
                let fields: Vec<&str> = rest.splitn(8, ' ').collect();
                if let [xy, .., path] = fields.as_slice()
                    && fields.len() == 8
                {
                    push_tracked(&mut entries, xy, path, None);
                }
            }
            // `2 XY sub mH mI mW hH hI Xscore chemin`, puis l'ancien chemin.
            "2" => {
                let fields: Vec<&str> = rest.splitn(9, ' ').collect();
                let orig = records.next().map(str::to_owned);
                if let [xy, .., path] = fields.as_slice()
                    && fields.len() == 9
                {
                    push_tracked(&mut entries, xy, path, orig);
                }
            }
            // `u XY sub m1 m2 m3 mW h1 h2 h3 chemin` : conflit.
            "u" => {
                let fields: Vec<&str> = rest.splitn(10, ' ').collect();
                if let Some(path) = fields.get(9) {
                    entries.push(Entry {
                        repo_path: (*path).to_owned(),
                        orig_repo_path: None,
                        status: ChangeStatus::Conflict,
                        staged: false,
                    });
                }
            }
            "?" => entries.push(Entry {
                repo_path: rest.to_owned(),
                orig_repo_path: None,
                status: ChangeStatus::Untracked,
                staged: false,
            }),
            "!" => ignored.push(rest.to_owned()),
            _ => {}
        }
    }
    Porcelain {
        branch,
        entries,
        ignored,
    }
}

/// Ajoute la partie indexée (`X`) et la partie non indexée (`Y`) d'un fichier suivi.
fn push_tracked(entries: &mut Vec<Entry>, xy: &str, path: &str, orig: Option<String>) {
    let mut letters = xy.chars();
    let x = letters.next().unwrap_or('.');
    let y = letters.next().unwrap_or('.');
    let staged = match x {
        'M' | 'T' => Some(ChangeStatus::Modified),
        'A' | 'C' => Some(ChangeStatus::Added),
        'D' => Some(ChangeStatus::Deleted),
        'R' => Some(ChangeStatus::Renamed),
        _ => None,
    };
    if let Some(status) = staged {
        entries.push(Entry {
            repo_path: path.to_owned(),
            orig_repo_path: (status == ChangeStatus::Renamed)
                .then(|| orig.clone())
                .flatten(),
            status,
            staged: true,
        });
    }
    let unstaged = match y {
        'M' | 'T' => Some(ChangeStatus::Modified),
        'A' => Some(ChangeStatus::Added),
        'D' => Some(ChangeStatus::Deleted),
        _ => None,
    };
    if let Some(status) = unstaged {
        entries.push(Entry {
            repo_path: path.to_owned(),
            orig_repo_path: None,
            status,
            staged: false,
        });
    }
}

/// Lignes ajoutées et supprimées par chemin du dépôt (`git diff --numstat -z`, avec
/// `--cached` pour l'index). Un binaire compte `0 0`.
fn numstat(git: &Git, location: &Location, cached: bool) -> Result<HashMap<String, (u32, u32)>> {
    let mut args = vec!["diff", "--numstat", "-z", "--no-ext-diff"];
    if cached {
        args.extend(["--cached", "-M"]);
    } else {
        args.push("--no-renames");
    }
    let raw = git.run(&location.top, &args, false)?;
    let text = String::from_utf8_lossy(&raw);
    let mut counts = HashMap::new();
    let mut tokens = text.split('\0');
    while let Some(token) = tokens.next() {
        let mut parts = token.splitn(3, '\t');
        let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        // Renommage : chemin vide, puis l'ancien et le nouveau chemin.
        let path = if path.is_empty() {
            let _orig = tokens.next();
            tokens.next().unwrap_or_default()
        } else {
            path
        };
        counts.insert(
            path.to_owned(),
            (added.parse().unwrap_or(0), removed.parse().unwrap_or(0)),
        );
    }
    Ok(counts)
}

/// Lignes d'un fichier non suivi, toutes ajoutées (`0 0` pour un dossier replié, un fichier de
/// plus de 2 Mo, un binaire ou un fichier illisible). La taille se lit dans les métadonnées :
/// un gros fichier n'est pas lu.
fn count_file_lines(location: &Location, repo_path: &str) -> (u32, u32) {
    if repo_path.ends_with('/') {
        return (0, 0);
    }
    let path = location.top.join(repo_path);
    if fs::metadata(&path).is_ok_and(|meta| meta.len() > MAX_TEXT_BYTES) {
        return (0, 0);
    }
    let Ok(bytes) = fs::read(path) else {
        return (0, 0);
    };
    if bytes.iter().take(BINARY_SNIFF).any(|&b| b == 0) {
        return (0, 0);
    }
    let newlines = bytes.iter().filter(|&&b| b == b'\n').count();
    let last_open = bytes.last().is_some_and(|&b| b != b'\n');
    (
        u32::try_from(newlines + usize::from(last_open)).unwrap_or(u32::MAX),
        0,
    )
}

/// Chemin affiché : relatif au dossier racine, ou au dépôt s'il est hors du dossier racine
/// (vrai en second). Un dossier non suivi replié qui est le dossier racine lui-même (chemin
/// vide une fois le préfixe retiré) est aussi hors du dossier racine.
fn display_path(repo_path: &str, prefix: &str) -> (String, bool) {
    match repo_path.strip_prefix(prefix) {
        Some(rest) if !rest.is_empty() => (rest.to_owned(), false),
        _ => (repo_path.to_owned(), true),
    }
}

fn file_change(prefix: &str, entry: Entry, added: u32, removed: u32) -> FileChange {
    let (path, outside_root) = display_path(&entry.repo_path, prefix);
    let orig_path = entry
        .orig_repo_path
        .as_deref()
        .map(|orig| display_path(orig, prefix).0);
    FileChange {
        path,
        repo_path: entry.repo_path,
        orig_path,
        orig_repo_path: entry.orig_repo_path,
        status: entry.status,
        staged: entry.staged,
        added,
        removed,
        outside_root,
    }
}

/// Tri par chemin, les fichiers hors du dossier racine en fin de section.
fn sort_section(list: &mut [FileChange]) {
    list.sort_by(|a, b| (a.outside_root, &a.path).cmp(&(b.outside_root, &b.path)));
}
