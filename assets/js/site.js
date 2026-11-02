/* The Ibiza Connection — site behaviour (no dependencies) */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const body = document.body;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const PRICE_LABELS = {
    "0-7500": "Under €7,500",
    "7500-15000": "€7,500 – €15,000",
    "15000-30000": "€15,000 – €30,000",
    "30000-": "€30,000+",
  };

  /* ------------------------------------------------------------------ */
  /*  Header                                                             */
  /* ------------------------------------------------------------------ */
  const header = $("[data-header]");
  if (header) {
    const onScroll = () => header.classList.toggle("is-stuck", window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ------------------------------------------------------------------ */
  /*  Menu                                                               */
  /* ------------------------------------------------------------------ */
  const toggle = $("[data-menu-toggle]");
  const menu = $("#site-menu");
  let lastFocus = null;

  const setMenu = (open) => {
    if (!menu || !toggle) return;
    body.classList.toggle("menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-hidden", String(!open));
    if (open) {
      lastFocus = document.activeElement;
      const first = $("a", menu);
      if (first) setTimeout(() => first.focus(), 120);
    } else if (lastFocus) {
      lastFocus.focus();
    }
  };

  if (toggle && menu) {
    toggle.addEventListener("click", () => setMenu(!body.classList.contains("menu-open")));
    $$("a", menu).forEach((link) => link.addEventListener("click", () => setMenu(false)));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && body.classList.contains("menu-open")) setMenu(false);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Reveal on scroll                                                   */
  /* ------------------------------------------------------------------ */
  const revealEls = $$(".reveal");
  if (revealEls.length && "IntersectionObserver" in window && !reduceMotion) {
    const groups = new Map();
    revealEls.forEach((el) => {
      const parent = el.parentElement;
      const index = groups.get(parent) || 0;
      groups.set(parent, index + 1);
      el.style.setProperty("--d", `${Math.min(index * 70, 280)}ms`);
    });
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 }
    );
    revealEls.forEach((el) => observer.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-in"));
  }

  /* ------------------------------------------------------------------ */
  /*  Saved villas                                                       */
  /* ------------------------------------------------------------------ */
  const STORE_KEY = "tic-saved-villas";
  const readSaved = () => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      return [];
    }
  };
  const writeSaved = (list) => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch (error) {
      /* storage disabled — favourites are a bonus, not a requirement */
    }
  };
  let saved = readSaved();

  const paintSaved = () => {
    $$("[data-fav]").forEach((button) => {
      const isSaved = saved.includes(button.dataset.fav);
      button.setAttribute("aria-pressed", String(isSaved));
      button.classList.toggle("is-saved", isSaved);
    });
  };

  $$("[data-fav]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const slug = button.dataset.fav;
      saved = saved.includes(slug) ? saved.filter((item) => item !== slug) : [...saved, slug];
      writeSaved(saved);
      paintSaved();
      document.dispatchEvent(new CustomEvent("saved:change"));
    });
  });
  paintSaved();

  /* ------------------------------------------------------------------ */
  /*  Lightbox                                                           */
  /* ------------------------------------------------------------------ */
  const lightbox = $("[data-lightbox]");
  let gallery = [];
  let lightboxIndex = 0;
  let lightboxTrigger = null;

  const galleryData = $("#villa-gallery");
  if (galleryData) {
    try {
      gallery = JSON.parse(galleryData.textContent || "[]");
    } catch (error) {
      gallery = [];
    }
  }

  const renderLightbox = () => {
    if (!lightbox || !gallery.length) return;
    const item = gallery[lightboxIndex];
    const image = $("[data-lightbox-img]", lightbox);
    const count = $("[data-lightbox-count]", lightbox);
    const caption = $("[data-lightbox-caption]", lightbox);
    image.src = item.src;
    image.alt = item.alt || "";
    count.textContent = `${lightboxIndex + 1} / ${gallery.length}`;
    caption.textContent = item.caption || "";
  };

  const openLightbox = (index, trigger) => {
    if (!lightbox || !gallery.length) return;
    lightboxIndex = Math.max(0, Math.min(index, gallery.length - 1));
    lightboxTrigger = trigger || null;
    renderLightbox();
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    body.classList.add("menu-open");
    const close = $("[data-lightbox-close]", lightbox);
    if (close) close.focus();
  };

  const closeLightbox = () => {
    if (!lightbox) return;
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    if (!body.classList.contains("menu-open")) return;
    body.classList.remove("menu-open");
    if (lightboxTrigger) lightboxTrigger.focus();
  };

  const stepLightbox = (delta) => {
    if (!gallery.length) return;
    lightboxIndex = (lightboxIndex + delta + gallery.length) % gallery.length;
    renderLightbox();
  };

  $$("[data-gallery-open]").forEach((trigger) => {
    trigger.addEventListener("click", () => openLightbox(Number(trigger.dataset.galleryOpen) || 0, trigger));
  });

  if (lightbox) {
    $("[data-lightbox-close]", lightbox)?.addEventListener("click", closeLightbox);
    $("[data-lightbox-prev]", lightbox)?.addEventListener("click", () => stepLightbox(-1));
    $("[data-lightbox-next]", lightbox)?.addEventListener("click", () => stepLightbox(1));
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox || event.target.classList.contains("lightbox__stage")) closeLightbox();
    });
    document.addEventListener("keydown", (event) => {
      if (!lightbox.classList.contains("is-open")) return;
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowRight") stepLightbox(1);
      if (event.key === "ArrowLeft") stepLightbox(-1);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Date range: one field, one calendar for check-in and check-out      */
  /*  (same behaviour as the Invenio portal's DateRangePicker): tap the   */
  /*  check-in day, then the check-out day (or a 7/10/14/21-night         */
  /*  shortcut), then Apply. Popover on desktop, bottom sheet on phones.  */
  /*  The dates travel in the two hidden inputs inside [data-date-range]; */
  /*  Apply fires "change" on the check-out input.                        */
  /* ------------------------------------------------------------------ */
  const DR_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DR_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DR_DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DR_WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DR_MONTHS_SHOWN = 18;
  const drParse = (value) => new Date(`${value}T00:00:00Z`);
  const drIso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const drAddDays = (value, n) => {
    const d = drParse(value);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const drNights = (a, b) => Math.round((drParse(b) - drParse(a)) / 86400000);
  const drDay = (value) => {
    const d = drParse(value);
    return `${DR_WD[d.getUTCDay()]} ${d.getUTCDate()} ${DR_SHORT[d.getUTCMonth()]}`;
  };
  const drInputs = (root) => $$('input[type="hidden"]', root);

  const syncDateRange = (root) => {
    const [fromIn, toIn] = drInputs(root);
    const out = $("[data-date-range-value]", root);
    const has = Boolean(fromIn?.value && toIn?.value);
    if (out) {
      out.textContent = has
        ? `${drDay(fromIn.value)} – ${drDay(toIn.value)} · ${drNights(fromIn.value, toIn.value)} nights`
        : "Add dates";
    }
    root.classList.toggle("has-value", has);
  };
  const syncAllDateRanges = () => $$("[data-date-range]").forEach(syncDateRange);

  let closeDateRange = null;
  const openDateRange = (root) => {
    if (closeDateRange) closeDateRange();
    const [fromIn, toIn] = drInputs(root);
    const trigger = $(".date-range__trigger", root);
    let start = fromIn.value || null;
    let end = toIn.value || null;
    const today = new Date().toISOString().slice(0, 10);
    const y0 = Number(today.slice(0, 4));
    const m0 = Number(today.slice(5, 7)) - 1;
    const months = Array.from({ length: DR_MONTHS_SHOWN }, (_, i) => ({
      y: y0 + Math.floor((m0 + i) / 12),
      m: (m0 + i) % 12,
    }));

    const monthHtml = ({ y, m }) => {
      const first = new Date(Date.UTC(y, m, 1)).getUTCDay(); // 0 = Sunday
      const blanks = (first + 6) % 7; // weeks start on Monday
      const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      let cells = DR_DOW.map((d) => `<span class="dr-dow">${d}</span>`).join("");
      cells += '<span class="dr-blank"></span>'.repeat(blanks);
      for (let d = 1; d <= days; d += 1) {
        const value = drIso(y, m, d);
        const past = value < today;
        cells += `<button type="button" class="dr-day" data-day="${value}"${past ? " disabled" : ""}>${d}</button>`;
      }
      return `<section class="dr-month" data-month="${drIso(y, m, 1).slice(0, 7)}"><h5>${DR_MONTHS[m]} ${y}</h5><div class="dr-grid">${cells}</div></section>`;
    };

    const scrim = document.createElement("div");
    scrim.className = "dr-scrim";
    const panel = document.createElement("div");
    panel.className = "dr-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Choose your check-in and check-out dates");
    panel.innerHTML = `
      <div class="dr-head">
        <div><div class="dr-title" data-dr-title></div><div class="dr-hint" data-dr-hint></div></div>
        <button type="button" class="dr-close" aria-label="Close">×</button>
      </div>
      <div class="dr-quick" data-dr-quick></div>
      <div class="dr-jump">${months
        .map(({ y, m }) => `<button type="button" data-jump="${drIso(y, m, 1).slice(0, 7)}">${DR_SHORT[m]} ${String(y).slice(2)}</button>`)
        .join("")}</div>
      <div class="dr-months" data-dr-months>${months.map(monthHtml).join("")}</div>
      <div class="dr-foot">
        <button type="button" class="dr-clear">Clear dates</button>
        <button type="button" class="btn btn--small dr-apply">Apply</button>
      </div>`;
    document.body.append(scrim, panel);
    const monthsEl = $("[data-dr-months]", panel);
    const applyBtn = $(".dr-apply", panel);
    const phone = window.matchMedia("(max-width: 640px)").matches;
    const prevOverflow = body.style.overflow;
    if (phone) body.style.overflow = "hidden";

    const place = () => {
      if (window.matchMedia("(max-width: 640px)").matches) {
        panel.classList.add("is-sheet");
        panel.style.top = panel.style.left = "";
        return;
      }
      panel.classList.remove("is-sheet");
      const r = trigger.getBoundingClientRect();
      const width = panel.offsetWidth;
      const left = Math.max(16, Math.min(r.left, window.innerWidth - width - 16));
      const h = panel.offsetHeight;
      // Below the field if it fits, else above it, else as low as possible while staying on screen.
      let top = r.bottom + 8;
      if (top + h > window.innerHeight - 8) top = r.top - h - 8 >= 8 ? r.top - h - 8 : window.innerHeight - h - 8;
      panel.style.left = `${left + window.scrollX}px`;
      panel.style.top = `${Math.max(8, top) + window.scrollY}px`;
    };

    const render = () => {
      const n = start && end ? drNights(start, end) : 0;
      $("[data-dr-title]", panel).innerHTML = `${start ? drDay(start) : "Check in"} <span>to</span> ${end ? drDay(end) : "Check out"}`;
      $("[data-dr-hint]", panel).textContent = !start ? "Tap your check-in day" : !end ? "Now tap your check-out day" : `${n} nights`;
      $("[data-dr-quick]", panel).innerHTML = start
        ? `<span>Quick</span>${[7, 10, 14, 21]
            .map((k) => `<button type="button" data-nights="${k}" class="${end === drAddDays(start, k) ? "is-on" : ""}">${k} nights</button>`)
            .join("")}`
        : "";
      $$(".dr-day", panel).forEach((el) => {
        const d = el.dataset.day;
        el.classList.toggle("is-start", d === start);
        el.classList.toggle("is-end", d === end);
        el.classList.toggle("is-in", Boolean(start && end && d > start && d < end));
      });
      applyBtn.disabled = Boolean(start && !end);
      applyBtn.textContent = !start && !end ? "Apply" : end ? `Apply · ${n} nights` : "Apply";
    };

    const close = () => {
      scrim.remove();
      panel.remove();
      body.style.overflow = prevOverflow;
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      closeDateRange = null;
      trigger.focus();
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    const apply = () => {
      if (start && !end) return;
      fromIn.value = start || "";
      toIn.value = end || "";
      syncDateRange(root);
      close();
      toIn.dispatchEvent(new Event("change", { bubbles: true }));
    };

    panel.addEventListener("click", (event) => {
      const day = event.target.closest(".dr-day");
      if (day && !day.disabled) {
        const d = day.dataset.day;
        if (!start || end || d <= start) {
          start = d;
          end = null;
        } else {
          end = d;
        }
        render();
        return;
      }
      const quick = event.target.closest("[data-nights]");
      if (quick && start) {
        end = drAddDays(start, Number(quick.dataset.nights));
        render();
        const target = $(`[data-month="${end.slice(0, 7)}"]`, panel);
        if (target && end.slice(0, 7) !== start.slice(0, 7)) monthsEl.scrollTop = target.offsetTop - monthsEl.offsetTop;
        return;
      }
      const jump = event.target.closest("[data-jump]");
      if (jump) {
        const target = $(`[data-month="${jump.dataset.jump}"]`, panel);
        if (target) monthsEl.scrollTop = target.offsetTop - monthsEl.offsetTop;
        return;
      }
      if (event.target.closest(".dr-close")) close();
      else if (event.target.closest(".dr-clear")) {
        start = null;
        end = null;
        render();
      } else if (event.target.closest(".dr-apply")) apply();
    });
    scrim.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    trigger.setAttribute("aria-expanded", "true");
    closeDateRange = close;

    render();
    place();
    const anchor = $(`[data-month="${(start || today).slice(0, 7)}"]`, panel);
    if (anchor) monthsEl.scrollTop = anchor.offsetTop - monthsEl.offsetTop;
    ($(".dr-day.is-start", panel) || $(".dr-day:not([disabled])", panel))?.focus({ preventScroll: true });
  };

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest(".date-range__trigger");
    if (trigger) openDateRange(trigger.closest("[data-date-range]"));
  });
  syncAllDateRanges();

  /* Hero search: leave empty fields out of the URL. */
  $$(".search-panel").forEach((form) =>
    form.addEventListener("submit", () => {
      $$("input[name], select[name]", form).forEach((el) => {
        if (!el.value) el.disabled = true;
      });
      setTimeout(() => $$("input[name], select[name]", form).forEach((el) => (el.disabled = false)), 0);
    })
  );

  /* ------------------------------------------------------------------ */
  /*  Villa filters                                                      */
  /* ------------------------------------------------------------------ */
  const results = $("[data-results]");
  if (results) {
    const cards = $$("[data-villa]", results);
    const searchInput = $("[data-search]");
    const filterEls = $$("[data-filter]");
    const featureEls = $$("[data-feature]");
    const countEl = $("[data-count]");
    const drawerCount = $("[data-drawer-count]");
    const chipsEl = $("[data-active-filters]");
    const emptyEl = $("[data-empty]");
    const moreBtn = $("[data-load-more]");
    const moreWrap = $("[data-more-wrap]");
    const drawer = $("[data-drawer]");
    const step = 12;
    let visible = step;
    let availabilitySet = null;
    let availabilityRequest = 0;
    let savedOnly = false;
    const noteEl = $("[data-availability-note]");
    const dateFrom = $('[data-date="from"]');
    const dateTo = $('[data-date="to"]');
    const savedToggle = $("[data-saved]");
    const savedCounts = $$("[data-saved-count]");
    const todayIso = new Date().toISOString().slice(0, 10);

    const params = new URLSearchParams(window.location.search);
    // "Where" (portal districts and areas): d:<district> or a:<district>|<area>.
    // Older links (?region=<slug>, ?area=<name>, ?bedrooms=<n>) still work.
    const legacyWhere = () => {
      const RENAMED = { north: "san-juan", west: "san-antonio", "south-west": "san-jose", east: "santa-eulalia", "ibiza-town": "ibiza" };
      const region = RENAMED[params.get("region")] || params.get("region");
      const area = params.get("area");
      if (area) {
        const card = cards.find((c) => c.dataset.area === area);
        if (card) return `a:${card.dataset.district}|${area}`;
      }
      if (region) {
        const card = cards.find((c) => c.dataset.region === region);
        if (card) return `d:${card.dataset.district}`;
      }
      return "";
    };
    const initial = {
      q: params.get("q") || "",
      where: params.get("where") || legacyWhere(),
      guests: params.get("guests") || "",
      bmin: params.get("bmin") || params.get("bedrooms") || "",
      bmax: params.get("bmax") || "",
      price: params.get("price") || "",
      features: (params.get("features") || "").split(",").filter(Boolean),
      sort: params.get("sort") || "featured",
      arrive: params.get("arrive") || "",
      depart: params.get("depart") || "",
    };

    const controlsFor = (name) => filterEls.filter((item) => item.dataset.filter === name);
    const setControl = (name, value) => {
      controlsFor(name).forEach((el) => {
        el.value = value || "";
      });
    };

    if (searchInput) searchInput.value = initial.q;
    ["where", "guests", "bmin", "bmax", "price", "sort"].forEach((name) => setControl(name, initial[name]));
    featureEls.forEach((el) => {
      el.checked = initial.features.includes(el.dataset.feature);
    });
    if (dateFrom && dateTo && initial.arrive >= todayIso && initial.depart > initial.arrive) {
      dateFrom.value = initial.arrive;
      dateTo.value = initial.depart;
    }
    syncAllDateRanges();

    const currentState = () => ({
      q: (searchInput?.value || "").trim().toLowerCase(),
      where: filterEls.find((el) => el.dataset.filter === "where")?.value || "",
      guests: filterEls.find((el) => el.dataset.filter === "guests")?.value || "",
      bmin: filterEls.find((el) => el.dataset.filter === "bmin")?.value || "",
      bmax: filterEls.find((el) => el.dataset.filter === "bmax")?.value || "",
      price: filterEls.find((el) => el.dataset.filter === "price")?.value || "",
      sort: filterEls.find((el) => el.dataset.filter === "sort")?.value || "featured",
      features: featureEls.filter((el) => el.checked).map((el) => el.dataset.feature),
      dates: { from: dateFrom?.value || "", to: dateTo?.value || "" },
    });

    const inPrice = (price, bucket) => {
      if (!bucket) return true;
      if (!price) return false;
      const [min, max] = bucket.split("-");
      if (!min) return price <= Number(max);
      if (!max) return price >= Number(min);
      return price >= Number(min) && price <= Number(max);
    };

    const matches = (card, state) => {
      const features = (card.dataset.features || "").split(" ").filter(Boolean);
      if (state.q && !`${card.dataset.name} ${card.dataset.area}`.toLowerCase().includes(state.q)) return false;
      if (state.where.startsWith("d:") && card.dataset.district !== state.where.slice(2)) return false;
      if (state.where.startsWith("a:")) {
        const [district, area] = state.where.slice(2).split("|");
        if (card.dataset.district !== district || card.dataset.area !== area) return false;
      }
      if (state.guests && Number(card.dataset.sleeps) < Number(state.guests)) return false;
      const beds = Number(card.dataset.bedrooms);
      if (state.bmin && beds < Number(state.bmin)) return false;
      if (state.bmax && beds > Number(state.bmax)) return false;
      if (!inPrice(Number(card.dataset.price), state.price)) return false;
      if (state.features.some((feature) => !features.includes(feature))) return false;
      if (availabilitySet && !availabilitySet.has(String(card.dataset.uuid || "").toLowerCase())) return false;
      if (savedOnly && !saved.includes(card.dataset.slug)) return false;
      return true;
    };

    const sortCards = (list, sort) => {
      const clone = [...list];
      if (sort === "price-asc") clone.sort((a, b) => (Number(a.dataset.price) || 1e9) - (Number(b.dataset.price) || 1e9));
      else if (sort === "price-desc") clone.sort((a, b) => Number(b.dataset.price) - Number(a.dataset.price));
      else if (sort === "sleeps") clone.sort((a, b) => Number(b.dataset.sleeps) - Number(a.dataset.sleeps));
      else if (sort === "name") clone.sort((a, b) => a.dataset.name.localeCompare(b.dataset.name));
      else clone.sort((a, b) => cardOrder.get(a) - cardOrder.get(b));
      return clone;
    };

    const cardOrder = new Map(cards.map((card, index) => [card, index]));

    const makeChip = (label, action, value) =>
      `<span class="chip">${label}<button type="button" aria-label="Remove filter: ${label}" data-chip="${action}" data-value="${value || ""}">×</button></span>`;

    const renderChips = (state) => {
      if (!chipsEl) return;
      const chips = [];
      if (state.q) chips.push(makeChip(`“${state.q}”`, "q"));
      if (state.where) {
        const option = $(`[data-filter="where"] option[value="${CSS.escape(state.where)}"]`);
        const label = option ? option.textContent.replace(/\s*\(\d+\)$/, "").replace(/^All of /, "") : state.where.slice(2);
        chips.push(makeChip(label, "where"));
      }
      if (state.guests) chips.push(makeChip(`${state.guests}+ guests`, "guests"));
      if (state.bmin || state.bmax) {
        const label =
          state.bmin && state.bmax
            ? state.bmin === state.bmax
              ? `${state.bmin} bedrooms`
              : `${state.bmin}–${state.bmax} bedrooms`
            : state.bmin
              ? `${state.bmin}+ bedrooms`
              : `Up to ${state.bmax} bedrooms`;
        chips.push(makeChip(label, "beds"));
      }
      if (state.price) chips.push(makeChip(PRICE_LABELS[state.price] || state.price, "price"));
      if (state.dates.from && state.dates.to) chips.push(makeChip(formatRange(state.dates.from, state.dates.to), "dates"));
      if (savedOnly) chips.push(makeChip("Saved villas", "saved"));
      state.features.forEach((feature) => {
        const el = featureEls.find((item) => item.dataset.feature === feature);
        const label = el ? el.textContent.split("(")[0].trim() : feature.replace(/-/g, " ");
        chips.push(makeChip(label, `feature:${feature}`));
      });
      chipsEl.innerHTML = chips.join("");
    };

    const syncUrl = (state) => {
      const params = new URLSearchParams();
      if (state.q) params.set("q", state.q);
      if (state.where) params.set("where", state.where);
      if (state.guests) params.set("guests", state.guests);
      if (state.bmin) params.set("bmin", state.bmin);
      if (state.bmax) params.set("bmax", state.bmax);
      if (state.price) params.set("price", state.price);
      if (state.dates.from) params.set("arrive", state.dates.from);
      if (state.dates.to) params.set("depart", state.dates.to);
      if (state.features.length) params.set("features", state.features.join(","));
      if (state.sort && state.sort !== "featured") params.set("sort", state.sort);
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    };

    const formatDate = (value) =>
      new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const formatRange = (from, to) =>
      `${new Date(`${from}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${formatDate(to)}`;

    const setNote = (html, muted = false) => {
      if (!noteEl) return;
      noteEl.hidden = !html;
      noteEl.innerHTML = html;
      noteEl.classList.toggle("is-muted", muted);
    };

    const loadAvailability = async () => {
      const from = dateFrom?.value || "";
      const to = dateTo?.value || "";
      const request = ++availabilityRequest;
      availabilitySet = null;

      if (!from || !to) {
        setNote("");
        apply();
        return;
      }
      if (to <= from) {
        setNote("Please choose a departure date after your arrival.", true);
        apply();
        return;
      }
      if (dateTo) dateTo.min = from;
      const range = formatRange(from, to);
      setNote(`Checking live availability for <strong>${range}</strong>…`);
      apply();

      try {
        const response = await fetch("/api/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, to }),
        });
        if (!response.ok) throw new Error("unavailable");
        const data = await response.json();
        if (request !== availabilityRequest) return;
        if (data.ok && Array.isArray(data.villas)) {
          availabilitySet = new Set(data.villas.map((villa) => String(villa.uuid || "").toLowerCase()));
          const availableHere = cards.filter((card) =>
            availabilitySet.has(String(card.dataset.uuid || "").toLowerCase())
          ).length;
          setNote(
            `Live availability checked for <strong>${range}</strong>: <strong>${availableHere}</strong> villas available. Use the filters to narrow the list.`
          );
        } else {
          setNote("We could not check live availability for those dates — send them to us and we will confirm.", true);
        }
      } catch (error) {
        if (request !== availabilityRequest) return;
        setNote(
          "Live availability is not connected here — send us your dates and we will confirm by email or WhatsApp.",
          true
        );
      }
      apply();
    };

    const apply = (resetStep = true) => {
      if (resetStep) visible = step;
      const state = currentState();
      const matched = cards.filter((card) => matches(card, state));
      const ordered = sortCards(matched, state.sort);
      ordered.forEach((card) => results.appendChild(card));
      cards.forEach((card) => {
        const index = ordered.indexOf(card);
        card.hidden = index === -1 || index >= visible;
      });
      if (countEl) countEl.textContent = String(matched.length);
      if (drawerCount) drawerCount.textContent = String(matched.length);
      if (emptyEl) emptyEl.classList.toggle("is-visible", matched.length === 0);
      if (moreWrap) moreWrap.hidden = visible >= matched.length;
      if (moreBtn) moreBtn.textContent = `Load more villas (${Math.max(0, matched.length - visible)})`;
      renderChips(state);
      syncUrl(state);
    };

    // Bedrooms from–to: whole numbers 1–30, and "to" never below "from" (as on the portal).
    const normaliseBeds = () => {
      const lo = controlsFor("bmin")[0];
      const hi = controlsFor("bmax")[0];
      const clean = (el) => {
        if (!el) return "";
        const n = Math.round(Number(el.value));
        el.value = el.value === "" || !Number.isFinite(n) || n < 1 ? "" : String(Math.min(n, 30));
        return el.value;
      };
      const a = clean(lo);
      const b = clean(hi);
      if (a && b && Number(b) < Number(a) && hi) hi.value = a;
    };
    filterEls.forEach((el) =>
      el.addEventListener("change", () => {
        if (el.dataset.filter === "bmin" || el.dataset.filter === "bmax") normaliseBeds();
        controlsFor(el.dataset.filter).forEach((other) => {
          if (other !== el) other.value = el.value;
        });
        apply();
      })
    );
    featureEls.forEach((el) => el.addEventListener("change", () => apply()));
    if (searchInput) {
      let timer;
      searchInput.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => apply(), 180);
      });
    }
    if (moreBtn) {
      moreBtn.addEventListener("click", () => {
        visible += step;
        apply(false);
      });
    }
    if (chipsEl) {
      chipsEl.addEventListener("click", (event) => {
        const button = event.target.closest("[data-chip]");
        if (!button) return;
        const action = button.dataset.chip;
        if (action === "q" && searchInput) searchInput.value = "";
        else if (action === "saved") {
          savedOnly = false;
          if (savedToggle) savedToggle.checked = false;
        } else if (action === "beds") {
          setControl("bmin", "");
          setControl("bmax", "");
        } else if (action === "dates") {
          if (dateFrom) dateFrom.value = "";
          if (dateTo) dateTo.value = "";
          syncAllDateRanges();
          availabilitySet = null;
          availabilityRequest += 1;
          setNote("");
        } else if (action.indexOf("feature:") === 0) {
          const feature = action.slice(8);
          const el = featureEls.find((item) => item.dataset.feature === feature);
          if (el) el.checked = false;
        } else {
          setControl(action, "");
        }
        apply();
      });
    }

    const clearAll = () => {
      if (searchInput) searchInput.value = "";
      filterEls.forEach((el) => {
        el.value = el.dataset.filter === "sort" ? "featured" : "";
      });
      featureEls.forEach((el) => (el.checked = false));
      if (dateFrom) dateFrom.value = "";
      if (dateTo) dateTo.value = "";
      syncAllDateRanges();
      if (savedToggle) savedToggle.checked = false;
      savedOnly = false;
      availabilitySet = null;
      availabilityRequest += 1;
      setNote("");
      apply();
    };
    $$("[data-clear]").forEach((button) => button.addEventListener("click", clearAll));

    /* Drawer */
    if (drawer) {
      const open = () => {
        drawer.classList.add("is-open");
        drawer.setAttribute("aria-hidden", "false");
        body.style.overflow = "hidden";
        $("[data-filter]", drawer)?.focus();
      };
      const close = () => {
        drawer.classList.remove("is-open");
        drawer.setAttribute("aria-hidden", "true");
        body.style.overflow = "";
      };
      $$("[data-drawer-open]").forEach((button) => button.addEventListener("click", open));
      $$("[data-drawer-close]", drawer).forEach((button) => button.addEventListener("click", close));
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && drawer.classList.contains("is-open")) close();
      });
    }

    const updateSaved = () => {
      savedCounts.forEach((el) => {
        el.textContent = String(saved.length);
      });
    };
    updateSaved();
    if (savedToggle) {
      savedToggle.addEventListener("change", () => {
        savedOnly = savedToggle.checked;
        apply();
      });
    }
    document.addEventListener("saved:change", () => {
      updateSaved();
      if (savedOnly) apply();
    });

    if (dateFrom && dateTo) {
      // The date-range picker sets both dates and fires "change" on the check-out input.
      dateTo.addEventListener("change", () => loadAvailability());
    }

    if (dateFrom?.value && dateTo?.value) loadAvailability();
    else apply();
  }

  /* ------------------------------------------------------------------ */
  /*  Booking availability                                               */
  /* ------------------------------------------------------------------ */
  const booking = $("#booking");
  if (booking) {
    const from = $("#book-from", booking);
    const to = $("#book-to", booking);
    const result = $("[data-booking-result]", booking);
    const submit = $("button[type=submit]", booking);
    const whatsapp = $("#booking-whatsapp");
    const enquiry = $("#booking-enquiry");
    const villaName = booking.dataset.villaName || "this villa";
    const iso = (date) => date.toISOString().slice(0, 10);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    from.min = iso(today);
    to.min = iso(today);
    from.addEventListener("change", () => {
      if (!from.value) return;
      const date = new Date(from.value);
      date.setDate(date.getDate() + 7);
      to.min = from.value;
      if (!to.value || to.value <= from.value) to.value = iso(date);
      updateContactLinks();
    });
    to.addEventListener("change", updateContactLinks);

    function updateContactLinks() {
      if (!whatsapp) return;
      const dates =
        from.value && to.value
          ? ` from ${new Date(from.value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} to ${new Date(to.value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
          : "";
      const message = `Hello The Ibiza Connection, I would like to enquire about ${villaName}${dates}.`;
      whatsapp.href = `https://wa.me/34697875890?text=${encodeURIComponent(message)}`;
      if (enquiry) {
        const params = new URLSearchParams({ villa: villaName });
        if (from.value) params.set("arrive", from.value);
        if (to.value) params.set("depart", to.value);
        const guests = $("#book-guests")?.value;
        if (guests) params.set("guests", guests);
        enquiry.href = `/contact/?${params.toString()}`;
      }
    }

    booking.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!result) return;
      if (!from.value || !to.value) {
        result.textContent = "Please choose an arrival and departure date.";
        result.className = "booking__result is-visible is-error";
        return;
      }
      if (to.value <= from.value) {
        result.textContent = "The departure date needs to be after the arrival date.";
        result.className = "booking__result is-visible is-error";
        return;
      }
      submit.disabled = true;
      submit.textContent = "Checking…";
      result.textContent = "Checking availability — this can take a few seconds…";
      result.className = "booking__result is-visible";

      try {
        const response = await fetch("/api/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uuid: booking.dataset.villaUuid,
            from: from.value,
            to: to.value,
            guests: Number($("#book-guests", booking)?.value || 0),
          }),
        });
        if (!response.ok) throw new Error("unavailable");
        const data = await response.json();
        if (data.available) {
          if (data.priceOnRequest || !data.price) {
            result.innerHTML = `<strong>Available for your dates.</strong><br>The price for these dates is on request — send us a note and we will quote it, with any extras, by email.`;
            result.className = "booking__result is-visible";
          } else {
            const amount = new Intl.NumberFormat("en-GB", {
              style: "currency",
              currency: data.currency || "EUR",
              maximumFractionDigits: 0,
            }).format(data.price);
            result.innerHTML = `<strong>Available for your dates.</strong><br>${amount} for ${data.nights} nights. We will confirm the details and any extras by email.`;
            result.className = "booking__result is-visible";
          }
        } else {
          result.innerHTML = `<strong>Not available for those exact dates.</strong><br>${data.message || "Send us your dates and we will suggest the closest alternative — often the same house, a day either side."}`;
          result.className = "booking__result is-visible is-error";
        }
      } catch (error) {
        result.innerHTML =
          "<strong>We could not check live availability here.</strong><br>Send us your dates and we will come back with availability and a price — usually the same day.";
        result.className = "booking__result is-visible is-error";
      } finally {
        submit.disabled = false;
        submit.innerHTML = "Check availability";
        updateContactLinks();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Contact form                                                       */
  /* ------------------------------------------------------------------ */
  const form = $("#enquiry-form");
  if (form) {
    const status = $("[data-form-status]", form);
    const showStatus = (message) => {
      if (!status) return;
      status.textContent = message;
      status.classList.add("is-visible");
    };

    const prefill = () => {
      const params = new URLSearchParams(window.location.search);
      const villa = params.get("villa");
      const arrive = params.get("arrive") || params.get("from");
      const depart = params.get("depart") || params.get("to");
      const guests = params.get("guests");
      if (villa) {
        const field = $("#c-villa");
        if (field) field.value = villa;
        const message = $("#c-message");
        if (message && !message.value) message.value = `We would like to enquire about ${villa}.`;
      }
      if (arrive || depart) {
        const field = $("#c-dates");
        if (field) field.value = [arrive, depart].filter(Boolean).join(" → ");
      }
      if (guests) {
        const field = $("#c-guests");
        if (field) field.value = guests;
      }
    };
    prefill();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      let valid = true;
      const mark = (field, ok) => {
        const wrapper = field.closest(".field");
        if (wrapper) wrapper.classList.toggle("field--error", !ok);
        if (!ok) valid = false;
      };
      const name = $("#c-name", form);
      const email = $("#c-email", form);
      const consent = form.querySelector('input[name="consent"]');
      mark(name, name.value.trim().length > 1);
      mark(email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()));
      mark(consent, consent.checked);
      if (!valid) {
        showStatus("Please check the fields marked in red.");
        return;
      }

      const data = new FormData(form);
      const lines = [
        `Name: ${data.get("name") || ""}`,
        `Email: ${data.get("email") || ""}`,
        data.get("phone") ? `Phone: ${data.get("phone")}` : "",
        data.get("dates") ? `Dates: ${data.get("dates")}` : "",
        data.get("guests") ? `Guests: ${data.get("guests")}` : "",
        data.get("villa") ? `Villa: ${data.get("villa")}` : "",
        "",
        String(data.get("message") || ""),
      ].filter(Boolean);
      const subject = `Villa enquiry — ${data.get("name")}${data.get("dates") ? ` · ${data.get("dates")}` : ""}`;
      const mailto = `mailto:${form.dataset.mailto}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
      window.location.href = mailto;
      showStatus(
        "Your email app should open with the enquiry ready to send. If it does not, write to mail@theibizaconnection.net or message us on WhatsApp."
      );
    });

    form.addEventListener("input", (event) => {
      const wrapper = event.target.closest(".field");
      if (wrapper) wrapper.classList.remove("field--error");
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Small niceties                                                     */
  /* ------------------------------------------------------------------ */
  // Keep the footer year current if a static build goes stale.
  const year = new Date().getFullYear();
  $$("[data-year]").forEach((el) => {
    el.textContent = String(year);
  });

  // Set today's date as the minimum for any standalone date inputs.
  const today = new Date().toISOString().slice(0, 10);
  $$('input[type="date"]').forEach((input) => {
    if (!input.min) input.min = today;
  });
})();
