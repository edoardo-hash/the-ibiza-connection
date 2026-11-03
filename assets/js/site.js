/* The Ibiza Connection — site behaviour (no dependencies) */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const body = document.body;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;


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

  /* ------------------------------------------------------------------ */
  /*  Location: Municipality + Area menus (as on the portal)             */
  /*  The Area menu lists the chosen municipality's areas; picking an    */
  /*  area also sets its municipality. Every pair on the page (hero,     */
  /*  filter bar, filter drawer) shows the same choice.                  */
  /* ------------------------------------------------------------------ */
  const muniMenus = $$("[data-muni]");
  const areaMenus = $$("[data-area-menu]");
  const AREA_DISTRICT = {};
  const AREA_OPTIONS = areaMenus[0]
    ? Array.from(areaMenus[0].options).map((o) => {
        if (o.value) AREA_DISTRICT[o.value] = o.dataset.district || "";
        return { value: o.value, label: o.textContent, district: o.dataset.district || "" };
      })
    : [];
  const renderAreaMenu = (menu, district) => {
    menu.innerHTML = "";
    AREA_OPTIONS.filter((o) => !o.value || !district || o.district === district).forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.district) opt.dataset.district = o.district;
      menu.appendChild(opt);
    });
  };
  const setLocation = (district, area) => {
    const d = area ? AREA_DISTRICT[area] || district || "" : district || "";
    const a = area && (!d || AREA_DISTRICT[area] === d) ? area : "";
    muniMenus.forEach((m) => (m.value = d));
    areaMenus.forEach((m) => {
      renderAreaMenu(m, d);
      m.value = a;
    });
    document.dispatchEvent(new CustomEvent("location:change", { detail: { district: d, area: a } }));
  };
  muniMenus.forEach((m) =>
    m.addEventListener("change", () => {
      const area = areaMenus[0]?.value || "";
      setLocation(m.value, AREA_DISTRICT[area] === m.value ? area : "");
    })
  );
  areaMenus.forEach((m) =>
    m.addEventListener("change", () => setLocation(m.value ? AREA_DISTRICT[m.value] : muniMenus[0]?.value || "", m.value))
  );

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
    // Location: ?district=<municipality>&area=<area>. Older links still work:
    // ?where=d:<district> / a:<district>|<area>, ?region=<slug> (old and new slugs), ?bedrooms=<n>.
    const initialLocation = () => {
      let district = params.get("district") || "";
      let area = params.get("area") || "";
      const where = params.get("where") || "";
      if (where.startsWith("d:")) district = where.slice(2);
      if (where.startsWith("a:")) [district, area] = where.slice(2).split("|");
      const RENAMED = { north: "san-juan", west: "san-antonio", "south-west": "san-jose", east: "santa-eulalia", "ibiza-town": "ibiza" };
      const region = RENAMED[params.get("region")] || params.get("region");
      if (!district && region) district = cards.find((c) => c.dataset.region === region)?.dataset.district || "";
      return { district, area };
    };
    const initial = {
      q: params.get("q") || "",
      ...initialLocation(),
      guests: params.get("guests") || "",
      bmin: params.get("bmin") || params.get("bedrooms") || "",
      bmax: params.get("bmax") || "",
      // Budget per week; older ?price=7500-15000 links still work.
      pmin: params.get("pmin") || (params.get("price") || "").split("-")[0] || "",
      pmax: params.get("pmax") || (params.get("price") || "").split("-")[1] || "",
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
    ["guests", "bmin", "bmax", "pmin", "pmax", "sort"].forEach((name) => setControl(name, initial[name]));
    setLocation(initial.district, initial.area);
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
      district: muniMenus[0]?.value || "",
      area: areaMenus[0]?.value || "",
      guests: filterEls.find((el) => el.dataset.filter === "guests")?.value || "",
      bmin: filterEls.find((el) => el.dataset.filter === "bmin")?.value || "",
      bmax: filterEls.find((el) => el.dataset.filter === "bmax")?.value || "",
      pmin: filterEls.find((el) => el.dataset.filter === "pmin")?.value || "",
      pmax: filterEls.find((el) => el.dataset.filter === "pmax")?.value || "",
      sort: filterEls.find((el) => el.dataset.filter === "sort")?.value || "featured",
      features: featureEls.filter((el) => el.checked).map((el) => el.dataset.feature),
      dates: { from: dateFrom?.value || "", to: dateTo?.value || "" },
    });

    // Budget for the whole stay (Edo, 3 Nov 2026; as on the portal): with dates, the price of the stay;
    // before dates are picked, the cheapest week (the card's "from" price). Price on request never matches.
    let availabilityPrice = new Map();
    const stayNights = () => {
      const f = dateFrom?.value;
      const t = dateTo?.value;
      return f && t ? Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86400000) : 0;
    };
    const stayPrice = (card) => availabilityPrice.get(String(card.dataset.uuid || "").toLowerCase()) || 0;
    const budgetPrice = (card) => {
      if (availabilitySet && stayNights()) return stayPrice(card);
      return Number(card.dataset.price) || 0;
    };
    const inBudget = (card, state) => {
      if (!state.pmin && !state.pmax) return true;
      const p = budgetPrice(card);
      if (!p) return false;
      return (!state.pmin || p >= Number(state.pmin)) && (!state.pmax || p <= Number(state.pmax));
    };

    const inLocation = (card, state) =>
      (!state.district || card.dataset.district === state.district) && (!state.area || card.dataset.area === state.area);

    // "Nearby": when a municipality/area search finds NEARBY_TRIGGER villas or fewer, the list is
    // topped up with the closest villas outside it (by approximate GPS) until MIN_RESULTS are shown.
    const NEARBY_TRIGGER = 5;
    const MIN_RESULTS = 8;
    const coords = (card) => [Number(card.dataset.lat), Number(card.dataset.lng)];
    const hasCoords = (card) => coords(card).every((n) => Number.isFinite(n) && n !== 0);
    const km = ([lat1, lng1], [lat2, lng2]) => {
      const r = (x) => (x * Math.PI) / 180;
      const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
      return 12742 * Math.asin(Math.sqrt(h));
    };
    const locationCentre = (state) => {
      const inside = cards.filter((c) => inLocation(c, state) && hasCoords(c));
      if (!inside.length) return null;
      const sum = inside.reduce((acc, c) => [acc[0] + coords(c)[0], acc[1] + coords(c)[1]], [0, 0]);
      return [sum[0] / inside.length, sum[1] / inside.length];
    };
    const locationLabel = (state) => {
      if (state.area) return state.area;
      const opt = muniMenus[0] && Array.from(muniMenus[0].options).find((o) => o.value === state.district);
      return opt ? opt.textContent.replace(/\s*\(\d+\)$/, "") : state.district;
    };
    let nearbyHead = null;

    // "Two villas nearby" (Edo, 3 Nov 2026 — the portal's villa-groups logic, src/lib/villa-groups.ts,
    // with 2 villas and 5 km): when no single villa has the bedrooms asked for, propose pairs of villas
    // within 5 km of each other (EXACT GPS, worked out at build time; only "within X km" reaches the page)
    // that together have the bedrooms (and guests). Same filters except size; a villa big enough on its
    // own is never in a pair. Closest first, then fewest spare bedrooms, then cheapest; each villa in at
    // most 2 pairs; the pair may go up to 20 % over the maximum budget, as on the portal.
    const PAIR_LIMIT = 6;
    const PAIRS_PER_VILLA = 2;
    const OVER_BUDGET_TOLERANCE = 0.2;
    const cardByIdx = new Map(cards.map((c) => [c.dataset.idx, c]));
    const nearOf = (card) =>
      (card.dataset.near || "")
        .split(" ")
        .filter(Boolean)
        .map((x) => {
          const [idx, km] = x.split(":");
          return { card: cardByIdx.get(idx), km: Number(km) };
        })
        .filter((n) => n.card);
    let pairsEl = null;
    const findPairs = (state) => {
      const need = Number(state.bmin);
      const guests = Number(state.guests) || 0;
      if (!need) return { pairs: [], local: true };
      const loose = { ...state, bmin: "", bmax: "", guests: "", pmin: "", pmax: "" };
      const cap = state.pmax ? Number(state.pmax) * (1 + OVER_BUDGET_TOLERANCE) : null;
      const pool = new Set(
        cards.filter((c) => matches(c, loose) && Number(c.dataset.bedrooms) < need && (!cap || (budgetPrice(c) && budgetPrice(c) <= cap)))
      );
      const found = [];
      pool.forEach((a) => {
        nearOf(a).forEach(({ card: b, km }) => {
          if (!pool.has(b) || Number(b.dataset.idx) <= Number(a.dataset.idx)) return;
          const beds = Number(a.dataset.bedrooms) + Number(b.dataset.bedrooms);
          const sleeps = Number(a.dataset.sleeps) + Number(b.dataset.sleeps);
          if (beds < need || (guests && sleeps < guests)) return;
          const pa = budgetPrice(a);
          const pb = budgetPrice(b);
          const total = pa && pb ? pa + pb : null;
          if (cap && (total === null || total > cap)) return;
          found.push({ a, b, km, beds, sleeps, total, spare: beds - need });
        });
      });
      const hasLocation = state.district || state.area;
      let list = found;
      let local = true;
      if (hasLocation) {
        const inside = found.filter((p) => inLocation(p.a, state) || inLocation(p.b, state));
        if (inside.length) list = inside;
        else {
          local = false;
          const centre = locationCentre(state);
          if (centre) {
            const dist = (p) => Math.min(...[p.a, p.b].filter(hasCoords).map((c) => km(centre, coords(c))), Infinity);
            list = [...found].sort((x, y) => dist(x) - dist(y)).slice(0, 40);
          }
        }
      }
      list.sort((x, y) => x.km - y.km || x.spare - y.spare || (x.total ?? Infinity) - (y.total ?? Infinity));
      const used = new Map();
      const out = [];
      for (const p of list) {
        if (out.length >= PAIR_LIMIT) break;
        if ((used.get(p.a) || 0) >= PAIRS_PER_VILLA || (used.get(p.b) || 0) >= PAIRS_PER_VILLA) continue;
        out.push(p);
        used.set(p.a, (used.get(p.a) || 0) + 1);
        used.set(p.b, (used.get(p.b) || 0) + 1);
      }
      return { pairs: out, local };
    };
    const eur = (n) => `€${Math.round(n).toLocaleString("en-GB")}`;
    const pairVillaHtml = (card) => {
      const link = $("a.villa-card__link", card)?.getAttribute("href") || "#";
      const img = $(".villa-card__media img", card);
      const src = img?.currentSrc || img?.getAttribute("src") || "";
      const name = $(".villa-card__name", card)?.textContent || "";
      const dated = availabilitySet && stayNights() && stayPrice(card);
      const price = dated ? `${eur(stayPrice(card))} for your dates` : Number(card.dataset.price) ? `from ${eur(Number(card.dataset.price))} / week` : "Price on request";
      return `<a class="pair__villa" href="${link}">
          <span class="pair__img">${src ? `<img src="${src}" alt="" loading="lazy">` : ""}</span>
          <span class="pair__text"><strong>${name}</strong><span>${card.dataset.area} · ${card.dataset.bedrooms} bedrooms · sleeps ${card.dataset.sleeps}</span><span>${price}</span></span>
        </a>`;
    };
    const renderPairs = (state, result) => {
      if (!result.pairs.length) {
        if (pairsEl) pairsEl.remove();
        return;
      }
      if (!pairsEl) {
        pairsEl = document.createElement("section");
        pairsEl.className = "pairs";
      }
      const dated = availabilitySet && stayNights();
      const where = state.district || state.area ? locationLabel(state) : "";
      const intro = `No single villa${where ? ` in ${where}` : ""} has ${state.bmin}${state.bmax && state.bmax !== state.bmin ? `–${state.bmax}` : "+"} bedrooms${dated ? " free for your dates" : ""}. These pairs of villas, a few minutes apart, have them together${!result.local && where ? ` — the closest pairs to ${where}` : ""}.`;
      const params = new URLSearchParams();
      if (dateFrom?.value) params.set("arrive", dateFrom.value);
      if (dateTo?.value) params.set("depart", dateTo.value);
      if (state.guests) params.set("guests", state.guests);
      pairsEl.innerHTML = `<h3>Two villas together</h3><p class="pairs__intro">${intro}</p>${result.pairs
        .map((p) => {
          const q = new URLSearchParams(params);
          q.set("villa", `${$(".villa-card__name", p.a)?.textContent} + ${$(".villa-card__name", p.b)?.textContent}`);
          const total = p.total === null ? "price on request" : dated ? `${eur(p.total)} for your dates` : `from ${eur(p.total)} / week`;
          return `<div class="pair">
            <div class="pair__villas">${pairVillaHtml(p.a)}<span class="pair__plus" aria-hidden="true">+</span>${pairVillaHtml(p.b)}</div>
            <div class="pair__foot">
              <span><strong>${p.beds} bedrooms</strong> · sleeps ${p.sleeps} · within ${p.km.toLocaleString("en-GB")} km · ${total}</span>
              <a class="link" href="/contact/?${q.toString()}">Ask about these two</a>
            </div>
          </div>`;
        })
        .join("")}`;
      results.insertBefore(pairsEl, results.firstChild);
    };

    const matches = (card, state) => {
      const features = (card.dataset.features || "").split(" ").filter(Boolean);
      if (state.q && !`${card.dataset.name} ${card.dataset.area}`.toLowerCase().includes(state.q)) return false;
      if (state.guests && Number(card.dataset.sleeps) < Number(state.guests)) return false;
      const beds = Number(card.dataset.bedrooms);
      if (state.bmin && beds < Number(state.bmin)) return false;
      if (state.bmax && beds > Number(state.bmax)) return false;
      if (!inBudget(card, state)) return false;
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
      if (state.district) chips.push(makeChip(locationLabel({ district: state.district }), "district"));
      if (state.area) chips.push(makeChip(state.area, "area"));
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
      if (state.pmin || state.pmax) {
        const eur = (n) => `€${Number(n).toLocaleString("en-GB")}`;
        const label = state.pmin && state.pmax ? `${eur(state.pmin)} – ${eur(state.pmax)}` : state.pmin ? `From ${eur(state.pmin)}` : `Up to ${eur(state.pmax)}`;
        const dated = Boolean(availabilitySet && stayNights());
        chips.push(makeChip(`${label} ${dated ? "for the stay" : "(a week, until you pick dates)"}`, "budget"));
      }
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
      if (state.district) params.set("district", state.district);
      if (state.area) params.set("area", state.area);
      if (state.guests) params.set("guests", state.guests);
      if (state.bmin) params.set("bmin", state.bmin);
      if (state.bmax) params.set("bmax", state.bmax);
      if (state.pmin) params.set("pmin", state.pmin);
      if (state.pmax) params.set("pmax", state.pmax);
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

    // Instant date search (Edo, 3 Nov 2026): the owners' calendars (nightly copy, confirmed bookings
    // only) and the nightly rates come in one small file (data-stays on the results grid), loaded the
    // first time dates are picked. A villa is free when no booking overlaps the stay and the stay meets
    // its minimum nights (unless it takes short stays). The stay price is estimated from the nightly
    // rates; the villa page still checks availability and the exact price live with IMpulse.
    let staysData = null;
    const loadStays = async () => {
      if (staysData) return staysData;
      const url = results.dataset.stays;
      if (!url) throw new Error("no stays file");
      const response = await fetch(url);
      if (!response.ok) throw new Error("stays file");
      staysData = await response.json();
      return staysData;
    };
    const dayAfter = (iso) => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    };
    const estimateStay = (rates, from, to, nights) => {
      let total = 0;
      for (let d = from; d < to; d = dayAfter(d)) {
        const covering = rates.filter((r) => r[0] <= d && d <= r[1]);
        if (!covering.length) return 0;
        const fitting = covering.filter((r) => !r[3] || r[3] <= nights);
        const pick = (fitting.length ? fitting : covering).reduce((best, r) => (r[3] > best[3] ? r : best));
        total += pick[2];
      }
      return Math.round(total);
    };
    // Strict changeover day (portal rule, src/lib/rules/availability.ts): the check-in night's period sets
    // the check-in weekday, the last night's period the check-out weekday (else the villa's own rule).
    // Not applied to last-minute stays (≤ 7 days away) or stays of at least twice the period minimum.
    const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
    const periodFor = (rates, day) => rates.find((r) => r[0] <= day && day <= r[1]);
    const strictOk = (villa, from, to, nights) => {
      const lastNight = new Date(Date.parse(`${to}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      const pIn = periodFor(villa.r, from);
      const pOut = periodFor(villa.r, lastNight);
      const dayIn = pIn && pIn[4] !== undefined ? pIn[4] : villa.d ?? -1;
      const dayOut = pOut && pOut[4] !== undefined ? pOut[4] : villa.d ?? -1;
      const today = new Date().toISOString().slice(0, 10);
      const near = (Date.parse(`${from}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000 <= 7;
      const maxMin = Math.max(0, ...villa.r.filter((r) => r[0] <= lastNight && r[1] >= from).map((r) => r[3] || 0));
      if (near || (maxMin > 0 && nights >= 2 * maxMin)) return true;
      return (dayIn < 0 || weekday(from) === dayIn) && (dayOut < 0 || weekday(to) === dayOut);
    };
    const freeFor = (villa, from, to, nights) =>
      villa.b.every(([ci, co]) => !(ci < to && co > from)) &&
      (villa.s || !villa.m || nights >= villa.m) &&
      strictOk(villa, from, to, nights);

    const loadAvailability = async () => {
      const from = dateFrom?.value || "";
      const to = dateTo?.value || "";
      const request = ++availabilityRequest;
      if (!from || !to || to <= from) return loadLiveAvailability();
      try {
        const data = await loadStays();
        if (request !== availabilityRequest) return;
        const nights = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
        const free = new Set();
        const prices = new Map();
        cards.forEach((card) => {
          const villa = data.villas[card.dataset.idx];
          if (!villa || !freeFor(villa, from, to, nights)) return;
          const uuid = String(card.dataset.uuid || "").toLowerCase();
          free.add(uuid);
          const total = estimateStay(villa.r, from, to, nights);
          if (total) prices.set(uuid, total);
        });
        // Results already confirmed live for these dates keep their verdict and price.
        cards.forEach((card) => {
          const r = liveResult.get(liveKey(card));
          const uuid = String(card.dataset.uuid || "").toLowerCase();
          if (r?.state === "no") free.delete(uuid);
          else if (r?.state === "ok" && r.price) prices.set(uuid, r.price);
        });
        availabilitySet = free;
        availabilityPrice = prices;
        liveFromCalendar = true;
        const updated = data.updated ? new Date(data.updated).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
        setNote(
          `Villas free for <strong>${formatRange(from, to)}</strong> (${nights} nights) on the owners' calendars${updated ? ` of ${updated}` : ""}. Each villa shown is then <strong>confirmed live</strong> with our booking system — availability and the exact price for your stay.`
        );
        apply();
      } catch (error) {
        if (request !== availabilityRequest) return;
        loadLiveAvailability();
      }
    };

    // Backup: the live IMpulse check for all villas (slow, ~20 s), used only if the calendar file can't be read.
    const loadLiveAvailability = async () => {
      const from = dateFrom?.value || "";
      const to = dateTo?.value || "";
      const request = availabilityRequest;
      availabilitySet = null;
      liveFromCalendar = false;

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
          availabilityPrice = new Map(data.villas.map((villa) => [String(villa.uuid || "").toLowerCase(), Number(villa.price) || 0]));
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

    // Live confirmation (Edo, 3 Nov 2026: "when running a search, availability and price must be
    // confirmed"): the calendar file only narrows the list; every villa SHOWN for dates is then checked
    // live with IMpulse (the same single-villa quote as the villa page), 4 at a time. A villa IMpulse
    // says is not available drops out; the others show the confirmed price for the stay.
    const LIVE_CONCURRENCY = 6;
    const liveResult = new Map(); // "uuid|from|to" → {state: "pending"|"ok"|"no"|"error", price}
    const liveQueue = [];
    let liveRunning = 0;
    let liveFromCalendar = false; // true when the list came from the calendar file (needs confirming)
    let liveApplyTimer = 0;
    const liveKey = (card) => `${String(card.dataset.uuid || "").toLowerCase()}|${dateFrom?.value || ""}|${dateTo?.value || ""}`;
    const paintLive = (card) => {
      const dated = liveFromCalendar && availabilitySet && stayNights();
      let line = $(".villa-card__live", card);
      const priceEl = $(".villa-card__price", card);
      if (priceEl && !priceEl.dataset.weekly) priceEl.dataset.weekly = priceEl.innerHTML;
      if (!dated) {
        if (line) line.remove();
        if (priceEl && priceEl.dataset.weekly) priceEl.innerHTML = priceEl.dataset.weekly;
        return;
      }
      if (!line) {
        line = document.createElement("p");
        line.className = "villa-card__live";
        priceEl?.before(line);
      }
      const r = liveResult.get(liveKey(card));
      const nights = stayNights();
      const state = r?.state || "pending";
      line.dataset.state = state;
      line.textContent =
        state === "pending"
          ? "Checking availability…"
          : state === "ok"
            ? "Available for your dates"
            : state === "no"
              ? "Not available for these dates"
              : "Availability to be confirmed";
      // The price for the stay replaces the weekly "from" price: confirmed once IMpulse answered,
      // the calendar estimate while checking.
      if (priceEl) {
        const uuid = String(card.dataset.uuid || "").toLowerCase();
        const total = state === "ok" ? r.price : availabilityPrice.get(uuid) || 0;
        priceEl.innerHTML = total
          ? `<strong>${eur(total)}</strong><em>for ${nights} nights</em>`
          : state === "ok"
            ? "<strong>Price on request</strong>"
            : priceEl.dataset.weekly;
      }
    };
    const scheduleApply = () => {
      clearTimeout(liveApplyTimer);
      liveApplyTimer = setTimeout(() => apply(false), 150);
    };
    const runLive = () => {
      while (liveRunning < LIVE_CONCURRENCY && liveQueue.length) {
        const card = liveQueue.shift();
        const key = liveKey(card);
        const [uuid, from, to] = key.split("|");
        liveRunning += 1;
        fetch("/api/availability/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uuid, from, to }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (!d || d.ok === false) throw new Error("live");
            const price = d.priceOnRequest ? 0 : Number(d.price) || 0;
            liveResult.set(key, { state: d.available ? "ok" : "no", price });
            if (key !== liveKey(card)) return; // dates changed meanwhile
            if (!d.available) {
              availabilitySet?.delete(uuid);
              availabilityPrice.delete(uuid);
            } else if (price) availabilityPrice.set(uuid, price);
          })
          .catch(() => {
            // One retry (IMpulse sometimes takes >25 s); then "to be confirmed".
            if (!card.dataset.liveRetried) {
              card.dataset.liveRetried = "1";
              liveResult.set(key, { state: "pending", price: 0 });
              liveQueue.push(card);
            } else liveResult.set(key, { state: "error", price: 0 });
          })
          .finally(() => {
            liveRunning -= 1;
            paintLive(card);
            scheduleApply();
            runLive();
          });
      }
    };
    const confirmShown = (shown) => {
      if (!liveFromCalendar || !availabilitySet || !stayNights()) {
        cards.forEach(paintLive);
        return;
      }
      shown.forEach((card) => {
        const key = liveKey(card);
        if (!liveResult.has(key)) {
          liveResult.set(key, { state: "pending", price: 0 });
          liveQueue.push(card);
        } else if (liveResult.get(key).state === "ok" && liveResult.get(key).price) {
          availabilityPrice.set(key.split("|")[0], liveResult.get(key).price);
        }
        paintLive(card);
      });
      runLive();
    };

    // "Villas available Saturday to Saturday" (Edo, 3 Nov 2026): when the dates aren't Saturday to
    // Saturday and fewer than SATSAT_TRIGGER villas match, offer the villas free for the closest
    // Saturdays (same filters), as small thumbnails, each confirmed live like the main results.
    const SATSAT_TRIGGER = 8;
    const SATSAT_MAX = 8;
    let satEl = null;
    const satLive = new Map(); // "uuid|from|to" → {state, price}
    const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    const closestSaturday = (iso) => {
      const d = weekday(iso); // 0 Sun … 6 Sat
      const back = (d + 1) % 7; // days since the previous Saturday
      return back <= 3 ? addDays(iso, -back) : addDays(iso, 7 - back);
    };
    const satDates = (from, to) => {
      let a = closestSaturday(from);
      const today = new Date().toISOString().slice(0, 10);
      if (a <= today) a = addDays(a, 7);
      let b = closestSaturday(to);
      if (b <= a) b = addDays(a, 7);
      return [a, b];
    };
    const renderSatSat = (state, matched) => {
      const from = dateFrom?.value || "";
      const to = dateTo?.value || "";
      const show = liveFromCalendar && staysData && from && to && matched.length < SATSAT_TRIGGER &&
        !(weekday(from) === 6 && weekday(to) === 6);
      if (!show) {
        if (satEl) satEl.remove();
        return;
      }
      const [a, b] = satDates(from, to);
      const nights = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
      const shownSet = new Set(matched);
      const want = (card) => {
        if (shownSet.has(card)) return false;
        const f = (card.dataset.features || "").split(" ");
        if (state.q && !`${card.dataset.name} ${card.dataset.area}`.toLowerCase().includes(state.q)) return false;
        if (state.guests && Number(card.dataset.sleeps) < Number(state.guests)) return false;
        const beds = Number(card.dataset.bedrooms);
        if (state.bmin && beds < Number(state.bmin)) return false;
        if (state.bmax && beds > Number(state.bmax)) return false;
        if (state.features.some((x) => !f.includes(x))) return false;
        if ((state.district || state.area) && !inLocation(card, state)) return false;
        return true;
      };
      const list = [];
      for (const card of sortCards(cards.filter(want), state.sort)) {
        const villa = staysData.villas[card.dataset.idx];
        if (!villa || !freeFor(villa, a, b, nights)) continue;
        const key = `${String(card.dataset.uuid || "").toLowerCase()}|${a}|${b}`;
        const live = satLive.get(key);
        if (live?.state === "no") continue;
        const price = live?.state === "ok" && live.price ? live.price : estimateStay(villa.r, a, b, nights);
        if ((state.pmin || state.pmax) && (!price || (state.pmin && price < Number(state.pmin)) || (state.pmax && price > Number(state.pmax)))) continue;
        list.push({ card, key, price, live });
        if (list.length >= SATSAT_MAX) break;
      }
      if (!list.length) {
        if (satEl) satEl.remove();
        return;
      }
      if (!satEl) {
        satEl = document.createElement("section");
        satEl.className = "satsat";
      }
      const range = formatRange(a, b);
      const q = new URLSearchParams(window.location.search);
      q.set("arrive", a);
      q.set("depart", b);
      satEl.innerHTML = `<div class="satsat__head"><h3>Villas available Saturday to Saturday</h3>
          <p>Many villas change over on Saturdays. These are free for <strong>${range}</strong> (${nights} nights), the closest Saturdays to your dates.
          <a class="link" href="${window.location.pathname}?${q.toString()}">Search these dates</a></p></div>
        <div class="satsat__grid">${list
          .map(({ card, key, price, live }) => {
            const link = `${$("a.villa-card__link", card)?.getAttribute("href") || "#"}?arrive=${a}&depart=${b}`;
            const img = $(".villa-card__media img", card);
            const src = img?.currentSrc || img?.getAttribute("src") || "";
            const st = live?.state || "pending";
            const status = st === "ok" ? (price ? `${eur(price)} for ${nights} nights` : "Available · price on request") : st === "error" ? "Availability to be confirmed" : "Checking availability…";
            return `<a class="satsat__villa" href="${link}" data-key="${key}">
              <span class="satsat__img">${src ? `<img src="${src}" alt="" loading="lazy">` : ""}</span>
              <span class="satsat__text"><strong>${$(".villa-card__name", card)?.textContent || ""}</strong>
                <span>${card.dataset.area} · ${card.dataset.bedrooms} bedrooms · sleeps ${card.dataset.sleeps}</span>
                <span class="villa-card__live" data-state="${st}">${status}</span></span>
            </a>`;
          })
          .join("")}</div>`;
      (moreWrap || results).after(satEl);
      // Live confirmation for these dates too.
      list.forEach(({ card, key, live }) => {
        if (live) return;
        satLive.set(key, { state: "pending", price: 0 });
        const [uuid] = key.split("|");
        fetch("/api/availability/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uuid, from: a, to: b }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (!d || d.ok === false) throw new Error("live");
            satLive.set(key, { state: d.available ? "ok" : "no", price: d.priceOnRequest ? 0 : Number(d.price) || 0 });
          })
          .catch(() => satLive.set(key, { state: "error", price: 0 }))
          .finally(() => scheduleApply());
      });
    };

    const apply = (resetStep = true) => {
      if (resetStep) visible = step;
      const state = currentState();
      const others = cards.filter((card) => matches(card, state));
      const exact = others.filter((card) => inLocation(card, state));
      let nearby = [];
      const centre = state.district || state.area ? locationCentre(state) : null;
      if (centre && exact.length <= NEARBY_TRIGGER) {
        nearby = others
          .filter((card) => !inLocation(card, state) && hasCoords(card))
          .map((card) => ({ card, d: km(centre, coords(card)) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, Math.max(0, MIN_RESULTS - exact.length));
      }
      const nearbyCards = nearby.map((n) => n.card);
      // No single villa with the bedrooms asked for (in the chosen place, or anywhere nearby) → pairs.
      const pairResult = state.bmin && exact.length === 0 ? findPairs(state) : { pairs: [] };
      const ordered = [...sortCards(exact, state.sort), ...nearbyCards];
      const matched = ordered;
      ordered.forEach((card) => results.appendChild(card));
      cards.forEach((card) => {
        const index = ordered.indexOf(card);
        card.hidden = index === -1 || index >= visible;
        const near = nearby.find((n) => n.card === card);
        card.classList.toggle("is-nearby", Boolean(near));
        let badge = $(".villa-card__nearby", card);
        if (near) {
          if (!badge) {
            badge = document.createElement("span");
            badge.className = "villa-card__nearby";
            $(".villa-card__media", card)?.appendChild(badge);
          }
          badge.textContent = `Nearby · ${card.dataset.area} · ${near.d < 1 ? "<1" : Math.round(near.d)} km`;
        } else if (badge) badge.remove();
      });
      // A full-width note before the first nearby villa.
      if (nearbyCards.length) {
        if (!nearbyHead) {
          nearbyHead = document.createElement("div");
          nearbyHead.className = "results__nearby";
          nearbyHead.setAttribute("role", "note");
        }
        const where = locationLabel(state);
        nearbyHead.innerHTML = exact.length
          ? `Only <strong>${exact.length}</strong> ${exact.length === 1 ? "villa" : "villas"} in ${where} ${exact.length === 1 ? "matches" : "match"} your search — here ${nearbyCards.length === 1 ? "is" : "are"} <strong>${nearbyCards.length}</strong> more close by.`
          : `No villas in ${where} match your search — here are the <strong>${nearbyCards.length}</strong> closest.`;
        results.insertBefore(nearbyHead, nearbyCards[0]);
        nearbyHead.hidden = exact.length >= visible;
      } else if (nearbyHead) nearbyHead.remove();
      if (countEl) countEl.textContent = !matched.length && pairResult.pairs.length ? `${pairResult.pairs.length} pairs of` : String(matched.length);
      if (drawerCount) drawerCount.textContent = String(matched.length);
      renderPairs(state, pairResult);
      if (emptyEl) emptyEl.classList.toggle("is-visible", matched.length === 0 && !pairResult.pairs.length);
      if (moreWrap) moreWrap.hidden = visible >= matched.length;
      if (moreBtn) moreBtn.textContent = `Load more villas (${Math.max(0, matched.length - visible)})`;
      renderChips(state);
      syncUrl(state);
      confirmShown([...ordered.slice(0, visible), ...pairResult.pairs.flatMap((p) => [p.a, p.b])]);
      renderSatSat(state, matched);
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
    document.addEventListener("location:change", () => apply());
    filterEls.forEach((el) =>
      el.addEventListener("change", () => {
        if (el.dataset.filter === "district" || el.dataset.filter === "area") return; // setLocation handles these
        if (el.dataset.filter === "bmin" || el.dataset.filter === "bmax") normaliseBeds();
        if (el.dataset.filter === "pmin" || el.dataset.filter === "pmax") {
          const lo = controlsFor("pmin")[0];
          const hi = controlsFor("pmax")[0];
          [lo, hi].forEach((x) => {
            if (!x) return;
            const n = Math.round(Number(x.value));
            x.value = x.value === "" || !Number.isFinite(n) || n <= 0 ? "" : String(n);
          });
          if (lo?.value && hi?.value && Number(hi.value) < Number(lo.value)) hi.value = lo.value;
        }
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
        } else if (action === "district") {
          setLocation("", "");
          return; // setLocation re-applies
        } else if (action === "area") {
          setLocation(muniMenus[0]?.value || "", "");
          return;
        } else if (action === "budget") {
          setControl("pmin", "");
          setControl("pmax", "");
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
        if (el.dataset.filter !== "district" && el.dataset.filter !== "area") el.value = el.dataset.filter === "sort" ? "featured" : "";
      });
      setLocation("", "");
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
      // Price match (Edo, 3 Nov 2026): ?match=1 opens a ready-worded request.
      if (params.get("match")) {
        const message = $("#c-message");
        if (message && !message.value) {
          message.value = `I found ${villa || "a villa"} for a lower price on another website. Here is the link: \n\nCould you match that price?`;
        }
      }
      const arrive = params.get("arrive") || params.get("from");
      const depart = params.get("depart") || params.get("to");
      const guests = params.get("guests");
      if (villa) {
        const field = $("#c-villa");
        if (field) field.value = villa;
        const message = $("#c-message");
        if (message && !message.value && !params.get("match")) message.value = `We would like to enquire about ${villa}.`;
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
        "Your email app should open with the enquiry ready to send. If it does not, write to info@theibizaconnection.net or message us on WhatsApp."
      );
    });

    form.addEventListener("input", (event) => {
      const wrapper = event.target.closest(".field");
      if (wrapper) wrapper.classList.remove("field--error");
    });
  }


  /* ------------------------------------------------------------------ */
  /*  AI concierge (api/chat). Shown only when the server has a key.     */
  /* ------------------------------------------------------------------ */
  (function concierge() {
    const STORE = "tic-concierge";
    const read = () => {
      try { return JSON.parse(sessionStorage.getItem(STORE) || "[]"); } catch { return []; }
    };
    const save = (list) => {
      try { sessionStorage.setItem(STORE, JSON.stringify(list.slice(-24))); } catch { /* private mode */ }
    };
    const escapeHtml = (t) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    // Light markdown: [text](link) for site paths, wa.me and mailto; **bold**; lists; line breaks.
    const render = (text) =>
      escapeHtml(text)
        .replace(/\[([^\]]+)\]\(((?:\/[^\s)]*)|(?:https:\/\/wa\.me\/[^\s)]*)|(?:mailto:[^\s)]*))\)/g, (_, label, href) =>
          `<a href="${href}"${href.startsWith("/") ? "" : ' target="_blank" rel="noopener"'}>${label}</a>`)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/^\s*[-•]\s+/gm, "• ")
        .replace(/\n/g, "<br>");

    const start = () => {
      const root = document.createElement("div");
      root.className = "concierge";
      root.innerHTML = `
        <button class="concierge__open" type="button" aria-expanded="false" aria-controls="concierge-panel">
          <span class="concierge__dot" aria-hidden="true"></span> Ask our concierge
        </button>
        <section class="concierge__panel" id="concierge-panel" role="dialog" aria-label="Villa concierge" hidden>
          <header class="concierge__head">
            <div><strong>Villa concierge</strong><span>AI assistant · our team confirms every booking</span></div>
            <button class="concierge__close" type="button" aria-label="Close">×</button>
          </header>
          <div class="concierge__log" aria-live="polite"></div>
          <form class="concierge__form">
            <label class="sr-only" for="concierge-input">Your message</label>
            <textarea id="concierge-input" rows="1" maxlength="2000" placeholder="Dates, guests, the kind of villa you like…"></textarea>
            <button type="submit" aria-label="Send">→</button>
          </form>
        </section>`;
      document.body.appendChild(root);
      const open = root.querySelector(".concierge__open");
      const panel = root.querySelector(".concierge__panel");
      const log = root.querySelector(".concierge__log");
      const form = root.querySelector(".concierge__form");
      const input = root.querySelector("textarea");
      let history = read();
      let busy = false;

      const bubble = (role, html) => {
        const el = document.createElement("div");
        el.className = `concierge__msg concierge__msg--${role}`;
        el.innerHTML = html;
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
        return el;
      };
      const paint = () => {
        log.innerHTML = "";
        bubble("assistant", "Hello! I can help you find the right villa in Ibiza. When are you thinking of coming, and how many of you are there?");
        history.forEach((m) => bubble(m.role, m.role === "user" ? escapeHtml(m.content).replace(/\n/g, "<br>") : render(m.content)));
      };
      const toggle = (show) => {
        panel.hidden = !show;
        open.setAttribute("aria-expanded", String(show));
        root.classList.toggle("is-open", show);
        if (show) { paint(); setTimeout(() => input.focus(), 50); }
      };
      open.addEventListener("click", () => toggle(panel.hidden));
      root.querySelector(".concierge__close").addEventListener("click", () => toggle(false));
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) toggle(false); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
      });
      input.addEventListener("input", () => {
        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text || busy) return;
        busy = true;
        input.value = "";
        input.style.height = "auto";
        history.push({ role: "user", content: text });
        save(history);
        bubble("user", escapeHtml(text).replace(/\n/g, "<br>"));
        const wait = bubble("assistant", '<span class="concierge__typing"><i></i><i></i><i></i></span>');
        try {
          const res = await fetch("/api/chat/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: history, page: location.pathname }),
          });
          const data = await res.json().catch(() => ({}));
          const reply = data.reply || data.error || "Sorry, something went wrong. Please message us on WhatsApp.";
          if (data.reply) { history.push({ role: "assistant", content: reply }); save(history); }
          wait.innerHTML = render(reply);
        } catch {
          wait.innerHTML = "Sorry, I couldn't connect. Please message us on WhatsApp.";
        }
        log.scrollTop = log.scrollHeight;
        busy = false;
      });
    };

    fetch("/api/chat/", { method: "GET" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => { if (d.enabled) start(); })
      .catch(() => {});
  })();

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
