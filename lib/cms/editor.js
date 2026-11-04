// The control panel's AI editor: Claude reads and edits the site's copy (content/*.json) and styles
// (assets/css/site.css) on the draft branch. build.py turns them into the pages on every deploy.
import { ensureDraft, treeFiles, blobText, commitFiles, COMMIT_EMAIL } from "./github.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_ROUNDS = 18;

export const editable = (p) => (p.startsWith("content/") && p.endsWith(".json")) || p === "assets/css/site.css";
const isJson = (p) => p.endsWith(".json");

// Settings the panel must never change: prices, which villas are hidden, the licence checks, the site address.
const PROTECTED = {
  "content/settings.json": ["pricing", "hidden_villas", "licence_policy", "licence_confirmed", "_licence_notes", "site.url"],
};
const pick = (obj, dotted) => dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);

const PAGES = `URL → file (all page copy is JSON: edit only the text values)
Contact details everywhere (email, phone, WhatsApp, office address, opening hours, social links), the site description/tagline used for search engines, the top menu, the footer, and the price-match text → content/settings.json (one place: the header, footer, contact page and structured data all read from it)
/ (home page: hero, intro, sections, call to action) → content/home.json
/villas/ and /villa/<name>/ → villa names, descriptions, photos, prices, bedrooms, licences and availability come from IMpulse (not editable here)
/destinations/ and the five area pages → content/destinations.json
/journal/ and the journal articles → content/journal.json
/about/ → content/pages/about.json
/owners/ → content/pages/owners.json
/experiences/ → content/pages/experiences.json
/experiences/boat-rental/ → content/pages/boat-rental.json
/experiences/car-hire/ → content/pages/car-hire.json
/experiences/concierge/ → content/pages/concierge.json
/contact/ → content/pages/contact.json (the contact details themselves are in settings.json)
/privacy/ and /terms/ → content/pages/privacy.json, content/pages/terms.json
Styles (colours, fonts, spacing) → assets/css/site.css
Some small labels (buttons on villa cards, search filters, the villa page layout) are part of the site's code, not of these files: those need Edo.`;

function systemPrompt(user) {
  return `You are the website editor inside The Ibiza Connection control panel (theibizaconnection.net: a hand-picked collection of private villas in Ibiza with boat days, cars and concierge, run by a local team in Santa Eulària). You are talking to ${user.name} (${user.email}), who is not technical. Today is ${new Date().toISOString().slice(0, 10)}.

What you can do: change the words on the site (page copy, headings, menu and footer labels, contact details, SEO titles and descriptions), its styling, and swap the website's photos for photos ${user.name} attaches, using the tools. Every change you make is saved as a DRAFT. ${user.name} checks it with Open preview and then clicks Publish to put it live (or Discard to throw it away). Never say a change is live: say it is ready in the preview, which takes about 3–4 minutes to rebuild after each change.

Site map:
${PAGES}

How the files work:
- The page copy lives in JSON files. Change only the text inside the quotes of a value; never rename, add or remove keys, and keep the file valid JSON (a double quote inside text must be written \\", a line break as \\n). Keys ending in _html may contain simple HTML such as <em>, <br> or <a href="…">; keep those tags intact. The tools refuse an edit that breaks the JSON.
- Pick the exact value to change with search_site and read_file, then use replace_in_file with a piece of text that occurs once (include the key name, e.g. "phone_display": "+34 …").
- Contact details live once in content/settings.json, but a page's own copy may repeat them in a sentence: search for the old value everywhere (also shorter fragments, e.g. the last digits of a phone number or the street name) and change every place, or use replace_everywhere.
- Prices, mark-ups, which villas are hidden and the tourist-licence settings in settings.json cannot be changed from here (the tools refuse it). Do not hard-code villa prices or villa facts in page copy.

Photos:
- When ${user.name} attaches a photo you can see it, and its saved path is given in the message. Find the current image with list_images (match by page and by what it shows; you can open the live page to judge), then call replace_image. If the image has an alt text, write a new one that plainly describes the new photo (one short sentence, no marketing, never name a villa unless ${user.name} says which villa it is).
- The home page hero has a separate phone-size picture (image_mobile): ask whether to use the new photo on phones too unless the request says.
- The same photo is often used on two pages (e.g. the About photo on the home page). Change only the place requested unless asked for "everywhere".
- If it is not clear which image to replace, list the likely candidates by page and ask. You can also swap an image for another photo already on the site. You cannot add new image spots, change the logo or icons, or change villa photos (those come from IMpulse).
- If a photo looks unsuitable for a public luxury website (blurry, a screenshot, faces up close, text overlays, very dark, white borders), say so briefly and use it only if ${user.name} confirms.

Other rules:
- Undo: if asked to undo or roll back a change, tell ${user.name} to use the Undo buttons in the panel ("Undo last change" under Draft for changes not yet published, or "Undo" next to an item under Recently published, then Publish). Only edit by hand if the buttons said they couldn't undo it.
- You cannot add new pages or change how the site works (code). If asked, explain briefly and suggest asking Edo.
- British English, the site's calm, warm and understated tone. Do not invent facts (awards, numbers, addresses, prices). If the request is ambiguous or touches legal details (company name, NIF/tax number, privacy or terms), ask one short question before editing.
- When you finish, reply in 2–5 short sentences: what you changed and where (page names, not file paths), anything you deliberately left alone, and remind them to check the preview then Publish. No markdown headings, no code.`;
}

const TOOLS = [
  {
    name: "list_images",
    description:
      "List the site's own photos used in the page copy: file, line, the JSON key, the image path and its alt text if it has one. Optionally limit to one file. Use this to find the image to replace.",
    input_schema: { type: "object", properties: { path: { type: "string", description: "Optional file, e.g. content/home.json" } } },
  },
  {
    name: "replace_image",
    description:
      "Swap an image for another one. old_src is the current image path exactly as listed by list_images (e.g. /assets/img/hero.webp); new_src is an attached upload path or another image already on the site. Replaces it in the given file (path) or, if path is 'everywhere', in every file that uses it. alt: new description of the photo, used where the image has an alt text.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File to change, or 'everywhere'." },
        old_src: { type: "string" },
        new_src: { type: "string" },
        alt: { type: "string", description: "Short plain description of the new photo." },
      },
      required: ["path", "old_src", "new_src", "alt"],
    },
  },
  {
    name: "list_pages",
    description: "Show which file holds each page of the website.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_site",
    description:
      "Search all editable files (page copy JSON and the stylesheet) for a piece of text. Case-insensitive. Returns file, line number and a short excerpt for each match (max 80).",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to look for (exact substring)." } },
      required: ["text"],
    },
  },
  {
    name: "read_file",
    description: "Read part of a file with line numbers. Use start_line/end_line for big files.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "integer" },
        end_line: { type: "integer" },
      },
      required: ["path"],
    },
  },
  {
    name: "replace_in_file",
    description:
      "Replace exact text in one file. old_text must match exactly (including quotes, punctuation and escapes). Fails if not found, or if found more than once unless replace_all is true, or if the result is not valid JSON.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "replace_everywhere",
    description:
      "Replace exact text in every editable file where it appears (e.g. an old phone number repeated in several pages). Returns the files changed and how many replacements in each.",
    input_schema: {
      type: "object",
      properties: { old_text: { type: "string" }, new_text: { type: "string" } },
      required: ["old_text", "new_text"],
    },
  },
];

const countOf = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);

// Spans [start, end] of every {...} object in a JSON text, ignoring braces inside strings.
function objectSpans(text) {
  const spans = [];
  const stack = [];
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push(i);
    else if (c === "}" && stack.length) spans.push([stack.pop(), i]);
  }
  return spans;
}
const innermost = (spans, pos) =>
  spans.filter(([a, b]) => a < pos && pos < b).sort((x, y) => x[1] - x[0] - (y[1] - y[0]))[0] || null;
const ALT_RE = /"alt"\s*:\s*"((?:[^"\\]|\\.)*)"/;

// Swap every "old_src" value in a JSON text for new_src; update the alt text of the same object if it has one.
export function swapImageJson(text, oldSrc, newSrc, alt) {
  const needle = JSON.stringify(oldSrc);
  let count = 0;
  let out = text;
  let at = out.indexOf(needle);
  while (at !== -1) {
    const replacement = JSON.stringify(newSrc);
    out = out.slice(0, at) + replacement + out.slice(at + needle.length);
    count++;
    const span = innermost(objectSpans(out), at);
    if (span && alt) {
      const body = out.slice(span[0], span[1] + 1);
      if (ALT_RE.test(body)) {
        const nb = body.replace(ALT_RE, () => `"alt": ${JSON.stringify(alt)}`);
        out = out.slice(0, span[0]) + nb + out.slice(span[1] + 1);
      }
    }
    at = out.indexOf(needle, at + replacement.length);
  }
  return { text: out, count };
}

class Workspace {
  constructor() {
    this.files = null; // path -> blob sha (editable text files)
    this.images = new Set(); // existing site photos, e.g. assets/img/hero.webp
    this.staged = new Map(); // path -> new content
    this.uploads = new Map(); // site path (/assets/img/uploads/…) -> { repoPath, base64, width, height, used }
  }
  async load() {
    if (this.files) return;
    const head = await ensureDraft();
    const list = await treeFiles(head);
    this.files = new Map(list.filter((f) => editable(f.path)).map((f) => [f.path, f.sha]));
    this.images = new Set(list.filter((f) => /^assets\/img\/.+\.(webp|jpe?g|png|avif)$/i.test(f.path)).map((f) => f.path));
  }
  async read(path) {
    await this.load();
    if (this.staged.has(path)) return this.staged.get(path);
    const sha = this.files.get(path);
    if (!sha) throw new Error(`No editable file at ${path}. Use list_pages or search_site to find the right file.`);
    return blobText(sha);
  }
  async all() {
    await this.load();
    const paths = [...this.files.keys()];
    const texts = await Promise.all(paths.map((p) => this.read(p)));
    return paths.map((p, i) => [p, texts[i]]);
  }
  stage(path, before, after) {
    if (!editable(path)) throw new Error(`${path} cannot be edited from the control panel.`);
    if (after.length < before.length * 0.5) throw new Error("That edit would delete more than half of the file — refused for safety.");
    if (isJson(path)) {
      let a, b;
      try {
        b = JSON.parse(before);
        a = JSON.parse(after);
      } catch {
        throw new Error("That edit would break the file's format (invalid JSON), so it was refused. Change only the text inside the quotes and escape double quotes as \\\".");
      }
      for (const key of PROTECTED[path] || []) {
        if (JSON.stringify(pick(a, key)) !== JSON.stringify(pick(b, key))) {
          throw new Error(`"${key}" (prices, hidden villas, licence checks or the site address) can't be changed from the control panel. Leave it as it is; Edo can change it.`);
        }
      }
    }
    this.staged.set(path, after);
  }
}

async function runTool(ws, name, input) {
  switch (name) {
    case "list_pages":
      return PAGES;
    case "list_images": {
      const files = input.path ? [[String(input.path), await ws.read(String(input.path))]] : await ws.all();
      const out = [];
      for (const [path, text] of files) {
        if (!isJson(path)) continue;
        const spans = objectSpans(text);
        const re = /"([A-Za-z_]+)"\s*:\s*"(\/assets\/img\/[^"]+)"/g;
        let m;
        while ((m = re.exec(text))) {
          const line = text.slice(0, m.index).split("\n").length;
          const span = innermost(spans, m.index);
          const alt = span ? (text.slice(span[0], span[1] + 1).match(ALT_RE) || [])[1] : undefined;
          out.push(`${path}:${line}  ${m[1]}=${m[2]}${alt !== undefined ? `  alt="${alt}"` : ""}`);
        }
      }
      return out.length ? out.join("\n") : "No changeable images found there.";
    }
    case "replace_image": {
      const oldSrc = String(input.old_src || "").trim();
      const newSrc = String(input.new_src || "").trim();
      const alt = String(input.alt || "").trim();
      if (!oldSrc.startsWith("/assets/img/")) throw new Error("old_src must be an image path from list_images (starting /assets/img/).");
      const upload = ws.uploads.get(newSrc);
      if (!upload && !ws.images.has(newSrc.replace(/^\//, ""))) throw new Error(`${newSrc} is not an attached photo or an existing image on the site.`);
      const targets = input.path === "everywhere" ? await ws.all() : [[String(input.path), await ws.read(String(input.path))]];
      const changed = [];
      for (const [path, before] of targets) {
        if (!isJson(path)) continue;
        const { text, count } = swapImageJson(before, oldSrc, newSrc, alt);
        if (!count) continue;
        ws.stage(path, before, text);
        changed.push(`${path} (${count})`);
      }
      if (!changed.length) throw new Error(`No image ${oldSrc} found${input.path === "everywhere" ? "" : " in " + input.path}. Use list_images.`);
      if (upload) upload.used = true;
      return `Swapped the image in ${changed.join(", ")}.`;
    }
    case "search_site": {
      const q = String(input.text || "").toLowerCase();
      if (q.length < 2) throw new Error("Search text is too short.");
      const out = [];
      for (const [path, text] of await ws.all()) {
        text.split("\n").forEach((line, i) => {
          let at = line.toLowerCase().indexOf(q);
          while (at !== -1 && out.length < 80) {
            out.push(`${path}:${i + 1}: …${line.slice(Math.max(0, at - 90), at + q.length + 90).trim()}…`);
            at = line.toLowerCase().indexOf(q, at + q.length);
          }
        });
      }
      return out.length ? `${out.length} match(es):\n${out.join("\n")}` : "No matches.";
    }
    case "read_file": {
      const text = await ws.read(String(input.path));
      const lines = text.split("\n");
      const start = Math.max(1, input.start_line || 1);
      const end = Math.min(lines.length, input.end_line || start + 199);
      let body = lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join("\n");
      if (body.length > 60000) body = body.slice(0, 60000) + "\n[truncated — read a smaller line range]";
      return `${input.path} (lines ${start}-${end} of ${lines.length})\n${body}`;
    }
    case "replace_in_file": {
      const path = String(input.path);
      const before = await ws.read(path);
      const n = countOf(before, input.old_text);
      if (!n) throw new Error("old_text not found in that file. Search again and copy the text exactly.");
      if (n > 1 && !input.replace_all) throw new Error(`old_text appears ${n} times; make it more specific or set replace_all.`);
      const after = input.replace_all ? before.split(input.old_text).join(input.new_text) : before.replace(input.old_text, () => input.new_text);
      ws.stage(path, before, after);
      return `Replaced ${input.replace_all ? n : 1} occurrence(s) in ${path}.`;
    }
    case "replace_everywhere": {
      if (!input.old_text || input.old_text.length < 3) throw new Error("old_text is too short for a site-wide replace.");
      const changed = [];
      for (const [path, before] of await ws.all()) {
        const n = countOf(before, input.old_text);
        if (!n) continue;
        ws.stage(path, before, before.split(input.old_text).join(input.new_text));
        changed.push(`${path} (${n})`);
      }
      if (!changed.length) throw new Error("That text was not found anywhere.");
      return `Replaced in ${changed.length} file(s): ${changed.join(", ")}`;
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

async function claude(body) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  const res = await fetch(process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${json?.error?.message || "error"}`);
  return json;
}

// history: [{role:"user"|"assistant", content:string}], last item is the new user message.
export async function chat(user, history, images = []) {
  const ws = new Workspace();
  const imageBlocks = [];
  const notes = [];
  const month = new Date().toISOString().slice(0, 7);
  images.slice(0, 4).forEach((img, i) => {
    const m = String(img.data || "").match(/^data:(image\/(webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error("One of the photos could not be read. Please use a JPG, PNG or WebP image.");
    if (m[3].length > 4_800_000) throw new Error("One of the photos is too large. Please use a smaller photo.");
    const ext = m[2] === "jpeg" ? "jpg" : m[2];
    const base = String(img.name || `photo-${i + 1}`).replace(/\.[^.]+$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "photo";
    const sitePath = `/assets/img/uploads/${month}/${base}-${Math.random().toString(16).slice(2, 8)}.${ext}`;
    const width = Math.max(0, Math.min(10000, parseInt(img.width, 10) || 0));
    const height = Math.max(0, Math.min(10000, parseInt(img.height, 10) || 0));
    ws.uploads.set(sitePath, { repoPath: sitePath.slice(1), base64: m[3], width, height, name: img.name || "", used: false });
    imageBlocks.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[3] } });
    notes.push(`Attached photo ${i + 1} ("${img.name || "photo"}", ${width}×${height}) is saved as ${sitePath}`);
  });
  const messages = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new Error("No message to answer");
  if (imageBlocks.length) {
    const last = messages[messages.length - 1];
    last.content = [...imageBlocks, { type: "text", text: `${notes.join("\n")}\n\n${last.content}` }];
  }

  let reply = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await claude({ model: MODEL, max_tokens: 4096, system: systemPrompt(user), tools: TOOLS, messages });
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b) => b.type === "tool_use");
    reply = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (res.stop_reason !== "tool_use" || !uses.length) break;
    const results = [];
    for (const u of uses) {
      try {
        results.push({ type: "tool_result", tool_use_id: u.id, content: String(await runTool(ws, u.name, u.input || {})) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: u.id, content: e.message, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
    if (round === MAX_ROUNDS - 1) reply = reply || "I ran out of steps before finishing. Please try a smaller request.";
  }

  let commit = null;
  for (const u of ws.uploads.values()) if (u.used) ws.staged.set(u.repoPath, { base64: u.base64 });
  if (ws.staged.size) {
    const prompt = history[history.length - 1].content.replace(/\[\d+ photos? attached\]/g, "").replace(/\s+/g, " ").trim();
    const title = prompt.length > 72 ? prompt.slice(0, 69) + "…" : prompt;
    commit = await commitFiles(Object.fromEntries(ws.staged), `${title}\n\nEdited from the control panel by ${user.name}.`, {
      name: user.name,
      email: COMMIT_EMAIL,
    });
  }
  const unused = [...ws.uploads.values()].filter((u) => !u.used).map((u) => u.name);
  return { reply: reply || "Done.", changed: [...ws.staged.keys()], commit, unusedImages: unused };
}
