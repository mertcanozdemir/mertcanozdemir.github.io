// MRI reconstruction results browser.
//
// Renders the generated dataset (assets/json/mri_recon_data.json) two ways, and
// hands a third view, the evidence graph, to recon-graph.js.
// Papers is the default, because that is the unit people look for and because a
// value-per-row list repeats the same baselines hundreds of times — zero-filled
// alone appears once per cell per paper. Results lists every reported value, for
// tracing one model across the literature.
//
// The rule that shapes both: values from different `cell`s are not comparable,
// so nothing here sorts or ranks across cells by PSNR or SSIM. Comparison only
// ever happens inside a cell, where one paper measured those models side by side.

(function () {
  const LIMIT = { papers: 120, results: 200 };

  const root = document.querySelector(".recon");
  if (!root) return;

  const el = {
    scope: root.querySelector("[data-scope]"),
    filters: root.querySelector("[data-filters]"),
    list: root.querySelector("[data-list]"),
    graph: root.querySelector("[data-graph]"),
    controls: root.querySelector("[data-controls]"),
    q: root.querySelector("[data-q]"),
    chips: root.querySelector("[data-chips]"),
    views: root.querySelector("[data-views]"),
    inMain: root.querySelector("[data-inmain]"),
    count: root.querySelector("[data-count]"),
    results: root.querySelector("[data-results]"),
  };
  const extractionEl = document.querySelector("[data-extraction]");

  const VIEWS = ["graph", "papers", "results"];
  const fromHash = location.hash.slice(1);
  // The graph is the default: it is the overview, the lists are for looking
  // things up. #papers and #results open those directly.
  const state = { view: VIEWS.includes(fromHash) ? fromHash : "graph", q: "", anatomy: "", family: "", R: "", inMain: true };
  let dataReady = false;

  // The graph is a separate script with its own data and d3, fetched the
  // first time the view is opened.
  const D3 = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
  const LAZY = {
    graph: { el: el.graph, shown: () => window.reconGraphShown },
  };
  const loading = new Set();
  const loadScript = (src) =>
    new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = fail;
      document.head.appendChild(s);
    });
  let d3Ready = null;
  function showView() {
    const lazy = LAZY[state.view];
    el.filters.hidden = !!lazy || !dataReady;
    el.list.hidden = !!lazy;
    for (const [k, v] of Object.entries(LAZY)) v.el.hidden = k !== state.view;
    if (!lazy) return false;
    const shown = lazy.shown();
    if (shown) shown();
    else if (!loading.has(state.view)) {
      loading.add(state.view);
      d3Ready = d3Ready || (window.d3 ? Promise.resolve() : loadScript(D3));
      d3Ready.then(() => loadScript(lazy.el.dataset.script)).catch((err) => console.error("recon: view failed to load", err));
    }
    return true;
  }

  let rows = [],
    papers = [],
    papersById = new Map(),
    rowsByPaper = new Map(),
    byCell = new Map(),
    meta = null;

  // A table is {columns, values, data}; a cell is an index into values[column]
  // when that column is dictionary-encoded, and a raw value otherwise.
  function decode(t) {
    const dict = t.values || {};
    return t.data.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, c in dict && r[i] !== null ? dict[c][r[i]] : r[i]])));
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const num = (v, d) => (v === null || v === undefined ? "—" : v.toFixed(d));
  const uniq = (a) => [...new Set(a.filter((x) => x !== null && x !== undefined))];

  function paperLink(p) {
    if (!p) return "";
    if (p.doi) return "https://doi.org/" + p.doi;
    if (p.arxiv) return "https://arxiv.org/abs/" + p.arxiv;
    return "";
  }

  // --- filtering ---------------------------------------------------------

  function rowMatches(row) {
    if (state.inMain && !row.in_main) return false;
    if (state.anatomy && row.anatomy !== state.anatomy) return false;
    if (state.family && row.family !== state.family) return false;
    if (state.R && String(row.R_layer) !== state.R) return false;
    if (state.q) {
      const p = papersById.get(row.paper);
      const hay = (row.model + " " + row.dataset + " " + ((p && p.title) || "")).toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    return true;
  }

  // A paper is a hit when any of its rows is; it carries the matching rows with
  // it so the expanded view shows what the filters actually selected.
  function paperHits() {
    const out = [];
    for (const p of papers) {
      const idx = rowsByPaper.get(p.id) || [];
      const matching = idx.filter((i) => rowMatches(rows[i]));
      if (matching.length) out.push({ paper: p, rows: matching });
    }
    return out;
  }

  // --- rendering ---------------------------------------------------------

  function armTable(list, self) {
    const body = list
      .map((m) => {
        const me = m === self ? ' class="is-self"' : "";
        return `<tr${me}><td>${esc(m.model)}</td><td>${esc(m.role)}</td>
          <td class="n">${num(m.psnr, 2)}</td><td class="n">${num(m.ssim, 4)}</td>
          <td class="n">${m.params_M !== null ? num(m.params_M, 1) + "M" : "—"}</td></tr>`;
      })
      .join("");
    return `<table class="recon-cell">
      <thead><tr><th>model</th><th>role</th><th class="n">PSNR</th><th class="n">SSIM</th><th class="n">params</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  const protocolHead = (r) => [r.dataset, r.anatomy, r.contrast, "R=" + r.R, r.mask_class, r.split].filter(Boolean).map(esc).join(" · ");

  // Every cell the paper reports gets its own table. They are never merged:
  // separate cells are separate experiment arms and their numbers do not meet.
  function paperDetail(hit) {
    const cells = new Map();
    for (const i of hit.rows) {
      const c = rows[i].cell;
      if (!cells.has(c)) cells.set(c, []);
      cells.get(c).push(rows[i]);
    }
    const note =
      cells.size > 1
        ? `<p class="recon-warn">${cells.size} experiment arms, measured separately.
           Values compare within a table, never across them.</p>`
        : "";
    const parts = [...cells.values()].map((list) => {
      const lone = list.length === 1 ? `<span class="recon-lone">on its own in this arm — nothing to compare it with</span>` : "";
      return `<div class="recon-arm">
        <p class="recon-cell-head">${protocolHead(list[0])} ${lone}</p>
        ${armTable(list, null)}
      </div>`;
    });
    return note + parts.join("");
  }

  function paperHTML(hit, i) {
    const p = hit.paper;
    const picked = hit.rows.map((x) => rows[x]);
    const href = paperLink(p);
    const anatomies = uniq(picked.map((r) => r.anatomy));
    const families = uniq(picked.map((r) => r.family));
    const Rs = uniq(picked.map((r) => r.R_layer)).sort((a, b) => a - b);
    const quartile = p.quartile && p.quartile !== "unclassified" ? " · " + p.quartile : "";
    const venue = p.venue_type === "preprint" ? p.venue : p.venue + quartile;

    return `<li class="recon-row" data-i="${i}">
      <button type="button" class="recon-paper-main" aria-expanded="false">
        <span class="recon-year">${esc(Math.floor(p.year_v1))}</span>
        <span class="recon-paper-title">${esc(p.title)}</span>
        <span class="recon-paper-meta">${esc(venue)} · ${picked.length} value${picked.length === 1 ? "" : "s"}${
          anatomies.length ? " · " + esc(anatomies.join(", ")) : ""
        }${Rs.length ? " · R=" + esc(Rs.join(", ")) : ""}${families.length ? " · " + esc(families.join(", ")) : ""}</span>
      </button>
      <div class="recon-detail" hidden></div>
      <div class="recon-meta">
        ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">source</a>` : ""}
        ${p.code === "yes" && p.code_url ? `<a href="${esc(p.code_url)}" target="_blank" rel="noopener">code</a>` : ""}
      </div>
    </li>`;
  }

  function resultHTML(row, i) {
    const p = papersById.get(row.paper);
    const href = paperLink(p);
    const prov = [row.source, row.page !== null ? "p. " + row.page : null].filter(Boolean).map(esc).join(", ");
    return `<li class="recon-row" data-i="${i}">
      <button type="button" class="recon-row-main" aria-expanded="false">
        <span class="recon-year">${esc(p ? Math.floor(p.year_v1) : "")}</span>
        <span class="recon-model">${esc(row.model)}</span>
        <span class="recon-tag">${esc(row.family)}</span>
        <span class="recon-where">${esc(row.dataset)} · ${esc(row.anatomy)} · R=${esc(row.R)}</span>
        <span class="recon-vals">${row.psnr !== null ? num(row.psnr, 2) + " dB" : ""} ${row.ssim !== null ? num(row.ssim, 4) : ""}</span>
      </button>
      <div class="recon-detail" hidden></div>
      <div class="recon-meta">
        ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc((p && p.title) || row.paper)}</a>` : esc(row.paper)}
        ${prov ? `<span class="recon-prov">${prov}</span>` : ""}
        ${row.in_main ? "" : `<span class="recon-excluded">excluded: ${esc(row.excluded_at)}</span>`}
      </div>
    </li>`;
  }

  // In the results view a row expands to its own cell — what it was measured
  // alongside.
  function resultDetail(row) {
    const mates = (byCell.get(row.cell) || []).map((i) => rows[i]);
    const lead =
      mates.length > 1
        ? `Measured side by side — ${protocolHead(row)}`
        : `Reported on its own — ${protocolHead(row)}. Nothing was measured alongside it in this arm.`;
    return `<p class="recon-cell-head">${lead}</p>${armTable(mates, row)}`;
  }

  let current = [];

  function render() {
    if (showView() || !dataReady) return;
    const papersMode = state.view === "papers";
    current = papersMode ? paperHits() : rows.map((_, i) => i).filter((i) => rowMatches(rows[i]));

    const cap = LIMIT[state.view];
    const n = current.length;
    const unit = papersMode ? "paper" : "result";
    el.count.textContent = n
      ? `${n.toLocaleString("en")} ${unit}${n === 1 ? "" : "s"}` + (n > cap ? ` — showing the ${cap} most recent` : "")
      : "Nothing matches these filters.";

    el.results.innerHTML = n
      ? `<ol class="recon-list">${current
          .slice(0, cap)
          .map((h, i) => (papersMode ? paperHTML(h, i) : resultHTML(rows[h], i)))
          .join("")}</ol>`
      : "";
  }

  // --- controls ----------------------------------------------------------

  const option = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;

  function buildControls(values) {
    const anatomy = root.querySelector('[data-f="anatomy"]');
    const family = root.querySelector('[data-f="family"]');
    anatomy.innerHTML = option("", "any anatomy") + (values.anatomy || []).map((v) => option(v, v)).join("");
    family.innerHTML = option("", "any family") + (values.family || []).map((v) => option(v, v)).join("");

    el.chips.innerHTML =
      `<button type="button" data-r="" aria-pressed="true">any R</button>` +
      meta.R_layers.map((r) => `<button type="button" data-r="${r}" aria-pressed="false">${r}</button>`).join("");

    anatomy.addEventListener("change", (e) => {
      state.anatomy = e.target.value;
      render();
    });
    family.addEventListener("change", (e) => {
      state.family = e.target.value;
      render();
    });

    function pressGroup(container, attr, key) {
      container.addEventListener("click", (e) => {
        const b = e.target.closest("button[" + attr + "]");
        if (!b) return;
        state[key] = b.getAttribute(attr);
        container.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        render();
      });
    }
    pressGroup(el.chips, "data-r", "R");

    el.inMain.addEventListener("change", (e) => {
      state.inMain = e.target.checked;
      render();
    });

    let t = null;
    el.q.addEventListener("input", (e) => {
      clearTimeout(t);
      const v = e.target.value.trim().toLowerCase();
      t = setTimeout(() => {
        state.q = v;
        render();
      }, 150);
    });
  }

  el.results.addEventListener("click", (e) => {
    const btn = e.target.closest(".recon-paper-main, .recon-row-main");
    if (!btn) return;
    const li = btn.closest(".recon-row");
    const detail = li.querySelector(".recon-detail");
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!open));
    detail.hidden = open;
    if (!open && !detail.dataset.filled) {
      const item = current[+li.dataset.i];
      detail.innerHTML = state.view === "papers" ? paperDetail(item) : resultDetail(rows[item]);
      detail.dataset.filled = "1";
    }
  });

  // --- views -------------------------------------------------------------

  // Built before the dataset arrives, so the graph can open without waiting
  // for it.
  el.views.innerHTML = VIEWS.map((v) => `<button type="button" data-v="${v}" aria-pressed="${v === state.view}">${v}</button>`).join("");
  el.views.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    state.view = b.dataset.v;
    el.views.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    try {
      history.replaceState(null, "", state.view === "graph" ? location.pathname : "#" + state.view);
    } catch (err) {}
    render();
  });
  el.controls.hidden = false;
  showView();

  // --- load --------------------------------------------------------------

  fetch(root.dataset.src)
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((d) => {
      meta = d.meta;
      rows = decode(d.rows);
      papers = decode(d.papers);
      papers.forEach((p) => papersById.set(p.id, p));
      papers.sort((a, b) => b.year_v1 - a.year_v1);

      const yearOf = (r) => {
        const p = papersById.get(r.paper);
        return p ? p.year_v1 : 0;
      };
      rows = rows
        .map((_, i) => i)
        .sort((a, b) => yearOf(rows[b]) - yearOf(rows[a]))
        .map((i) => rows[i]);

      rows.forEach((r, i) => {
        if (!byCell.has(r.cell)) byCell.set(r.cell, []);
        byCell.get(r.cell).push(i);
        if (!rowsByPaper.has(r.paper)) rowsByPaper.set(r.paper, []);
        rowsByPaper.get(r.paper).push(i);
      });

      const c = meta.counts;
      el.scope.textContent =
        `${c.papers.toLocaleString("en")} papers · ` +
        `${c.rows.toLocaleString("en")} reported values · ` +
        `${c.papers_in_main.toLocaleString("en")} papers (${c.rows_in_main.toLocaleString("en")} values) in the main analysis.`;

      if (extractionEl) extractionEl.textContent = meta.extraction;

      buildControls(d.rows.values || {});
      dataReady = true;
      render();
    })
    .catch((err) => {
      el.scope.textContent = "Could not load the dataset.";
      console.error("recon: dataset failed to load", err);
    });
})();
