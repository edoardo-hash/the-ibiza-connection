// GitHub as the content store: edits go to the draft branch, Publish moves them to main (Vercel deploys main).
const REPO = process.env.GITHUB_REPO || "edoardo-hash/the-ibiza-connection";
const MAIN = process.env.CMS_MAIN_BRANCH || "main";
export const DRAFT = process.env.CMS_DRAFT_BRANCH || "cms-draft";
// The repo is public: commits carry the editor's first name and the site address, never a personal email.
export const COMMIT_EMAIL = process.env.CMS_COMMIT_EMAIL || "info@theibizaconnection.net";

async function gh(method, path, body) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not configured");
  const res = await fetch(`${process.env.GITHUB_API_URL || "https://api.github.com"}/repos/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "theibizaconnection-control-panel",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  if (res.status === 404 && method === "GET") return null;
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`GitHub ${method} ${path}: ${res.status} ${json.message || ""}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function refSha(branch) {
  const r = await gh("GET", `/git/ref/heads/${branch}`);
  return r ? r.object.sha : null;
}
const setRef = (branch, sha, force) => gh("PATCH", `/git/refs/heads/${branch}`, { sha, force });

export async function compare(base = MAIN, head = DRAFT) {
  return gh("GET", `/compare/${base}...${head}`);
}

// Make sure the draft branch exists and starts from the latest live site when it has no pending edits.
export async function ensureDraft() {
  const mainSha = await refSha(MAIN);
  const draftSha = await refSha(DRAFT);
  if (!draftSha) {
    await gh("POST", `/git/refs`, { ref: `refs/heads/${DRAFT}`, sha: mainSha });
    return mainSha;
  }
  if (draftSha === mainSha) return draftSha;
  const cmp = await compare(MAIN, DRAFT);
  if (cmp.ahead_by === 0) {
    await setRef(DRAFT, mainSha, true);
    return mainSha;
  }
  return draftSha;
}

/* ---------- reading ---------- */

const blobCache = new Map(); // blob sha -> text (immutable)

export async function treeFiles(commitSha) {
  const commit = await gh("GET", `/git/commits/${commitSha}`);
  const tree = await gh("GET", `/git/trees/${commit.tree.sha}?recursive=1`);
  return tree.tree.filter((t) => t.type === "blob").map((t) => ({ path: t.path, sha: t.sha, size: t.size }));
}

export async function blobText(sha) {
  if (blobCache.has(sha)) return blobCache.get(sha);
  const b = await gh("GET", `/git/blobs/${sha}`);
  const text = Buffer.from(b.content, b.encoding === "base64" ? "base64" : "utf8").toString("utf8");
  blobCache.set(sha, text);
  return text;
}

/* ---------- writing ---------- */

// One atomic commit with several changed files on the draft branch.
// Text files: { path: "content" }. Binary files (images): { path: { base64: "..." } }.
export async function commitFiles(files, message, author) {
  const parent = await ensureDraft();
  const parentCommit = await gh("GET", `/git/commits/${parent}`);
  const entries = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      if (content && typeof content === "object" && content.base64) {
        const blob = await gh("POST", `/git/blobs`, { content: content.base64, encoding: "base64" });
        return { path, mode: "100644", type: "blob", sha: blob.sha };
      }
      if (content && typeof content === "object" && "sha" in content) {
        return { path, mode: "100644", type: "blob", sha: content.sha }; // sha: null deletes the file
      }
      return { path, mode: "100644", type: "blob", content };
    })
  );
  const tree = await gh("POST", `/git/trees`, { base_tree: parentCommit.tree.sha, tree: entries });
  const commit = await gh("POST", `/git/commits`, {
    message,
    tree: tree.sha,
    parents: [parent],
    ...(author ? { author: { ...author, date: new Date().toISOString() } } : {}),
  });
  await setRef(DRAFT, commit.sha, false);
  return { sha: commit.sha, url: commit.html_url };
}

/* ---------- status / publish ---------- */

export async function status() {
  const [mainSha, draftSha] = await Promise.all([refSha(MAIN), refSha(DRAFT)]);
  let pending = { commits: [], files: [] };
  if (draftSha && draftSha !== mainSha) {
    const cmp = await compare(MAIN, DRAFT);
    pending = {
      commits: cmp.commits.map((c) => ({
        sha: c.sha,
        message: c.commit.message.split("\n")[0],
        author: c.commit.author?.name || "",
        date: c.commit.author?.date,
      })),
      files: (cmp.files || []).map((f) => ({ path: f.filename, changes: f.changes })),
    };
  }
  // The daily villa refresh (GitHub Actions) also commits to main; those aren't edits, so they're left out.
  const recent = (await gh("GET", `/commits?sha=${MAIN}&per_page=30`)) || [];
  return {
    pending,
    recent: recent.filter((c) => !/^Villa refresh /.test(c.commit.message)).slice(0, 8).map((c) => ({
      sha: c.sha,
      message: c.commit.message.split("\n")[0],
      author: c.commit.author?.name || "",
      date: c.commit.author?.date,
    })),
  };
}

export async function publish(byName) {
  const [mainSha, draftSha] = await Promise.all([refSha(MAIN), refSha(DRAFT)]);
  if (!draftSha || draftSha === mainSha) return { published: false, reason: "Nothing to publish" };
  const cmp = await compare(MAIN, DRAFT);
  if (cmp.ahead_by === 0) return { published: false, reason: "Nothing to publish" };
  let newMain;
  if (cmp.behind_by === 0) {
    await setRef(MAIN, draftSha, false); // fast-forward
    newMain = draftSha;
  } else {
    const m = await gh("POST", `/merges`, {
      base: MAIN,
      head: DRAFT,
      commit_message: `Publish ${cmp.ahead_by} change${cmp.ahead_by === 1 ? "" : "s"} from the control panel (${byName})`,
    });
    newMain = m.sha;
  }
  await setRef(DRAFT, newMain, true);
  return { published: true, sha: newMain, count: cmp.ahead_by };
}

export async function discard() {
  const mainSha = await refSha(MAIN);
  if (await refSha(DRAFT)) await setRef(DRAFT, mainSha, true);
  return { discarded: true };
}

/* ---------- undo ---------- */

// Content the control panel may restore: page HTML/CSS and site images. Never code or config.
const RESTORABLE = (p) =>
  (p.startsWith("content/") && p.endsWith(".json")) ||
  p === "assets/css/site.css" ||
  /^assets\/img\/.+\.(webp|jpe?g|png|avif)$/i.test(p);

// Remove the most recent change from the draft.
export async function undoDraftLast() {
  const [mainSha, draftSha] = await Promise.all([refSha(MAIN), refSha(DRAFT)]);
  if (!draftSha || draftSha === mainSha) return { undone: false, reason: "There is nothing in the draft to undo." };
  const cmp = await compare(MAIN, DRAFT);
  if (cmp.ahead_by === 0) return { undone: false, reason: "There is nothing in the draft to undo." };
  const last = await gh("GET", `/git/commits/${draftSha}`);
  await setRef(DRAFT, last.parents[0].sha, true);
  return { undone: true, message: last.message.split("\n")[0] };
}

// Undo a published change: restore the pages it changed to how they were before, as a new draft change.
export async function undoPublished(sha, user) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(sha))) return { undone: false, reason: "Unknown change." };
  const target = await gh("GET", `/git/commits/${sha}`);
  if (!target || !target.parents.length) return { undone: false, reason: "That change can't be undone." };
  const parent = target.parents[0].sha;
  const mainSha = await refSha(MAIN);
  const onMain = mainSha === target.sha || ["ahead", "identical"].includes((await compare(target.sha, MAIN)).status);
  if (!onMain) return { undone: false, reason: "That change is not on the live site." };
  const cmp = await compare(parent, target.sha);
  const files = (cmp.files || []).map((f) => f.filename);
  if (!files.length) return { undone: false, reason: "That change didn't modify any pages." };
  const technical = files.filter((f) => !RESTORABLE(f));
  if (technical.length) {
    return { undone: false, reason: "That update included technical changes to how the site works, so it can't be undone from here — please ask Edo." };
  }
  const head = await ensureDraft();
  const [now, before, after] = await Promise.all([treeFiles(head), treeFiles(parent), treeFiles(target.sha)]);
  const map = (l) => new Map(l.map((f) => [f.path, f.sha]));
  const [nowM, beforeM, afterM] = [map(now), map(before), map(after)];
  const conflicts = files.filter((f) => (nowM.get(f) || null) !== (afterM.get(f) || null));
  if (conflicts.length) {
    return {
      undone: false,
      reason: `Some of those pages have been changed again since then (${conflicts.length} file${conflicts.length === 1 ? "" : "s"}), so an automatic undo could wipe out later work. Ask the assistant to change the text back instead.`,
    };
  }
  const changes = Object.fromEntries(files.map((f) => [f, { sha: beforeM.get(f) || null }]));
  const title = target.message.split("\n")[0];
  const commit = await commitFiles(changes, `Undo: ${title}`.slice(0, 120) + `\n\nUndone from the control panel by ${user.name}; restores ${sha.slice(0, 7)}^.`, {
    name: user.name,
    email: COMMIT_EMAIL,
  });
  return { undone: true, commit, files: files.length, message: title };
}
