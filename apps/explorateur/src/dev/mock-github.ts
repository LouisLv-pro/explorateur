// Faux GitHub du navigateur simulé (spec issues-github.md, décision 0010) : hors de Tauri, il n'y
// a ni `gh` ni réseau. Le dépôt `orbit-labs/demo` (celui du dossier racine `~/Projets/demo`)
// a une dizaine d'issues ouvertes et fermées, des labels colorés, une issue avec des
// commentaires, une image distante et du code.
//
// `window.__mockGithub.set("ok" | "ghNotFound" | "notLoggedIn" | "noGithubRemote" |
//   "issuesDisabled" | "offline")` : état de `gh` ; relu au prochain affichage de la vue ou
//   « Actualiser ». "ok" par défaut ; hors du dépôt simulé (`window.__mockGit.set("notARepo")`
//   ou un autre dossier racine), la vue affiche « pas dans un dépôt git ».
// Le faux shell connaît `gh auth login` : il rétablit "ok" deux secondes après son lancement.
import type {
  AppError,
  GithubUnavailable,
  Issue,
  IssueFilter,
  IssueSummary,
  IssueTemplate,
  Label,
  NewIssue,
  RepoInfo,
} from "@/bindings";
import { DEMO_ROOT } from "./mock-disk";
import { isFakeRepo } from "./mock-git";

export type GithubScenario = "ok" | Exclude<GithubUnavailable, "notARepo">;

const REPO: RepoInfo = {
  nameWithOwner: "orbit-labs/demo",
  url: "https://github.com/orbit-labs/demo",
};
const ME = "alex";
const LATENCY_MS = 250;

let scenario: GithubScenario = "ok";

export function setFakeGithub(next: GithubScenario) {
  scenario = next;
}

/** `gh auth login` réussi dans le faux shell. */
export function fakeGithubLoggedIn() {
  if (scenario === "notLoggedIn") scenario = "ok";
}

const label = (name: string, color: string, description = ""): Label => ({
  name,
  color,
  description,
});

const BUG = label("bug", "d73a4a", "Something isn't working");
const ENHANCEMENT = label("enhancement", "a2eeef", "New feature or request");
const DOCS = label("documentation", "0075ca", "Improvements or additions to documentation");
const FIRST = label("good first issue", "7057ff", "Good for newcomers");
const HELP = label("help wanted", "008672", "Extra attention is needed");
const WONTFIX = label("wontfix", "ffffff", "This will not be worked on");
const HIGH = label("priorité haute", "b60205");
const YELLOW = label("à trier", "fbca04");

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

type FakeComment = { author: string | null; body: string; createdAt: string };

type FakeIssue = Omit<Issue, "comments" | "url"> & { comments: FakeComment[] };

function fake(
  number: number,
  title: string,
  state: Issue["state"],
  updatedAgo: number,
  rest: Partial<FakeIssue> = {},
): FakeIssue & { updatedAt: string } {
  return {
    number,
    title,
    state,
    stateReason: state === "CLOSED" ? "COMPLETED" : null,
    body: "",
    author: ME,
    labels: [],
    assignees: [],
    createdAt: ago(updatedAgo + 3 * D),
    comments: [],
    updatedAt: ago(updatedAgo),
    ...rest,
  };
}

const BODY_12 = `## Description

Le terminal se fige quand on redimensionne la fenêtre pendant qu'un **processus** écrit beaucoup
de sortie. Voir aussi #7, la PR #30, [l'issue 9](https://github.com/orbit-labs/demo/issues/9)
et [la documentation de xterm](https://xtermjs.org/docs/).

![capture du terminal figé](https://user-images.githubusercontent.com/1/capture.png)

### Étapes

1. Ouvrir un terminal
2. Lancer \`yes\`
3. Redimensionner la fenêtre

\`\`\`ts
const fit = new FitAddon();
terminal.loadAddon(fit);
window.addEventListener("resize", () => fit.fit());
\`\`\`

| Cas | Résultat |
| --- | --- |
| Sans sortie | fluide |
| Avec \`yes\` | figé |

- [x] reproduit sous macOS
- [ ] reproduit sous Linux

<details><summary>Journal</summary>

\`\`\`
resize 120x40 -> 121x40
\`\`\`

</details>`;

const ISSUES: (FakeIssue & { updatedAt: string })[] = [
  fake(12, "Le terminal se fige au redimensionnement", "OPEN", 3 * H, {
    body: BODY_12,
    labels: [BUG, HIGH],
    assignees: [ME],
    comments: [
      {
        author: "bob",
        body: "Je regarde. Reproduit sous **macOS 15** aussi.",
        createdAt: ago(2 * D),
      },
      {
        author: ME,
        body: "Piste : `fit.fit()` est appelé à chaque pixel.\n\n```rust\nlet size = pty.size();\n```\n\n![schéma](https://example.com/schema.png)",
        createdAt: ago(5 * H),
      },
      { author: null, body: "Compte supprimé.", createdAt: ago(4 * H) },
    ],
  }),
  fake(14, "Ajouter un thème « sépia » à l'éditeur", "OPEN", 26 * H, {
    labels: [ENHANCEMENT, FIRST],
    author: "alice",
    body: "Un thème chaud pour la lecture de nuit.",
  }),
  fake(9, "La recherche floue ignore les accents des noms de dossiers", "OPEN", 2 * D, {
    labels: [BUG],
    assignees: [ME, "bob"],
    author: "bob",
    body: "`cafe` ne trouve pas `Café/`.",
    comments: [{ author: ME, body: "Normalisation NFD à faire côté Rust.", createdAt: ago(D) }],
  }),
  fake(21, "Documenter les raccourcis de l'aide", "OPEN", 4 * D, {
    labels: [DOCS, HELP, YELLOW],
    author: "alice",
  }),
  fake(7, "Typo dans l'aide", "CLOSED", 9 * D, { labels: [DOCS], author: "bob" }),
  fake(5, "L'aperçu HTML recharge deux fois", "CLOSED", 15 * D, {
    labels: [BUG],
    assignees: [ME],
    comments: [{ author: ME, body: "Corrigé.", createdAt: ago(15 * D) }],
  }),
  fake(3, "Support des fichiers .mdx", "CLOSED", 40 * D, {
    labels: [ENHANCEMENT, WONTFIX],
    stateReason: "NOT_PLANNED",
    author: "alice",
  }),
  fake(
    18,
    "Un très long titre d'issue qui dépasse largement la largeur du panneau de gauche et doit être tronqué avec une infobulle",
    "OPEN",
    6 * D,
    {
      labels: [YELLOW],
      author: "alice",
    },
  ),
  fake(25, "Explorer : ⌘P ne trouve pas les fichiers masqués", "OPEN", 8 * D, {
    labels: [BUG, FIRST, HELP],
    author: "bob",
  }),
  fake(2, "Premier jet de l'app", "CLOSED", 90 * D, { author: ME }),
  fake(31, "Icônes de fichiers manquantes pour .astro", "OPEN", 12 * D, {
    labels: [ENHANCEMENT],
    author: ME,
    assignees: [ME],
  }),
];

function fail(error: AppError): never {
  throw error;
}

/** Délai du réseau simulé, pour voir l'indicateur de lecture. */
const later = <T>(value: () => T): Promise<T> =>
  new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(value());
      } catch (error) {
        reject(error as Error);
      }
    }, LATENCY_MS),
  );

/** Erreur de `gh` selon l'état simulé, ou rien si tout va bien. */
function checkGh(root: string) {
  if (scenario === "ghNotFound") fail({ kind: "GithubUnavailable", message: "ghNotFound" });
  if (root !== DEMO_ROOT || !isFakeRepo()) {
    fail({ kind: "GithubUnavailable", message: "notARepo" });
  }
  if (scenario !== "ok") fail({ kind: "GithubUnavailable", message: scenario });
}

export function getFakeGithubRepo(root: string): Promise<RepoInfo> {
  return later(() => {
    checkGh(root);
    return REPO;
  });
}

function summaryOf(issue: FakeIssue & { updatedAt: string }): IssueSummary {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels: issue.labels,
    assignees: issue.assignees,
    author: issue.author,
    updatedAt: issue.updatedAt,
    commentCount: issue.comments.length,
  };
}

export function listFakeGithubIssues(root: string, filter: IssueFilter): Promise<IssueSummary[]> {
  return later(() => {
    checkGh(root);
    return ISSUES.filter((i) =>
      filter === "closed"
        ? i.state === "CLOSED"
        : i.state === "OPEN" && (filter === "open" || i.assignees.includes(ME)),
    )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 100)
      .map(summaryOf);
  });
}

// ---------- Création (lot 2) ----------

const ALL_LABELS = [BUG, ENHANCEMENT, DOCS, FIRST, HELP, WONTFIX, HIGH, YELLOW];
const ASSIGNEES = [ME, "alice", "bob"];

/** Modèles du faux dépôt (`.github/ISSUE_TEMPLATE/*.md`), lus sur le disque dans l'app réelle. */
const TEMPLATES: IssueTemplate[] = [
  {
    fileName: "bug_report.md",
    name: "Rapport de bug",
    description: "Signaler un problème, avec les étapes pour le reproduire",
    title: "[BUG] ",
    labels: ["bug", "à trier"],
    assignees: [],
    body: "## Description\n\n\n## Étapes pour reproduire\n\n1. \n2. \n\n## Comportement attendu\n\n",
  },
  {
    fileName: "feature_request.md",
    name: "Demande de fonctionnalité",
    description: "Proposer une idée",
    title: "",
    labels: [],
    assignees: [],
    body: "## Le besoin\n\n\n## Idée de solution\n\n",
  },
];

let templatesOn = true;

/** `window.__mockGithub.templates(false)` : dépôt sans modèle (le dialogue s'ouvre sur le formulaire). */
export function setFakeTemplates(on: boolean) {
  templatesOn = on;
}

export function listFakeGithubLabels(root: string): Promise<Label[]> {
  return later(() => {
    checkGh(root);
    return ALL_LABELS;
  });
}

export function listFakeGithubAssignees(root: string): Promise<string[]> {
  return later(() => {
    checkGh(root);
    return ASSIGNEES;
  });
}

export function getFakeGithubUser(root: string): Promise<string> {
  return later(() => {
    checkGh(root);
    return ME;
  });
}

/** Lecture du disque : pas de `gh`, donc pas d'erreur de GitHub. */
export function listFakeIssueTemplates(root: string): Promise<IssueTemplate[]> {
  return Promise.resolve(root === DEMO_ROOT && isFakeRepo() && templatesOn ? TEMPLATES : []);
}

/** Titre contenant « échec » : erreur de `gh` simulée. Un label inconnu est refusé comme par GitHub. */
export function createFakeGithubIssue(root: string, issue: NewIssue): Promise<number> {
  return later(() => {
    checkGh(root);
    if (issue.title.toLowerCase().includes("échec")) {
      fail({
        kind: "Gh",
        message: "GraphQL: Resource not accessible by personal access token (createIssue)",
      });
    }
    const labels = issue.labels.map((name) => {
      const known = ALL_LABELS.find((l) => l.name === name);
      if (!known) fail({ kind: "Gh", message: `could not add label: '${name}' not found` });
      return known;
    });
    const number = Math.max(...ISSUES.map((i) => i.number)) + 1;
    ISSUES.push({
      ...fake(number, issue.title, "OPEN", 0, {
        body: issue.body,
        labels,
        assignees: issue.assignees,
      }),
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    return number;
  });
}

/** La #30 est une pull request : `gh issue view 30` rend une `url` en `/pull/30` (lot 3 : ouverte dans le navigateur). */
const PULL_REQUEST = 30;

export function getFakeGithubIssue(root: string, number: number): Promise<Issue> {
  return later(() => {
    checkGh(root);
    if (number === PULL_REQUEST) {
      // Comme le vrai `gh issue view` : il réussit et rend une `url` en `/pull/N`.
      return {
        ...fake(number, "Ajoute le lot 3 des issues", "OPEN", 0),
        comments: [],
        url: `${REPO.url}/pull/${number}`,
      };
    }
    const issue = ISSUES.find((i) => i.number === number);
    if (!issue) fail({ kind: "IssueNotFound" });
    return { ...issue, url: `${REPO.url}/issues/${number}` };
  });
}
