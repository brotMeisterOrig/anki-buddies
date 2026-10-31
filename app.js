(() => {
  "use strict";

  const CFG = window.BUDDY_CONFIG || {};
  const PALETTE = ["#6366f1", "#f97316", "#10b981", "#ec4899", "#0ea5e9", "#eab308", "#8b5cf6", "#ef4444"];
  const PERIODS = [
    { id: "today", label: "Today", days: 1, phrase: "today" },
    { id: "week", label: "7 days", days: 7, phrase: "this week" },
    { id: "month", label: "30 days", days: 30, phrase: "this month" },
    { id: "year", label: "Year", days: 365, phrase: "this year" },
    { id: "all", label: "All time", days: null, phrase: "of all time" },
  ];
  const METRICS = [
    { id: "r", label: "Reviews" },
    { id: "t", label: "Minutes" },
    { id: "n", label: "New cards" },
  ];
  const DAY = 864e5;
  const REFRESH_MS = 5 * 60e3;
  const params = new URLSearchParams(location.search);
  const demo = params.has("demo");

  const $ = (s) => document.querySelector(s);
  const state = {
    players: [],
    period: storeGet("period") || "week",
    metric: storeGet("metric") || "r",
    today: null, // set in refresh()
  };
  const charts = {};

  function storeGet(k) { try { return localStorage.getItem("buddies:" + k); } catch { return null; } }
  function storeSet(k, v) { try { localStorage.setItem("buddies:" + k, v); } catch { /* private mode */ } }

  // ---- dates: days are "YYYY-MM-DD" keys, maths done on UTC midnights ----
  const pad = (n) => String(n).padStart(2, "0");
  const parseKey = (k) => new Date(k + "T00:00:00Z");
  const keyOf = (d) => d.toISOString().slice(0, 10);
  const addDays = (k, n) => keyOf(new Date(parseKey(k).getTime() + n * DAY));
  const weekday = (k) => (parseKey(k).getUTCDay() + 6) % 7; // Monday = 0

  function todayKey(rolloverHours) {
    const d = new Date(Date.now() - rolloverHours * 36e5);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function range(end, n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(addDays(end, -i));
    return out;
  }

  function periodKeys(periodId) {
    const p = PERIODS.find((p) => p.id === periodId);
    if (p.days) return range(state.today, p.days);
    const first = state.players.flatMap((pl) => Object.keys(pl.days)).sort()[0] || state.today;
    const n = Math.round((parseKey(state.today) - parseKey(first)) / DAY) + 1;
    return range(state.today, Math.max(n, 1));
  }

  // ---- stats ----
  function sum(pl, keys) {
    const s = { r: 0, t: 0, n: 0, rv: 0, ok: 0 };
    for (const k of keys) {
      const d = pl.days[k];
      if (d) for (const f in s) s[f] += d[f] || 0;
    }
    return s;
  }

  function streaks(pl) {
    const has = (k) => (pl.days[k]?.r || 0) > 0;
    const doneToday = has(state.today);
    let cur = 0;
    let k = doneToday ? state.today : addDays(state.today, -1);
    while (has(k)) { cur++; k = addDays(k, -1); }
    let best = 0, run = 0, prev = null;
    for (const d of Object.keys(pl.days).filter(has).sort()) {
      run = prev && addDays(prev, 1) === d ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    }
    return { cur, best, doneToday };
  }

  // ---- formatting ----
  const fmtNum = (n) => Math.round(n).toLocaleString();
  function fmtTime(sec) {
    const m = Math.round(sec / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return h >= 100 ? `${fmtNum(h)}h` : `${h}h ${pad(m % 60)}m`;
  }
  const fmtPct = (ok, of) => (of ? `${Math.round((100 * ok) / of)}%` : "—");
  function ago(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (!isFinite(s)) return "never";
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---- loading ----
  function detectRepo() {
    if (CFG.repo) return CFG.repo;
    const host = location.hostname;
    if (!host.endsWith(".github.io")) return null;
    const owner = host.split(".")[0];
    const project = location.pathname.split("/").filter(Boolean)[0];
    return `${owner}/${project || host}`;
  }

  async function listPlayerFiles() {
    const repo = detectRepo();
    if (repo) {
      try {
        const r = await fetch(`https://api.github.com/repos/${repo}/contents/data`, { cache: "no-store" });
        if (r.ok) {
          const files = (await r.json()).map((f) => f.name).filter((n) => n.endsWith(".json"));
          if (files.length) return files;
        }
      } catch { /* fall through to the configured list */ }
    }
    return (CFG.players || []).map((p) => `${p}.json`);
  }

  async function loadPlayers() {
    if (demo) return demoPlayers();
    const files = await listPlayerFiles();
    const loaded = await Promise.all(files.map(async (f) => {
      try {
        const r = await fetch(`data/${f}?t=${Date.now()}`, { cache: "no-store" });
        return r.ok ? await r.json() : null;
      } catch { return null; }
    }));
    return loaded.filter((p) => p && p.days);
  }

  function demoPlayers() {
    const make = (name, base, skipRate, seed, peakHour) => {
      let s = seed;
      const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      const days = {};
      for (let i = 0; i < 430; i++) {
        if (i > 0 && rnd() < skipRate) continue;
        const r = Math.round(base * (0.35 + rnd() * 1.3) * (i < 45 ? 1.25 : 1));
        const rv = Math.round(r * 0.72);
        days[addDays(state.today, -i)] = {
          r, t: Math.round(r * (6 + rnd() * 5)), n: Math.round(r * (0.08 + rnd() * 0.08)),
          rv, ok: Math.round(rv * (0.82 + rnd() * 0.1)),
        };
      }
      const hours = Array.from({ length: 24 }, (_, h) => {
        const dist = Math.min(Math.abs(h - peakHour), 24 - Math.abs(h - peakHour));
        return Math.round(1000 * Math.exp(-(dist * dist) / 8) * (0.7 + rnd() * 0.6));
      });
      const total = Math.round(base * 60 + rnd() * 3000);
      return {
        name, days, hours, rollover: 4,
        updated: new Date(Date.now() - rnd() * 4 * 36e5).toISOString(),
        collection: {
          total, new: Math.round(total * 0.3), learning: Math.round(total * 0.04),
          young: Math.round(total * 0.24), mature: Math.round(total * 0.42),
        },
      };
    };
    return [make("Alex", 150, 0.1, 7, 21), make("Sam", 130, 0.16, 4242, 8)];
  }

  // ---- rendering ----
  function renderTabs() {
    const mk = (el, items, current, onPick) => {
      el.innerHTML = items.map((it) =>
        `<button type="button" data-id="${it.id}" aria-pressed="${it.id === current}">${it.label}</button>`).join("");
      el.onclick = (e) => {
        const b = e.target.closest("button");
        if (b) onPick(b.dataset.id);
      };
    };
    mk($("#periods"), PERIODS, state.period, (id) => { state.period = id; storeSet("period", id); render(); });
    mk($("#metrics"), METRICS, state.metric, (id) => { state.metric = id; storeSet("metric", id); render(); });
  }

  function renderCards(keys) {
    const rows = state.players
      .map((pl) => ({ pl, s: sum(pl, keys), st: streaks(pl) }))
      .sort((a, b) => b.s.r - a.s.r || b.s.t - a.s.t);
    const contest = rows.length > 1;
    $("#cards").innerHTML = rows.map(({ pl, s, st }, i) => {
      const lead = contest && i === 0 && s.r > 0 && s.r > rows[1].s.r;
      return `
      <article class="card${lead ? " lead" : ""}" style="--c:${pl.color}">
        <header>
          <span class="avatar">${esc(pl.name.slice(0, 1))}</span>
          <div>
            <h3>${esc(pl.name)}${lead ? " 👑" : ""}</h3>
            <p class="muted">synced ${ago(pl.updated)}</p>
          </div>
          ${contest ? `<span class="rank">#${i + 1}</span>` : ""}
        </header>
        <div class="big"><b>${fmtNum(s.r)}</b><span>reviews</span></div>
        <dl class="stats">
          <div><dt>Time studied</dt><dd>${fmtTime(s.t)}</dd></div>
          <div><dt>New cards</dt><dd>${fmtNum(s.n)}</dd></div>
          <div><dt>Retention</dt><dd>${fmtPct(s.ok, s.rv)}</dd></div>
          <div><dt>Streak</dt><dd>${st.cur ? `🔥 ${st.cur} d` : "0 d"} <span class="muted" style="font-weight:500;font-size:12px">best ${st.best}</span></dd></div>
        </dl>
        ${!st.doneToday ? `<p class="nudge">No reviews today yet${st.cur ? ` — ${st.cur}-day streak at risk` : ""}</p>` : ""}
      </article>`;
    }).join("");
    return rows;
  }

  function renderBanner(rows) {
    const el = $("#banner");
    const phrase = PERIODS.find((p) => p.id === state.period).phrase;
    let html;
    if (rows.length === 1) {
      html = `Just you so far, <b>${esc(rows[0].pl.name)}</b>. Send your mate the setup guide and make it a race.`;
    } else {
      const [a, b] = rows;
      const diff = a.s.r - b.s.r;
      if (a.s.r === 0) html = `Nobody has reviewed anything ${phrase}. Someone has to go first…`;
      else if (diff === 0) html = `Dead heat ${phrase}: <b>${fmtNum(a.s.r)}</b> reviews each.`;
      else {
        const pct = b.s.r ? Math.round((100 * diff) / b.s.r) : null;
        html = `🏆 <b>${esc(a.pl.name)}</b> leads ${phrase} by <b>${fmtNum(diff)}</b> reviews` +
          (pct !== null && pct < 1000 ? ` (+${pct}%)` : "") +
          `. ${esc(b.pl.name)}, about ${fmtTime(diff * (b.s.r ? b.s.t / b.s.r : 8))} of reviewing closes the gap.`;
      }
    }
    el.innerHTML = html;
    el.hidden = false;
  }

  function buckets(keys) {
    const size = keys.length <= 62 ? "day" : keys.length <= 400 ? "week" : "month";
    const groups = new Map();
    for (const k of keys) {
      const g = size === "day" ? k : size === "week" ? addDays(k, -weekday(k)) : k.slice(0, 7);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(k);
    }
    const fmt = (g) => {
      const opts = size === "month" ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" };
      const d = size === "month" ? parseKey(g + "-01") : parseKey(g);
      return d.toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
    };
    return { size, labels: [...groups.keys()].map(fmt), groups: [...groups.values()] };
  }

  function chartTheme() {
    return { text: cssVar("--muted"), grid: cssVar("--border"), surface: cssVar("--surface"), fg: cssVar("--text") };
  }

  function renderTrend(keys) {
    if (!window.Chart) return;
    if (keys.length < 14) keys = range(state.today, 14);
    const { size, labels, groups } = buckets(keys);
    const metric = state.metric;
    const value = (pl, g) => {
      const s = sum(pl, g);
      return metric === "t" ? Math.round(s.t / 60) : s[metric];
    };
    const th = chartTheme();
    const datasets = state.players.map((pl) => ({
      label: pl.name,
      data: groups.map((g) => value(pl, g)),
      borderColor: pl.color,
      backgroundColor: pl.color + "22",
      fill: state.players.length === 1,
      cubicInterpolationMode: "monotone",
      borderWidth: 2.5,
      pointRadius: labels.length > 40 ? 0 : 3,
      pointHoverRadius: 5,
    }));
    const unit = METRICS.find((m) => m.id === metric).label.toLowerCase();
    charts.trend?.destroy();
    charts.trend = new Chart($("#trend"), {
      type: "line",
      data: { labels, datasets },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { ticks: { color: th.text, maxRotation: 0, autoSkipPadding: 16 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: th.text, precision: 0 }, grid: { color: th.grid }, border: { display: false } },
        },
        plugins: {
          legend: { labels: { color: th.fg, usePointStyle: true, boxWidth: 8 } },
          tooltip: {
            callbacks: {
              title: (items) => (size === "week" ? "Week of " : "") + items[0].label,
              label: (c) => ` ${c.dataset.label}: ${fmtNum(c.parsed.y)} ${unit}`,
            },
          },
        },
      },
    });
  }

  function renderHeatmaps() {
    const end = state.today;
    const keys = range(end, 52 * 7 + weekday(end) + 1);
    const vals = state.players.flatMap((pl) => keys.map((k) => pl.days[k]?.r || 0)).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (p) => vals[Math.floor(p * (vals.length - 1))] || 1;
    const th = [q(0.25), q(0.5), q(0.8)];
    const level = (v) => (v <= 0 ? 0 : v <= th[0] ? 1 : v <= th[1] ? 2 : v <= th[2] ? 3 : 4);
    const dateFmt = (k) => parseKey(k).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

    $("#heatmaps").innerHTML = state.players.map((pl) => {
      const active = keys.filter((k) => (pl.days[k]?.r || 0) > 0).length;
      const cells = keys.map((k) => {
        const v = pl.days[k]?.r || 0;
        return `<i class="l${level(v)}${k === end ? " today" : ""}" title="${dateFmt(k)}: ${fmtNum(v)} reviews"></i>`;
      }).join("");
      return `<div class="hm-row" style="--c:${pl.color}">
        <div class="hm-label"><i></i>${esc(pl.name)} <small>${active} of ${keys.length} days active</small></div>
        <div class="hm-scroll"><div class="hm">${cells}</div></div>
      </div>`;
    }).join("");
    document.querySelectorAll(".hm-scroll").forEach((el) => (el.scrollLeft = el.scrollWidth));
  }

  function renderCollections() {
    const segs = [["mature", "Mature"], ["young", "Young"], ["learning", "Learning"], ["new", "Unseen"]];
    $("#collections").innerHTML = state.players.map((pl) => {
      const c = pl.collection || {};
      const total = c.total || segs.reduce((a, [k]) => a + (c[k] || 0), 0);
      const bar = total
        ? segs.map(([k, label]) => c[k] ? `<span class="seg-${k}" style="width:${(100 * c[k]) / total}%" title="${label}: ${fmtNum(c[k])}"></span>` : "").join("")
        : "";
      return `<div class="coll">
        <div class="coll-head">${esc(pl.name)} <span>${fmtNum(total)} cards · ${fmtNum(c.mature || 0)} mature</span></div>
        <div class="bar">${bar}</div>
      </div>`;
    }).join("") +
      `<div class="legend">${segs.map(([k, l]) => `<span class="seg-${k}" style="background:none">${l}</span>`).join("")}</div>`;
  }

  function renderHours() {
    if (!window.Chart) return;
    const th = chartTheme();
    const datasets = state.players.map((pl) => {
      const h = pl.hours || Array(24).fill(0);
      const total = h.reduce((a, b) => a + b, 0) || 1;
      return { label: pl.name, data: h.map((v) => (100 * v) / total), backgroundColor: pl.color, borderRadius: 3 };
    });
    charts.hours?.destroy();
    charts.hours = new Chart($("#hours"), {
      type: "bar",
      data: { labels: Array.from({ length: 24 }, (_, i) => `${pad(i)}h`), datasets },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: th.text, maxRotation: 0, autoSkipPadding: 6 }, grid: { display: false } },
          y: { ticks: { color: th.text, callback: (v) => v + "%" }, grid: { color: th.grid }, border: { display: false } },
        },
        plugins: {
          legend: { labels: { color: th.fg, usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` } },
        },
      },
    });
  }

  function render() {
    renderTabs();
    const has = state.players.length > 0;
    $("#board").hidden = !has;
    $("#empty").hidden = has;
    $("#banner").hidden = !has;
    if (!has) return;
    const keys = periodKeys(state.period);
    renderBanner(renderCards(keys));
    renderTrend(keys);
    renderHeatmaps();
    renderCollections();
    renderHours();
  }

  async function refresh() {
    state.today = todayKey(4);
    const players = await loadPlayers();
    players.sort((a, b) => a.name.localeCompare(b.name));
    players.forEach((pl, i) => (pl.color = PALETTE[i % PALETTE.length]));
    state.players = players;
    state.today = todayKey(players[0]?.rollover ?? 4);
    render();
    $("#foot").innerHTML =
      (demo ? `<span class="demo-pill">DEMO DATA</span> <a href="./">Back to the real board</a> · ` : "") +
      `Updated by the Anki Buddy Board add-on · refreshes every 5 minutes · loaded ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  // Charts read colours from CSS, so redraw when the theme flips.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  refresh();
  if (!demo) setInterval(refresh, REFRESH_MS);
})();
