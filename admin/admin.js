/* The Ibiza Connection — control panel client. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const api = async (action, body) => {
    const res = await fetch(`/api/admin/?action=${action}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* empty */
    }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  };
  const when = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
  };
  const toast = (text) => {
    const t = $("[data-toast]");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), 4200);
  };
  const show = (view) => {
    document.querySelectorAll("[data-view]").forEach((el) => (el.hidden = el.dataset.view !== view));
  };

  /* Chat history lives in this browser tab only. */
  const KEY = "tic-cp-chat";
  let history = [];
  try {
    history = JSON.parse(sessionStorage.getItem(KEY) || "[]");
  } catch {
    history = [];
  }
  const saveHistory = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(history.slice(-30)));
    } catch {
      /* storage unavailable */
    }
  };

  const thread = $("[data-thread]");
  const addMsg = (role, text, meta) => {
    $("[data-welcome]").hidden = true;
    const el = document.createElement("div");
    el.className = `cp-msg cp-msg--${role === "user" ? "user" : "ai"}${role === "error" ? " cp-msg--error" : ""}`;
    if (role === "assistant" || role === "ai") {
      // Light formatting from the assistant: **bold** only; everything else stays plain text.
      el.innerHTML = String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    } else {
      el.textContent = text;
    }
    if (meta) {
      const m = document.createElement("span");
      m.className = "cp-msg__meta";
      m.append(meta);
      el.append(m);
    }
    thread.append(el);
    thread.scrollTop = thread.scrollHeight;
    return el;
  };
  const renderHistory = () => history.forEach((m) => addMsg(m.role, m.content));

  /* Draft + recent */
  let previewUrl = "";
  const pageName = (path) => {
    const map = {
      "content/home.json": "Home page",
      "content/settings.json": "Contact details, menu and footer",
      "content/destinations.json": "Destinations",
      "content/journal.json": "Journal",
      "assets/css/site.css": "Site styles",
    };
    if (map[path]) return map[path];
    if (path.startsWith("assets/img/uploads/")) return "New photo";
    const m = path.match(/^content\/pages\/(.+)\.json$/);
    if (m) return m[1].replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
    return path;
  };
  const refresh = async () => {
    try {
      const s = await api("status");
      previewUrl = s.previewUrl;
      const pend = s.pending;
      const list = $("[data-pending-list]");
      list.textContent = "";
      const has = pend.commits.length > 0;
      $("[data-pending-title]").textContent = has
        ? `${pend.commits.length} change${pend.commits.length === 1 ? "" : "s"} waiting`
        : "No changes waiting";
      pend.commits.forEach((c) => {
        const li = document.createElement("li");
        li.textContent = c.message;
        const sm = document.createElement("small");
        sm.textContent = `${c.author} · ${when(c.date)}`;
        li.append(sm);
        list.append(li);
      });
      if (has && pend.files.length) {
        const li = document.createElement("li");
        const names = [...new Set(pend.files.map((f) => pageName(f.path)))];
        li.textContent = `Pages affected: ${names.slice(0, 8).join(", ")}${names.length > 8 ? ` and ${names.length - 8} more` : ""}`;
        li.className = "cp-files";
        list.append(li);
      }
      $("[data-pending-actions]").hidden = !has;
      $("[data-pending-note]").hidden = !has;
      $("[data-preview]").href = previewUrl;
      const recent = $("[data-recent]");
      recent.textContent = "";
      s.recent.slice(0, 8).forEach((c) => {
        const li = document.createElement("li");
        li.className = "cp-recent";
        const text = document.createElement("span");
        text.textContent = c.message;
        const sm = document.createElement("small");
        sm.textContent = `${c.author} · ${when(c.date)}`;
        text.append(sm);
        const undo = document.createElement("button");
        undo.type = "button";
        undo.className = "cp-link";
        undo.textContent = "Undo";
        undo.setAttribute("aria-label", `Undo: ${c.message}`);
        undo.addEventListener("click", async () => {
          if (!confirmInline(undo, "Sure?")) return;
          undo.disabled = true;
          try {
            const r = await api("undo", { sha: c.sha });
            if (r.undone) {
              toast("Reversal added to the draft — check the preview, then Publish.");
              addMsg("ai", `I've put an undo of “${r.message}” into the draft (${r.files} file${r.files === 1 ? "" : "s"}). Check it in Preview, then click Publish to make it live.`);
              await refresh();
            } else {
              toast(r.reason);
            }
          } catch (err) {
            toast(err.message);
          } finally {
            undo.disabled = false;
          }
        });
        li.append(text, undo);
        recent.append(li);
      });
    } catch (e) {
      if (e.status === 401) return show("login");
      $("[data-pending-title]").textContent = "Draft status unavailable";
      toast(e.message);
    }
  };

  /* Compose */
  const form = $("[data-compose]");
  const input = $("#cp-input");
  input.dataset.placeholder = input.placeholder;
  const send = $("[data-send]");
  let busy = false;

  /* Photos: shrunk in the browser to WebP (max 2400px) before upload. */
  const tray = $("[data-tray]");
  const fileInput = $("[data-file]");
  let photos = []; // { name, data, width, height, url }
  const MAX_PHOTOS = 3;
  const loadImage = (file) =>
    new Promise((ok, fail) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => ok({ im, url });
      im.onerror = () => {
        URL.revokeObjectURL(url);
        fail(new Error(`${file.name}: this photo format can't be read here. Please use a JPG or PNG.`));
      };
      im.src = url;
    });
  const shrink = async (file) => {
    const { im, url } = await loadImage(file);
    let max = 2400;
    let quality = 0.86;
    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const w = Math.round(im.naturalWidth * scale);
      const h = Math.round(im.naturalHeight * scale);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(im, 0, 0, w, h);
      let data = c.toDataURL("image/webp", quality);
      if (!data.startsWith("data:image/webp")) data = c.toDataURL("image/jpeg", quality);
      if (data.length < 1_250_000 || attempt === 4) return { name: file.name, data, width: w, height: h, url };
      max = Math.round(max * 0.8);
      quality -= 0.06;
    }
  };
  const renderTray = () => {
    tray.textContent = "";
    tray.hidden = photos.length === 0;
    photos.forEach((p, i) => {
      const d = document.createElement("div");
      d.className = "cp-thumb";
      const img = document.createElement("img");
      img.src = p.url;
      img.alt = "";
      const s = document.createElement("small");
      s.textContent = p.name;
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", `Remove ${p.name}`);
      x.addEventListener("click", () => {
        photos.splice(i, 1);
        renderTray();
      });
      d.append(img, s, x);
      tray.append(d);
    });
  };
  const addFiles = async (files) => {
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    for (const f of list) {
      if (photos.length >= MAX_PHOTOS) {
        toast(`Up to ${MAX_PHOTOS} photos per message.`);
        break;
      }
      try {
        photos.push(await shrink(f));
        renderTray();
      } catch (err) {
        toast(err.message);
      }
    }
    if (list.length && !input.value.trim()) input.placeholder = "Say where the photo should go, e.g. “Use this as the main picture on the home page”";
  };
  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
    fileInput.value = "";
  });
  input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  });
  const chatBox = $(".cp-chat");
  ["dragenter", "dragover"].forEach((t) =>
    chatBox.addEventListener(t, (e) => {
      if ([...(e.dataTransfer?.types || [])].includes("Files")) {
        e.preventDefault();
        chatBox.classList.add("is-drop");
      }
    })
  );
  ["dragleave", "drop"].forEach((t) => chatBox.addEventListener(t, () => chatBox.classList.remove("is-drop")));
  chatBox.addEventListener("drop", (e) => {
    if (e.dataTransfer?.files?.length) {
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    }
  });

  const submit = async () => {
    const text = input.value.trim();
    if (busy) return;
    if (!text && photos.length) {
      toast("Tell me where the photo should go.");
      input.focus();
      return;
    }
    if (!text) return;
    busy = true;
    send.disabled = true;
    input.value = "";
    input.placeholder = input.dataset.placeholder || input.placeholder;
    const sending = photos;
    photos = [];
    renderTray();
    history.push({ role: "user", content: text + (sending.length ? `\n[${sending.length} photo${sending.length === 1 ? "" : "s"} attached]` : "") });
    saveHistory();
    const bubble = addMsg("user", text);
    if (sending.length) {
      const strip = document.createElement("div");
      strip.className = "cp-msg__photos";
      sending.forEach((p) => {
        const im = document.createElement("img");
        im.src = p.url;
        im.alt = p.name;
        strip.append(im);
      });
      bubble.append(strip);
    }
    const typing = addMsg("ai", "");
    typing.innerHTML = '<span class="cp-typing"><i></i><i></i><i></i> Working on it — this can take up to a minute</span>';
    try {
      const r = await api("chat", {
        messages: history,
        images: sending.map(({ name, data, width, height }) => ({ name, data, width, height })),
      });
      typing.remove();
      history.push({ role: "assistant", content: r.reply });
      saveHistory();
      // Photos Claude didn't use yet stay in the tray for the next message.
      if (r.unusedImages && r.unusedImages.length) {
        photos = sending.filter((p) => r.unusedImages.includes(p.name));
        renderTray();
      }
      let meta = null;
      if (r.commit) {
        meta = document.createDocumentFragment();
        meta.append(`Saved to the draft · ${r.changed.length} file${r.changed.length === 1 ? "" : "s"} · `);
        const a = document.createElement("a");
        a.href = previewUrl;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Open preview";
        meta.append(a);
      }
      addMsg("ai", r.reply, meta);
      if (r.commit) refresh();
    } catch (e) {
      typing.remove();
      if (e.status === 401) return show("login");
      history.pop();
      saveHistory();
      addMsg("error", `Sorry — ${e.message}`);
      input.value = text;
      photos = [...sending, ...photos].slice(0, MAX_PHOTOS);
      renderTray();
    } finally {
      busy = false;
      send.disabled = false;
      if (window.matchMedia("(pointer: fine)").matches) input.focus();
    }
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  document.querySelectorAll("[data-example]").forEach((b) =>
    b.addEventListener("click", () => {
      input.value = b.dataset.example;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    })
  );

  /* Publish / discard */
  $("[data-publish]").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (!confirmInline(btn, "Publish to the live site?")) return;
    btn.disabled = true;
    try {
      const r = await api("publish", {});
      toast(r.published ? "Published — the live site updates in about 3–4 minutes." : r.reason);
      await refresh();
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });
  $("[data-discard]").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (!confirmInline(btn, "Click again to throw away the draft")) return;
    try {
      await api("discard", {});
      toast("Draft discarded.");
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  });
  // Two-click confirmation without browser dialogs.
  function confirmInline(btn, label) {
    if (btn.dataset.armed) {
      delete btn.dataset.armed;
      btn.textContent = btn.dataset.label;
      return true;
    }
    btn.dataset.label = btn.textContent;
    btn.dataset.armed = "1";
    btn.textContent = label.length > 26 ? "Click again to confirm" : label;
    setTimeout(() => {
      if (btn.dataset.armed) {
        delete btn.dataset.armed;
        btn.textContent = btn.dataset.label;
      }
    }, 5000);
    return false;
  }
  $("[data-undo-draft]").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (!confirmInline(btn, "Click again to undo")) return;
    try {
      const r = await api("undo-draft", {});
      toast(r.undone ? `Removed from the draft: ${r.message}` : r.reason);
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  });
  $("[data-refresh]").addEventListener("click", refresh);

  /* Auth */
  $("[data-login]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const err = $("[data-login-error]");
    err.hidden = true;
    try {
      const r = await api("login", { email: f.email.value, password: f.password.value });
      f.password.value = "";
      start(r.user);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  $("[data-logout]").addEventListener("click", async () => {
    await api("logout", {}).catch(() => {});
    history = [];
    saveHistory();
    location.reload();
  });

  function start(user) {
    $("[data-user]").textContent = user.name;
    show("app");
    renderHistory();
    refresh();
    if (window.matchMedia("(pointer: fine)").matches) input.focus();
  }

  api("me")
    .then((r) => {
      previewUrl = r.previewUrl;
      start(r.user);
    })
    .catch(() => show("login"));
})();
