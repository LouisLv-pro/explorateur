//! Issues GitHub par la CLI `gh` de l'utilisateur (spec `issues-github.md`, décision 0010) :
//! lancement sans shell, lecture des sorties `--json` (serde) et reconnaissance des erreurs.
//! L'app ne parle jamais à GitHub elle-même et ne garde aucun token.

use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::de::{DeserializeOwned, IgnoredAny};
use serde::{Deserialize, Deserializer, Serialize};

use crate::process::run_with_timeout;
use crate::{AppError, Result};

mod templates;

pub use templates::{IssueTemplate, list_issue_templates, parse_issue_template};

/// Programme `gh` appelé. `Gh::new` permet d'en désigner un autre (tests : `gh` absent).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gh {
    pub program: PathBuf,
    timeout: Duration,
}

/// Délai d'un appel à `gh` : au-delà, `gh` est arrêté et GitHub tenu pour injoignable.
pub const GH_TIMEOUT: Duration = Duration::from_secs(30);

impl Gh {
    /// `gh` à ce chemin (absolu, ou nom cherché dans le `PATH`).
    pub fn new(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            timeout: GH_TIMEOUT,
        }
    }

    /// Même `gh`, avec un autre délai (tests).
    #[must_use]
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

/// Raison pour laquelle les issues ne sont pas disponibles, chacune avec son message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GithubUnavailable {
    /// Le dossier racine n'est dans aucun dépôt git.
    NotARepo,
    /// Le programme `gh` n'existe pas.
    GhNotFound,
    /// `gh` n'est pas connecté (`gh auth login`).
    NotLoggedIn,
    /// Aucun remote du dépôt ne pointe vers GitHub.
    NoGithubRemote,
    /// Les issues sont désactivées sur le dépôt.
    IssuesDisabled,
    /// GitHub est injoignable.
    Offline,
}

/// Dépôt GitHub du dossier racine.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub name_with_owner: String,
    pub url: String,
}

/// État d'une issue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
pub enum IssueState {
    #[serde(rename = "OPEN")]
    Open,
    #[serde(rename = "CLOSED")]
    Closed,
}

/// Filtre de la liste : « Ouvertes », « Fermées », « À moi » (ouvertes assignées à l'utilisateur).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum IssueFilter {
    Open,
    Closed,
    Mine,
}

/// Label d'issue. `color` sans `#`, telle que rendue par `gh`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct Label {
    pub name: String,
    pub color: String,
    pub description: String,
}

/// Une issue dans la liste.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueSummary {
    pub number: u32,
    pub title: String,
    pub state: IssueState,
    pub labels: Vec<Label>,
    /// Logins des assignés.
    pub assignees: Vec<String>,
    /// Login de l'auteur.
    pub author: Option<String>,
    /// Date ISO telle que rendue par `gh`.
    pub updated_at: String,
    pub comment_count: u32,
}

/// Une issue ouverte en onglet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub number: u32,
    pub title: String,
    pub state: IssueState,
    /// `COMPLETED`, `NOT_PLANNED`, `REOPENED`… ; `None` si absente ou vide.
    pub state_reason: Option<String>,
    pub body: String,
    pub author: Option<String>,
    pub labels: Vec<Label>,
    pub assignees: Vec<String>,
    pub created_at: String,
    pub url: String,
    pub comments: Vec<Comment>,
}

/// Un commentaire d'issue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub author: Option<String>,
    pub body: String,
    pub created_at: String,
}

// ---------- Lecture du JSON ----------

/// Valeur par défaut pour un champ absent (`#[serde(default)]`) ou `null`.
fn null_default<'de, D, T>(deserializer: D) -> std::result::Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

/// Label tel que lu (specta refuse `deserialize_with` sur un type exporté).
#[derive(Deserialize)]
struct RawLabel {
    #[serde(default, deserialize_with = "null_default")]
    name: String,
    #[serde(default, deserialize_with = "null_default")]
    color: String,
    #[serde(default, deserialize_with = "null_default")]
    description: String,
}

fn labels(raw: Vec<RawLabel>) -> Vec<Label> {
    raw.into_iter()
        .map(|l| Label {
            name: l.name,
            color: l.color,
            description: l.description,
        })
        .collect()
}

/// `{ "login": … }` : auteur ou assigné.
#[derive(Deserialize)]
struct Actor {
    #[serde(default, deserialize_with = "null_default")]
    login: String,
}

fn logins(actors: Vec<Actor>) -> Vec<String> {
    actors.into_iter().map(|a| a.login).collect()
}

fn author_login(actor: Option<Actor>) -> Option<String> {
    actor.map(|a| a.login).filter(|l| !l.is_empty())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSummary {
    number: u32,
    #[serde(default, deserialize_with = "null_default")]
    title: String,
    state: IssueState,
    #[serde(default, deserialize_with = "null_default")]
    labels: Vec<RawLabel>,
    #[serde(default, deserialize_with = "null_default")]
    assignees: Vec<Actor>,
    #[serde(default)]
    author: Option<Actor>,
    #[serde(default, deserialize_with = "null_default")]
    updated_at: String,
    /// Seule la longueur compte.
    #[serde(default, deserialize_with = "null_default")]
    comments: Vec<IgnoredAny>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawComment {
    #[serde(default)]
    author: Option<Actor>,
    #[serde(default, deserialize_with = "null_default")]
    body: String,
    #[serde(default, deserialize_with = "null_default")]
    created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawIssue {
    number: u32,
    #[serde(default, deserialize_with = "null_default")]
    title: String,
    state: IssueState,
    #[serde(default)]
    state_reason: Option<String>,
    #[serde(default, deserialize_with = "null_default")]
    body: String,
    #[serde(default)]
    author: Option<Actor>,
    #[serde(default, deserialize_with = "null_default")]
    labels: Vec<RawLabel>,
    #[serde(default, deserialize_with = "null_default")]
    assignees: Vec<Actor>,
    #[serde(default, deserialize_with = "null_default")]
    created_at: String,
    #[serde(default, deserialize_with = "null_default")]
    url: String,
    #[serde(default, deserialize_with = "null_default")]
    comments: Vec<RawComment>,
}

/// Lit une sortie JSON de `gh` ; illisible : `AppError::Gh`.
fn parse<T: DeserializeOwned>(json: &str) -> Result<T> {
    serde_json::from_str(json).map_err(|e| AppError::Gh(format!("gh: {e}")))
}

/// Sortie de `gh repo view --json nameWithOwner,url`.
pub fn parse_repo(json: &str) -> Result<RepoInfo> {
    parse(json)
}

/// Sortie de `gh issue list --json …` : l'ordre de `gh` est conservé.
pub fn parse_issue_list(json: &str) -> Result<Vec<IssueSummary>> {
    let raw: Vec<RawSummary> = parse(json)?;
    Ok(raw
        .into_iter()
        .map(|r| IssueSummary {
            number: r.number,
            title: r.title,
            state: r.state,
            labels: labels(r.labels),
            assignees: logins(r.assignees),
            author: author_login(r.author),
            updated_at: r.updated_at,
            comment_count: u32::try_from(r.comments.len()).unwrap_or(u32::MAX),
        })
        .collect())
}

/// Sortie de `gh issue view N --json …`.
pub fn parse_issue(json: &str) -> Result<Issue> {
    let r: RawIssue = parse(json)?;
    Ok(Issue {
        number: r.number,
        title: r.title,
        state: r.state,
        state_reason: r.state_reason.filter(|s| !s.is_empty()),
        body: r.body,
        author: author_login(r.author),
        labels: labels(r.labels),
        assignees: logins(r.assignees),
        created_at: r.created_at,
        url: r.url,
        comments: r
            .comments
            .into_iter()
            .map(|c| Comment {
                author: author_login(c.author),
                body: c.body,
                created_at: c.created_at,
            })
            .collect(),
    })
}

// ---------- Erreurs de gh ----------

/// Reconnaît l'échec d'un `gh` d'après son code de sortie et sa sortie d'erreur. L'ordre des
/// tests compte : le message « pas de remote GitHub » cite `gh auth login`.
pub fn classify_gh_error(code: Option<i32>, stderr: &str) -> AppError {
    let text = stderr.trim();
    let has = |needle: &str| text.contains(needle);
    let unavailable = AppError::GithubUnavailable;
    if has("not a git repository") {
        unavailable(GithubUnavailable::NotARepo)
    } else if has("none of the git remotes") {
        unavailable(GithubUnavailable::NoGithubRemote)
    } else if has("has disabled issues") {
        unavailable(GithubUnavailable::IssuesDisabled)
    } else if has("Could not resolve to an issue") {
        AppError::IssueNotFound
    } else if has("error connecting to")
        || has("Could not resolve host")
        || has("no such host")
        || has("network is unreachable")
    {
        unavailable(GithubUnavailable::Offline)
    } else if code == Some(4) || has("gh auth login") || has("HTTP 401") {
        unavailable(GithubUnavailable::NotLoggedIn)
    } else {
        AppError::Gh(text.to_owned())
    }
}

// ---------- Lancement de gh ----------

/// Champs lus par la liste.
const LIST_FIELDS: &str = "number,title,state,labels,assignees,author,updatedAt,comments";
/// Champs lus par une issue.
const ISSUE_FIELDS: &str =
    "number,title,state,stateReason,body,author,labels,assignees,createdAt,comments,url";

/// Arguments de `gh` (sans le programme) pour la liste du filtre.
pub fn issue_list_args(filter: IssueFilter) -> Vec<String> {
    let state = if filter == IssueFilter::Closed {
        "closed"
    } else {
        "open"
    };
    let mut args: Vec<String> = ["issue", "list", "--state", state]
        .map(str::to_owned)
        .into();
    if filter == IssueFilter::Mine {
        args.extend(["--assignee", "@me"].map(str::to_owned));
    }
    // `sort:updated-desc` : les 100 plus récemment mises à jour, pas les 100 plus récemment créées.
    args.extend(
        [
            "--limit",
            "100",
            "--search",
            "sort:updated-desc",
            "--json",
            LIST_FIELDS,
        ]
        .map(str::to_owned),
    );
    args
}

/// Lance `gh` dans `root`, sans shell ni question posée, et rend sa sortie standard.
fn run(gh: &Gh, root: &Path, args: &[String]) -> Result<String> {
    run_with_input(gh, root, args, None)
}

/// Comme `run`, avec `input` écrit sur l'entrée standard puis le tube fermé (`--body-file -`).
/// Sans `input`, l'entrée est fermée d'emblée.
fn run_with_input(gh: &Gh, root: &Path, args: &[String], input: Option<&str>) -> Result<String> {
    if !root.is_dir() {
        return Err(AppError::NotFound(root.display().to_string()));
    }
    let spawn_error = |e: io::Error| {
        if e.kind() == io::ErrorKind::NotFound {
            AppError::GithubUnavailable(GithubUnavailable::GhNotFound)
        } else {
            AppError::Io(format!("gh: {e}"))
        }
    };
    let mut cmd = Command::new(&gh.program);
    cmd.current_dir(root)
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null());
    // `gh` lit tout son entrée avant d'écrire ; passé le délai il est arrêté avec ses enfants.
    let Some(out) =
        run_with_timeout(cmd, input.map(str::as_bytes), gh.timeout).map_err(spawn_error)?
    else {
        return Err(AppError::GithubUnavailable(GithubUnavailable::Offline));
    };
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(classify_gh_error(
            out.status.code(),
            &String::from_utf8_lossy(&out.stderr),
        ))
    }
}

/// Dépôt GitHub que `gh` associe au dépôt git de `root`.
pub fn repo_view(gh: &Gh, root: &Path) -> Result<RepoInfo> {
    let args = ["repo", "view", "--json", "nameWithOwner,url"].map(str::to_owned);
    parse_repo(&run(gh, root, &args)?)
}

/// Les 100 issues les plus récemment mises à jour selon `filter`.
pub fn issue_list(gh: &Gh, root: &Path, filter: IssueFilter) -> Result<Vec<IssueSummary>> {
    parse_issue_list(&run(gh, root, &issue_list_args(filter))?)
}

// ---------- Création (lot 2) ----------

/// Issue à créer. Le corps passe par l'entrée standard, jamais par les arguments.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize, specta::Type)]
pub struct NewIssue {
    pub title: String,
    pub body: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
}

/// Arguments de `gh issue create` (sans le programme). `--body-file -` est toujours passé :
/// sans lui, `gh` demanderait le corps.
pub fn issue_create_args(issue: &NewIssue) -> Vec<String> {
    let mut args: Vec<String> = ["issue", "create", "--title"].map(str::to_owned).into();
    args.push(issue.title.clone());
    args.extend(["--body-file", "-"].map(str::to_owned));
    for label in &issue.labels {
        args.extend(["--label".to_owned(), label.clone()]);
    }
    for login in &issue.assignees {
        args.extend(["--assignee".to_owned(), login.clone()]);
    }
    args
}

/// Numéro de l'issue créée : dernière ligne non vide de la sortie de `gh issue create`, une URL
/// `https://<hôte>/<owner>/<repo>/issues/<N>`.
pub fn parse_created_number(stdout: &str) -> Result<u32> {
    let unexpected = || AppError::Gh(format!("gh issue create: {}", stdout.trim()));
    let line = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .ok_or_else(unexpected)?;
    let rest = line
        .strip_prefix("https://")
        .or_else(|| line.strip_prefix("http://"))
        .ok_or_else(unexpected)?;
    let parts: Vec<&str> = rest.split('/').collect();
    match parts.as_slice() {
        [_host, _owner, _repo, "issues", number] => number
            .parse::<u32>()
            .ok()
            .filter(|n| *n > 0)
            .ok_or_else(unexpected),
        _ => Err(unexpected()),
    }
}

/// Crée l'issue dans le dépôt de `root` et rend son numéro.
pub fn issue_create(gh: &Gh, root: &Path, issue: &NewIssue) -> Result<u32> {
    let stdout = run_with_input(gh, root, &issue_create_args(issue), Some(&issue.body))?;
    parse_created_number(&stdout)
}

// ---------- Listes du dialogue de création ----------

/// Sortie de `gh label list --json name,color,description`.
pub fn parse_labels(json: &str) -> Result<Vec<Label>> {
    Ok(labels(parse(json)?))
}

/// Sortie de `gh api repos/{owner}/{repo}/assignees --paginate` : un tableau par page, les
/// pages collées `[..][..]` sont acceptées. Rend les logins dans l'ordre.
pub fn parse_assignees(json: &str) -> Result<Vec<String>> {
    let mut logins = Vec::new();
    for page in serde_json::Deserializer::from_str(json).into_iter::<Vec<Actor>>() {
        let page = page.map_err(|e| AppError::Gh(format!("gh: {e}")))?;
        logins.extend(page.into_iter().map(|a| a.login).filter(|l| !l.is_empty()));
    }
    Ok(logins)
}

/// Les 200 premiers labels du dépôt.
pub fn label_list(gh: &Gh, root: &Path) -> Result<Vec<Label>> {
    let args = [
        "label",
        "list",
        "--json",
        "name,color,description",
        "--limit",
        "200",
    ]
    .map(str::to_owned);
    parse_labels(&run(gh, root, &args)?)
}

/// Personnes assignables du dépôt (`gh` remplace lui-même `{owner}` et `{repo}`).
pub fn assignable_users(gh: &Gh, root: &Path) -> Result<Vec<String>> {
    let args = ["api", "repos/{owner}/{repo}/assignees", "--paginate"].map(str::to_owned);
    parse_assignees(&run(gh, root, &args)?)
}

/// Login de l'utilisateur de `gh`.
pub fn current_user(gh: &Gh, root: &Path) -> Result<String> {
    let args = ["api", "user", "-q", ".login"].map(str::to_owned);
    let login = run(gh, root, &args)?.trim().to_owned();
    if login.is_empty() {
        return Err(AppError::Gh("gh returned no login".into()));
    }
    Ok(login)
}

/// Une issue avec ses commentaires.
pub fn issue_view(gh: &Gh, root: &Path, number: u32) -> Result<Issue> {
    let args = ["issue", "view", &number.to_string(), "--json", ISSUE_FIELDS].map(str::to_owned);
    parse_issue(&run(gh, root, &args)?)
}
