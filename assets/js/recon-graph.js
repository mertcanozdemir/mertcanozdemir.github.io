// Evidence graph: reconstruction methods linked by the conditions they were
// measured in side by side, from assets/json/mri_recon_graph.json.
//
// Drawn as a network: methods measured side by side sit close together.
// Each method's relative effectiveness θ comes from a model fitted to
// within-condition differences only (condition effects plus method effects, on
// the largest connected part of the graph), so methods never compared directly
// still land on one scale through the methods they share. The data is
// generated in the umram project; this file only draws it. Used by the home
// page, which loads d3 first.

(function () {
  const root = document.querySelector("[data-graph]");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";

  const FAM = ["CNN", "GAN", "Transformer", "Diffusion", "SSM", "Other"];
  const EDGE_ALPHA = 0.16; // edges' opacity in a full graph; sparser graphs get more
  const UNIT = { psnr: "dB", ssim: "logit" };
  const $ = (s) => root.querySelector(s);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (v, d = 2) => {
    if (v == null || Number.isNaN(v)) return "–";
    const t = Math.abs(v).toFixed(d);
    return (v < 0 && +t !== 0 ? "−" : "") + t;
  };
  const int = (v) => v.toLocaleString("en-US");
  const winLabel = (w) => (w === "all" ? "All years, one graph" : `${w} window · ${Math.max(2018, +w - 1)}–${Math.min(2026, +w + 1)}`);

  // Canvas colours come from CSS custom properties, re-read when the theme flips.
  let T = {};
  function readTokens() {
    const cs = getComputedStyle(root);
    for (const k of ["surface", "grid", "ink", "ink2", "muted", "edge", ...FAM.map((f) => "f-" + f)]) T[k] = cs.getPropertyValue("--rg-" + k).trim();
    T.font = getComputedStyle(document.body).fontFamily;
  }

  let D, MET;
  // How the page opens. "Other" (classical and miscellaneous methods) starts
  // switched off; reset view brings it back with every other family.
  const DEFAULTS = { metric: "psnr", win: "all", minStud: 1, hidden: ["Other"], proposedOnly: false };
  const ex = { ...DEFAULTS, hidden: new Set(DEFAULTS.hidden), sel: null, hover: null };
  const cv = $("canvas"),
    stage = $("[data-stage]"),
    tip = $("[data-tip]");
  let W = 800,
    H = 500,
    dpr = 1,
    G = null,
    zt = d3.zoomIdentity,
    tween = null;
  const simCache = new Map();
  const rad = (n) => 1.8 + 1.5 * Math.sqrt(n.ns);
  const vis = (n) => n === ex.sel || n === G.ref || (!ex.hidden.has(n.m.family) && n.ns >= ex.minStud && (!ex.proposedOnly || n.m.proposed));
  const winKeys = (m) => [
    "all",
    ...Object.keys(D.networks[m])
      .filter((k) => k !== "all")
      .sort(),
  ];

  function buildGraph() {
    const g = D.networks[ex.metric][ex.win];
    const prev = G ? new Map(G.nodes.map((n) => [n.i, [n.wx, n.wy]])) : new Map();
    const nodes = g.nodes.map(([i, th, se, nc, ns, dg, sx, sy]) => ({ i, th, se, nc, ns, dg, sx, sy, m: MET[i] }));
    const byI = new Map(nodes.map((n) => [n.i, n]));
    const edges = g.edges.map(([a, b, c, s]) => ({ a: byI.get(a), b: byI.get(b), c, s }));
    const adj = new Map(nodes.map((n) => [n.i, []]));
    for (const e of edges) {
      adj.get(e.a.i).push([e.b, e]);
      adj.get(e.b.i).push([e.a, e]);
    }
    nodes.forEach((n) => {
      const p = prev.get(n.i);
      if (p) [n.wx, n.wy] = p;
    });
    G = { g, nodes: nodes.sort((a, b) => a.ns - b.ns), byI, edges, adj, ref: byI.get(g.ref), forced: nodes.every((n) => n.sx !== undefined) };
    ex.sel = ex.sel ? byI.get(ex.sel.i) || null : null;
    ex.hover = null;
    $("datalist").innerHTML = [...nodes]
      .sort((a, b) => b.ns - a.ns)
      .map((n) => `<option value="${esc(n.m.name)}">`)
      .join("");
  }

  // Network layout. Positions normally come with the data, laid out ahead of
  // time by bin/graph-layout.js, because the force simulation takes over a
  // second for the full graph. This runs only if they are missing, with the
  // same rule: every method on the circle of radius rk·√SE around U-Net.
  function onCircles(sn) {
    for (const s of sn) {
      if (s.fx !== undefined) continue;
      const d = Math.hypot(s.x, s.y) || 1;
      s.x *= s.r / d;
      s.y *= s.r / d;
      const vr = (s.vx * s.x + s.vy * s.y) / (s.r || 1);
      s.vx -= (vr * s.x) / (s.r || 1);
      s.vy -= (vr * s.y) / (s.r || 1);
    }
  }

  function runForce() {
    G.forced = true;
    if (!G.g.rk) G.g.rk = 300 / Math.sqrt(d3.max(G.nodes, (n) => n.se) || 1);
    const sn = G.nodes.map((n) => {
      const c = simCache.get(n.i);
      return {
        n,
        r: G.g.rk * Math.sqrt(n.se),
        x: c ? c[0] : (Math.random() - 0.5) * 400,
        y: c ? c[1] : (Math.random() - 0.5) * 400,
      };
    });
    const ix = new Map(sn.map((s) => [s.n.i, s]));
    const pin = ix.get(G.ref && G.ref.i);
    if (pin) [pin.x, pin.y, pin.fx, pin.fy] = [0, 0, 0, 0]; // the reference stays in the middle
    const links = G.edges.map((e) => ({ source: ix.get(e.a.i), target: ix.get(e.b.i), c: e.c }));
    const fresh = sn.filter((s) => !simCache.has(s.n.i)).length > sn.length / 2;
    const sim = d3
      .forceSimulation(sn)
      .force(
        "link",
        d3
          .forceLink(links)
          .distance((l) => 10 + 22 / Math.sqrt(l.c))
          .strength((l) => (0.3 * Math.min(1, 0.25 + 0.08 * l.c)) / Math.min(l.source.n.dg, l.target.n.dg))
      )
      .force("charge", d3.forceManyBody().strength(-8).distanceMax(160))
      .force(
        "collide",
        d3.forceCollide((s) => rad(s.n) + 0.5)
      )
      .alpha(fresh ? 1 : 0.45)
      .stop();
    onCircles(sn);
    for (let k = 0; k < (fresh ? 400 : 200); k++) {
      sim.tick();
      onCircles(sn);
    }
    sn.forEach((s) => {
      simCache.set(s.n.i, [s.x, s.y]);
      s.n.sx = s.x;
      s.n.sy = s.y;
    });
  }

  // Fit the graph to the canvas around the reference method, which sits in the
  // middle of the view.
  function targets() {
    if (!G.forced) runForce();
    const c = G.ref || { sx: 0, sy: 0 };
    const rx = d3.max(G.nodes, (n) => Math.abs(n.sx - c.sx)) || 1,
      ry = d3.max(G.nodes, (n) => Math.abs(n.sy - c.sy)) || 1;
    const pad = 26,
      k = Math.min((W / 2 - pad) / rx, (H / 2 - pad) / ry);
    G.k = k;
    G.nodes.forEach((n) => {
      n.gx = W / 2 + (n.sx - c.sx) * k;
      n.gy = H / 2 + (n.sy - c.sy) * k;
    });
  }

  function settle(animate) {
    targets();
    if (tween) tween.stop();
    const start = G.nodes.map((n) => [n.wx ?? n.gx, n.wy ?? n.gy]);
    if (!animate || reduceMotion) {
      G.nodes.forEach((n) => {
        n.wx = n.gx;
        n.wy = n.gy;
      });
      draw();
      return;
    }
    tween = d3.timer((el) => {
      const u = d3.easeCubicInOut(Math.min(1, el / 700));
      G.nodes.forEach((n, k) => {
        n.wx = start[k][0] + (n.gx - start[k][0]) * u;
        n.wy = start[k][1] + (n.gy - start[k][1]) * u;
      });
      draw();
      if (u >= 1) tween.stop();
    });
  }

  function resize() {
    if (root.hidden) return;
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    dpr = window.devicePixelRatio || 1;
    W = r.width;
    H = r.height;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    if (G) {
      targets();
      G.nodes.forEach((n) => {
        n.wx = n.gx;
        n.wy = n.gy;
      });
      draw();
    }
  }

  const SX = (n) => zt.applyX(n.wx),
    SY = (n) => zt.applyY(n.wy);

  function draw() {
    if (!G || root.hidden) return;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = T.surface;
    ctx.fillRect(0, 0, W, H);
    const focus = ex.sel || ex.hover;
    const nb = focus ? new Set(G.adj.get(focus.i).map(([m]) => m.i)) : null;

    // Circles of equal standard error around the reference. Every method sits
    // at rk·√SE from it, so the circles read as how firmly the evidence ties a
    // method to U-Net (bin/graph-layout.js).
    if (G.ref && G.g.rk && G.k) {
      const top = d3.max(G.nodes, (n) => n.se) || 0;
      const e10 = 10 ** Math.floor(Math.log10(top / 4)),
        f = top / 4 / e10;
      const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e10;
      const unit = ex.metric === "psnr" ? "dB" : "logit";
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = T.grid;
      ctx.font = "11px " + T.font;
      ctx.textBaseline = "bottom";
      ctx.lineJoin = "round";
      for (let v = step; v <= top + 1e-9; v += step) {
        const r = zt.k * G.k * G.g.rk * Math.sqrt(v);
        ctx.beginPath();
        ctx.arc(SX(G.ref), SY(G.ref), r, 0, 2 * Math.PI);
        ctx.stroke();
        const t = `±${+v.toFixed(3)} ${unit}`,
          x = SX(G.ref) + r * Math.SQRT1_2 + 3,
          y = SY(G.ref) - r * Math.SQRT1_2 - 2;
        ctx.lineWidth = 3;
        ctx.strokeStyle = T.surface;
        ctx.strokeText(t, x, y);
        ctx.fillStyle = T.muted;
        ctx.fillText(t, x, y);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = T.grid;
      }
    }

    // Edges in their own colour and strong enough to read against the canvas,
    // fading back when a method is in focus.
    ctx.strokeStyle = T.edge;
    ctx.lineWidth = 0.7;
    ctx.globalAlpha = focus ? 0.05 : G.edges.length > 2500 ? EDGE_ALPHA : EDGE_ALPHA * 1.5;
    ctx.beginPath();
    for (const e of G.edges) {
      if (!vis(e.a) || !vis(e.b)) continue;
      ctx.moveTo(SX(e.a), SY(e.a));
      ctx.lineTo(SX(e.b), SY(e.b));
    }
    ctx.stroke();
    if (focus) {
      ctx.strokeStyle = T.ink;
      ctx.globalAlpha = 0.6;
      for (const [m, e] of G.adj.get(focus.i)) {
        if (!vis(m)) continue;
        ctx.lineWidth = 0.7 + 0.5 * Math.sqrt(e.c);
        ctx.beginPath();
        ctx.moveTo(SX(focus), SY(focus));
        ctx.lineTo(SX(m), SY(m));
        ctx.stroke();
      }
    }
    for (const n of G.nodes) {
      if (!vis(n)) continue;
      const dim = focus && n !== focus && !nb.has(n.i);
      ctx.globalAlpha = dim ? 0.16 : 0.95;
      ctx.beginPath();
      ctx.arc(SX(n), SY(n), rad(n), 0, 2 * Math.PI);
      ctx.fillStyle = T["f-" + n.m.family];
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = T.surface;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const ring = (n, w) => {
      ctx.beginPath();
      ctx.arc(SX(n), SY(n), rad(n) + 2.5, 0, 2 * Math.PI);
      ctx.lineWidth = w;
      ctx.strokeStyle = T.ink;
      ctx.stroke();
    };
    if (G.ref) ring(G.ref, 1.4);
    if (focus) ring(focus, 2);

    // Labels: the reference, the most studied methods, or the focus and its
    // strongest links.
    const lab = new Set([G.ref]);
    const ranked = G.nodes.filter(vis).sort((a, b) => b.ns - a.ns);
    if (!focus) ranked.slice(0, 9).forEach((n) => lab.add(n));
    else {
      lab.add(focus);
      G.adj
        .get(focus.i)
        .filter(([m]) => vis(m))
        .sort((a, b) => b[1].c - a[1].c)
        .slice(0, 8)
        .forEach(([m]) => lab.add(m));
    }
    ctx.font = "500 11.5px " + T.font;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const n of lab) {
      if (!n) continue;
      const x = SX(n) + rad(n) + 5,
        y = SY(n);
      const t = n === G.ref ? n.m.name + " · reference" : n.m.name;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = T.surface;
      ctx.strokeText(t, x, y);
      ctx.fillStyle = T.ink;
      ctx.fillText(t, x, y);
    }
  }

  // --- interaction ---------------------------------------------------------

  function pick(mx, my) {
    let best = null,
      bd = Infinity;
    for (const n of G.nodes) {
      if (!vis(n)) continue;
      const dx = SX(n) - mx,
        dy = SY(n) - my,
        d = dx * dx + dy * dy,
        r = rad(n) + 4;
      if (d < r * r && d <= bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  const zoom = d3
    .zoom()
    .scaleExtent([0.5, 14])
    .on("zoom", (e) => {
      zt = e.transform;
      draw();
    });

  function bfs(src, dst) {
    const prev = new Map([[src.i, null]]),
      q = [src];
    while (q.length) {
      const u = q.shift();
      if (u === dst) break;
      for (const [v] of G.adj.get(u.i))
        if (!prev.has(v.i)) {
          prev.set(v.i, u);
          q.push(v);
        }
    }
    if (!prev.has(dst.i)) return null;
    const path = [];
    for (let u = dst; u; u = prev.get(u.i)) path.unshift(u);
    return path;
  }

  function select(n) {
    ex.sel = n || null;
    renderPanel();
    draw();
  }

  const dot = (f) => `<span class="rg-dot" style="background:var(--rg-f-${f})"></span>`;

  function renderPanel() {
    const p = $("[data-panel]"),
      g = G.g,
      dg = g.diag,
      u = UNIT[ex.metric],
      d = ex.metric === "psnr" ? 2 : 3;
    const n = ex.sel;
    if (n) {
      const nbs = G.adj
        .get(n.i)
        .slice()
        .sort((a, b) => b[1].c - a[1].c)
        .slice(0, 10);
      const path = n === G.ref ? null : bfs(n, G.ref);
      p.innerHTML = `
        <button type="button" class="rg-close" data-close>Back to graph</button>
        <h3>${esc(n.m.name)}</h3>
        <p class="rg-sub">${dot(n.m.family)}${n.m.family} · ${n.m.proposed ? "proposed in a study of Fig. 2" : "comparator only"} · since ${Math.floor(n.m.year)}</p>
        <div class="rg-big"><strong>${fmt(n.th, d)}</strong><span>${u} vs ${esc(MET[g.ref].name)}<br>95% ± ${fmt(1.96 * n.se, d)}</span></div>
        <dl class="rg-kv"><dt>Studies in this graph</dt><dd>${n.ns}</dd><dt>Conditions</dt><dd>${n.nc}</dd><dt>Directly compared methods</dt><dd>${n.dg}</dd></dl>
        ${
          path
            ? `<h4>Shortest link to the reference</h4><div class="rg-path">${path
                .map((m, k) => `${k ? "→" : ""}<button type="button" data-i="${m.i}">${esc(m.m.name)}</button>`)
                .join(" ")}</div>`
            : ""
        }
        <h4>Most often compared with</h4>
        <ul class="rg-links">${nbs
          .map(
            ([m, e]) =>
              `<li><button type="button" data-i="${m.i}"><span>${dot(m.m.family)}${esc(m.m.name)}</span><span class="rg-num">${e.c} cond.</span></button></li>`
          )
          .join("")}</ul>`;
      p.querySelector("[data-close]").onclick = () => select(null);
      p.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => select(G.byI.get(+b.dataset.i))));
      return;
    }
    p.innerHTML = `
      <h3>${winLabel(ex.win)}</h3>
      <p class="rg-sub">${ex.metric.toUpperCase()} · reference ${esc(MET[g.ref].name)}${
        ex.win === "all" ? "<br>Shown for orientation; each three-year window is fitted on its own." : ""
      }</p>
      <h4>Graph</h4>
      <dl class="rg-kv">
        <dt>Studies</dt><dd>${int(dg.n_stud)} / ${int(dg.n_stud_all)}</dd>
        <dt>Methods</dt><dd>${int(dg.n_meth)} / ${int(dg.n_meth_all)}</dd>
        <dt>Compared pairs</dt><dd>${int(dg.n_pairs)}</dd>
        <dt>Matched conditions</dt><dd>${int(dg.n_cond)}</dd>
        <dt>Measurements</dt><dd>${int(dg.n_obs)}</dd>
      </dl>
      <h4>Connectedness</h4>
      <dl class="rg-kv">
        <dt>Methods in largest component</dt><dd>${Math.round((100 * dg.n_meth) / dg.n_meth_all)}%</dd>
        <dt>Components</dt><dd>${dg.n_comp}</dd>
        <dt>Independent loops</dt><dd>${int(dg.loops)}</dd>
        <dt>Mean degree</dt><dd>${dg.mean_deg.toFixed(1)}</dd>
      </dl>
      <p class="rg-note">Counts before the slash are in the largest connected component, where the model is fitted; after it, all methods that share at least one condition.</p>`;
  }

  function refresh(animate = true) {
    buildGraph();
    renderPanel();
    settle(animate);
  }

  function fillWin() {
    const s = $("[data-win]");
    const keys = winKeys(ex.metric);
    if (!keys.includes(ex.win)) ex.win = "all";
    s.innerHTML = keys.map((k) => `<option value="${k}" ${k === ex.win ? "selected" : ""}>${winLabel(k)}</option>`).join("");
  }

  function paintLegend() {
    $("[data-legend]")
      .querySelectorAll("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(!ex.hidden.has(b.dataset.f))));
  }

  function segWire(sel, key, after) {
    const el = $(sel);
    el.querySelectorAll("button").forEach(
      (b) =>
        (b.onclick = () => {
          el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          ex[key] = b.dataset.v;
          after();
        })
    );
  }

  function wire() {
    d3.select(cv).call(zoom).on("dblclick.zoom", null);
    // Reset undoes everything: selection, search and zoom cleared, every family
    // shown (Other included), and the other controls back to how the page opens.
    $("[data-reset]").onclick = () => {
      const rebuild = ex.metric !== DEFAULTS.metric || ex.win !== DEFAULTS.win;
      ex.metric = DEFAULTS.metric;
      ex.win = DEFAULTS.win;
      ex.minStud = DEFAULTS.minStud;
      ex.hidden = new Set();
      ex.proposedOnly = DEFAULTS.proposedOnly;
      $("[data-proposed]").setAttribute("aria-pressed", String(ex.proposedOnly));
      $("[data-metric]")
        .querySelectorAll("button")
        .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === ex.metric)));
      $("[data-min]").value = String(ex.minStud);
      fillWin();
      paintLegend();
      $("[data-find]").value = "";
      ex.sel = null;
      if (rebuild) refresh(false);
      else select(null);
      d3.select(cv)
        .transition()
        .duration(reduceMotion ? 0 : 400)
        .call(zoom.transform, d3.zoomIdentity);
    };
    cv.addEventListener("pointermove", (e) => {
      const r = cv.getBoundingClientRect(),
        mx = e.clientX - r.left,
        my = e.clientY - r.top;
      const n = pick(mx, my);
      if (n !== ex.hover) {
        ex.hover = n;
        draw();
      }
      cv.style.cursor = n ? "pointer" : "grab";
      if (!n) {
        tip.hidden = true;
        return;
      }
      const u = UNIT[ex.metric],
        d = ex.metric === "psnr" ? 2 : 3;
      tip.innerHTML = `<b>${esc(n.m.name)}</b><br>${dot(n.m.family)}${n.m.family} · ${n.m.proposed ? "proposed" : "comparator"} · since ${Math.floor(n.m.year)}<br>θ <span class="rg-num">${fmt(n.th, d)} ± ${fmt(1.96 * n.se, d)}</span> ${u}<br><span class="rg-num">${n.ns}</span> studies · <span class="rg-num">${n.nc}</span> conditions · <span class="rg-num">${n.dg}</span> neighbours`;
      tip.hidden = false;
      const tw = tip.offsetWidth,
        th = tip.offsetHeight;
      tip.style.left = Math.min(mx + 14, W - tw - 6) + "px";
      tip.style.top = (my + 14 + th > H ? my - th - 10 : my + 14) + "px";
    });
    cv.addEventListener("pointerleave", () => {
      ex.hover = null;
      tip.hidden = true;
      draw();
    });
    cv.addEventListener("click", (e) => {
      const r = cv.getBoundingClientRect();
      select(pick(e.clientX - r.left, e.clientY - r.top));
    });

    segWire("[data-metric]", "metric", () => {
      fillWin();
      refresh();
    });
    $("[data-win]").onchange = (e) => {
      ex.win = e.target.value;
      refresh();
    };
    $("[data-min]").onchange = (e) => {
      ex.minStud = +e.target.value;
      draw();
    };
    $("[data-proposed]").onclick = (e) => {
      ex.proposedOnly = !ex.proposedOnly;
      e.currentTarget.setAttribute("aria-pressed", String(ex.proposedOnly));
      draw();
    };
    $("[data-find]").addEventListener("change", (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) return;
      // Several papers have their own "U-Net": among equal names, the reference
      // first, then the most studied.
      const rank = (a, b) => (b === G.ref) - (a === G.ref) || b.ns - a.ns;
      const exact = G.nodes.filter((n) => n.m.name.toLowerCase() === q).sort(rank);
      const n = exact[0] || G.nodes.filter((n) => n.m.name.toLowerCase().includes(q)).sort(rank)[0];
      if (n) select(n);
    });
    const legend = $("[data-legend]");
    legend.innerHTML = FAM.map(
      (f) =>
        `<button type="button" class="rg-chip" aria-pressed="${!ex.hidden.has(f)}" data-f="${f}"><i style="background:var(--rg-f-${f})"></i>${f}</button>`
    ).join("");
    legend.querySelectorAll("button").forEach(
      (b) =>
        (b.onclick = () => {
          const f = b.dataset.f,
            on = ex.hidden.has(f);
          on ? ex.hidden.delete(f) : ex.hidden.add(f);
          b.setAttribute("aria-pressed", String(on));
          draw();
        })
    );
    new ResizeObserver(resize).observe(stage);
    new MutationObserver(() => {
      readTokens();
      draw();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  readTokens();
  $("[data-panel]").innerHTML = '<p class="rg-note">Loading the graph…</p>';
  fetch(root.dataset.src)
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((d) => {
      D = d;
      // The reference is shown as plain "U-Net"; the data calls it "U-Net (fastMRI)".
      MET = d.methods.map((m) => (m.name === "U-Net (fastMRI)" ? { ...m, name: "U-Net" } : m));
      wire();
      fillWin();
      resize();
      refresh(false);
      select(G.ref); // open with the reference method, U-Net, selected
    })
    .catch((err) => {
      $("[data-panel]").innerHTML = '<p class="rg-note">Could not load the graph.</p>';
      console.error("recon-graph: data failed to load", err);
    });
})();
