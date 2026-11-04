// Faux distant git du navigateur simulé (spec git-distant.md, décision 0010) : hors de Tauri, il
// n'y a ni git ni réseau. Un scénario décrit la branche courante du faux dépôt (`mock-git.ts`),
// les commandes récupérer / pousser / tirer le font évoluer après un court délai.
//
// `window.__mockGit.remote(scenario)` : "uptodate" (défaut), "ahead" (↑2), "behind" (↓2),
//   "diverged" (↑1 ↓2), "noUpstream" (publiable sur origin), "noRemote", "multiple" (plusieurs
//   remotes sans origin).
// `window.__mockGit.remoteAdvance(n)` : n commits arrivent sur le distant ; « à tirer » ne les
//   voit qu'après une récupération.
// `window.__mockGit.remoteFail("auth" | "rejected" | "unreachable" | "timeout" | "diverged" |
//   "localChanges" | null)` : les gestes réseau échouent jusqu'à `remoteFail(null)`.
// `window.__mockGit.remoteCalls()` : commandes réseau reçues (pour vérifier la planification).
import type { AppError, RemoteErrorKind, RemoteState } from "@/bindings";

export type RemoteScenario =
  "uptodate" | "ahead" | "behind" | "diverged" | "noUpstream" | "noRemote" | "multiple";

const UPSTREAM = "origin/travail/git";
const DELAY_MS = 400;

type Counts = { ahead: number; behind: number };

const SCENARIOS: Record<RemoteScenario, Counts> = {
  uptodate: { ahead: 0, behind: 0 },
  ahead: { ahead: 2, behind: 0 },
  behind: { ahead: 0, behind: 2 },
  diverged: { ahead: 1, behind: 2 },
  noUpstream: { ahead: 0, behind: 0 },
  noRemote: { ahead: 0, behind: 0 },
  multiple: { ahead: 0, behind: 0 },
};

let scenario: RemoteScenario = "uptodate";
let counts: Counts = { ...SCENARIOS.uptodate };
/** Commits arrivés sur le distant, pas encore récupérés. */
let unfetched = 0;
/** Branche publiée par un « Publier la branche » : elle a désormais un amont. */
let published = false;
let failing: RemoteErrorKind | null = null;
let calls: string[] = [];

export function setFakeRemote(next: RemoteScenario) {
  scenario = next;
  counts = { ...SCENARIOS[next] };
  unfetched = 0;
  published = false;
}

export function resetFakeRemote() {
  setFakeRemote("uptodate");
  failing = null;
  calls = [];
}

export const advanceFakeRemote = (n: number) => {
  unfetched += n;
};

export const failFakeRemote = (kind: RemoteErrorKind | null) => {
  failing = kind;
};

export const fakeRemoteCalls = () => [...calls];

const hasUpstream = () =>
  published ||
  scenario === "uptodate" ||
  scenario === "ahead" ||
  scenario === "behind" ||
  scenario === "diverged";

/** Un commit du faux dépôt : à pousser s'il y a un amont. */
export function noteFakeCommit() {
  if (hasUpstream()) counts.ahead += 1;
}

export function getFakeRemoteState(inRepo: boolean): RemoteState {
  if (!inRepo || scenario === "noRemote") return { kind: "none" };
  if (hasUpstream()) return { kind: "upstream", name: UPSTREAM, ...counts };
  if (scenario === "multiple") return { kind: "ambiguousRemote" };
  return { kind: "publishable", remote: "origin" };
}

const OUTPUTS: Record<RemoteErrorKind, string> = {
  auth: "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.",
  rejected:
    "To github.com:alex/explorateur.git\n ! [rejected]        travail/git -> travail/git (fetch first)\nerror: failed to push some refs to 'github.com:alex/explorateur.git'",
  unreachable:
    "fatal: unable to access 'https://github.com/alex/explorateur.git/': Could not resolve host: github.com",
  timeout: "",
  diverged: "fatal: Not possible to fast-forward, aborting.",
  localChanges:
    "error: Your local changes to the following files would be overwritten by merge:\n\tdemo/README.md\nPlease commit your changes or stash them before you merge.\nAborting",
  noRemote: "",
  ambiguousRemote: "",
  other: "remote: pre-push hook failed",
};

function remoteFail(kind: RemoteErrorKind): never {
  throw { kind: "Remote", message: { kind, output: OUTPUTS[kind] } } satisfies AppError;
}

/** Délai d'un geste réseau, puis l'échec simulé s'il y en a un. */
async function network(name: string) {
  calls.push(name);
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  if (failing !== null) remoteFail(failing);
}

export async function fakeFetch(): Promise<null> {
  await network("fetch");
  if (scenario === "noRemote") remoteFail("noRemote");
  if (!hasUpstream() && scenario === "multiple") remoteFail("ambiguousRemote");
  counts.behind += unfetched;
  unfetched = 0;
  return null;
}

export async function fakePush(): Promise<null> {
  await network("push");
  if (scenario === "noRemote") remoteFail("noRemote");
  if (!hasUpstream()) {
    if (scenario === "multiple") remoteFail("ambiguousRemote");
    published = true;
    counts = { ahead: 0, behind: 0 };
    return null;
  }
  // Le distant a avancé (récupéré ou non) : refus, comme git.
  if (counts.behind > 0 || unfetched > 0) remoteFail("rejected");
  counts.ahead = 0;
  return null;
}

export async function fakePull(): Promise<number> {
  await network("pull");
  if (scenario === "noRemote") remoteFail("noRemote");
  if (counts.ahead > 0 && counts.behind + unfetched > 0) remoteFail("diverged");
  const pulled = counts.behind + unfetched;
  counts.behind = 0;
  unfetched = 0;
  return pulled;
}
