// MRI reconstruction results browser.
//
// Reads the single generated dataset (assets/json/mri_recon_data.json) and
// renders a filterable view of reported values.
//
// The one rule that shapes this file: values from different `cell`s are not
// comparable, so nothing here ever sorts or ranks across cells by PSNR/SSIM.
// Rows are ordered by publication year. Metric comparison happens only inside
// the cell view, where a single paper measured those models side by side.

(function () {
  const LIMIT = 200; // rows rendered at once; the full match count is shown

  const root = document.querySelector(".recon");
  if (!root) return;

  const el = {
    scope: root.querySelector("[data-scope]"),
    controls: root.querySelector("[data-controls]"),
    q: root.querySelector("[data-q]"),
    chips: root.querySelector("[data-chips]"),
    inMain: root.querySelector("[data-inmain]"),
    count: root.querySelector("[data-count]"),
    results: root.querySelector("[data-results]"),
  };
  const extractionEl = document.querySelector("[data-extraction]");

  const state = { q: "", anatomy: "", family: "", R: "", inMain: true };
  let rows = [],
    papersById = new Map(),
    byCell = new Map(),
    meta = null;

  // A table is {columns, values, data}; a cell is an index into values[column]
  // when that column is dictionary-encoded, and a raw value otherwise.
  function decode(t) {
    const dict = t.values || {};
    return t.data.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, c in dict && r[i] !== null ? dict[c][r[i]] : r[i]])));
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const num = (v, digits) => (v === null || v === undefined ? "—" : v.toFixed(digits));

  function paperLink(p) {
    if (!p) return "";
    if (p.doi) return "https://doi.org/" + p.doi;
    if (p.arxiv) return "https://arxiv.org/abs/" + p.arxiv;
    return "";
  }

  function provenance(row) {
    const bits = [];
    if (row.source) bits.push(esc(row.source));
    if (row.page !== null && row.page !== undefined) bits.push("p. " + esc(row.page));
    return bits.join(", ");
  }

  function option(value, label) {
    return `<option value="${esc(value)}">${esc(label)}</option>`;
  }

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
    el.chips.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-r]");
      if (!b) return;
      state.R = b.dataset.r;
      el.chips.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      render();
    });
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

  function matches(row) {
    if (state.inMain && !row.in_main) return false;
    if (state.anatomy && row.anatomy !== state.anatomy) return false;
    if (state.family && row.family !== state.family) return false;
    if (state.R && String(row.R_layer) !== state.R) return false;
    if (state.q) {
      const p = papersById.get(row.paper);
      const hay = ((row.model || "") + " " + (row.dataset || "") + " " + ((p && p.title) || "")).toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    return true;
  }

  function rowHTML(row, i) {
    const p = papersById.get(row.paper);
    const href = paperLink(p);
    const year = p ? Math.floor(p.year_v1) : "";
    const prov = provenance(row);
    const excluded = row.in_main
      ? ""
      : `<span class="recon-excluded" title="first filter that removed this row">excluded: ${esc(row.excluded_at)}</span>`;
    return `<li class="recon-row" data-i="${i}">
      <button type="button" class="recon-row-main" aria-expanded="false">
        <span class="recon-year">${esc(year)}</span>
        <span class="recon-model">${esc(row.model)}</span>
        <span class="recon-tag">${esc(row.family)}</span>
        <span class="recon-where">${esc(row.dataset)} · ${esc(row.anatomy)} · R=${esc(row.R)}</span>
        <span class="recon-vals">${row.psnr !== null ? num(row.psnr, 2) + " dB" : ""} ${row.ssim !== null ? num(row.ssim, 4) : ""}</span>
      </button>
      <div class="recon-detail" hidden></div>
      <div class="recon-meta">
        ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(p.title || row.paper)}</a>` : esc(row.paper)}
        ${prov ? `<span class="recon-prov">${prov}</span>` : ""}
        ${excluded}
      </div>
    </li>`;
  }

  // The only valid side-by-side comparison: rows one paper ran together.
  function cellHTML(row) {
    const mates = (byCell.get(row.cell) || []).map((i) => rows[i]);
    const head = [row.dataset, row.anatomy, row.contrast, "R=" + row.R, row.mask_class, row.split].filter(Boolean).map(esc).join(" · ");
    const body = mates
      .map((m) => {
        const me = m === row ? ' class="is-self"' : "";
        return `<tr${me}><td>${esc(m.model)}</td><td>${esc(m.role)}</td>
          <td class="n">${num(m.psnr, 2)}</td><td class="n">${num(m.ssim, 4)}</td>
          <td class="n">${m.params_M !== null ? num(m.params_M, 1) + "M" : "—"}</td></tr>`;
      })
      .join("");
    return `<p class="recon-cell-head">Measured side by side in this paper — ${head}</p>
      <table class="recon-cell">
        <thead><tr><th>model</th><th>role</th><th class="n">PSNR</th><th class="n">SSIM</th><th class="n">params</th></tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  function render() {
    const hits = [];
    for (let i = 0; i < rows.length; i++) if (matches(rows[i])) hits.push(i);

    el.count.textContent = hits.length
      ? `${hits.length.toLocaleString("en")} result${hits.length === 1 ? "" : "s"}` +
        (hits.length > LIMIT ? ` — showing the ${LIMIT} most recent` : "")
      : "No results match these filters.";

    const shown = hits.slice(0, LIMIT);
    el.results.innerHTML = shown.length ? `<ol class="recon-list">${shown.map((i) => rowHTML(rows[i], i)).join("")}</ol>` : "";
  }

  el.results.addEventListener("click", (e) => {
    const btn = e.target.closest(".recon-row-main");
    if (!btn) return;
    const li = btn.closest(".recon-row");
    const detail = li.querySelector(".recon-detail");
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!open));
    detail.hidden = open;
    if (!open && !detail.dataset.filled) {
      detail.innerHTML = cellHTML(rows[+li.dataset.i]);
      detail.dataset.filled = "1";
    }
  });

  fetch(root.dataset.src)
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((d) => {
      meta = d.meta;
      rows = decode(d.rows);
      decode(d.papers).forEach((p) => papersById.set(p.id, p));

      // Order by publication year, newest first. Never by metric — see header.
      const yearOf = (r) => {
        const p = papersById.get(r.paper);
        return p ? p.year_v1 : 0;
      };
      const order = rows.map((_, i) => i).sort((a, b) => yearOf(rows[b]) - yearOf(rows[a]));
      rows = order.map((i) => rows[i]);

      rows.forEach((r, i) => {
        if (!byCell.has(r.cell)) byCell.set(r.cell, []);
        byCell.get(r.cell).push(i);
      });

      const c = meta.counts;
      el.scope.textContent =
        `${c.papers.toLocaleString("en")} papers · ` +
        `${c.rows.toLocaleString("en")} reported values · ` +
        `${c.papers_in_main.toLocaleString("en")} papers (${c.rows_in_main.toLocaleString("en")} values) in the main analysis.`;

      if (extractionEl) extractionEl.textContent = meta.extraction;
      buildControls(d.rows.values || {});
      el.controls.hidden = false;
      render();
    })
    .catch((err) => {
      el.scope.textContent = "Could not load the dataset.";
      console.error("recon: dataset failed to load", err);
    });
})();
