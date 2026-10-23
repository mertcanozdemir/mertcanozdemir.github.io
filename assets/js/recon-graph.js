// Comparison graph: reconstruction methods linked by the conditions they were
// measured in side by side, from assets/json/mri_recon_graph.json.
//
// Drawn as a network: methods measured side by side sit close together.
// Each method's relative effectiveness θ comes from a model fitted to
// within-condition differences only (condition effects plus method effects, on
// the largest connected part of the graph), so methods never compared directly
// still land on one scale through the methods they share. The data is
// generated in the umram project; this file only draws it. Used by the home
// page, which loads d3 first.
//
// The 3D view tilts the same layout and lifts each method to its θ, so height
// reads as the difference from U-Net while the distance from U-Net's axis
// still reads as the standard error. The years view is the paper's Fig. 2
// itself, one point per study and the mean trend with its 95% band, read from
// assets/json/mri_recon_fig2.json (bin/fig2-data.js), with the network fading
// out behind it. All are drawn on the same 2D canvas through a small
// projection, so every interaction works the same in each view.

(function () {
  const root = document.querySelector("[data-graph]");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";

  const FAM = ["CNN", "GAN", "Transformer", "Diffusion", "SSM", "Other"];
  const EDGE_ALPHA = 0.16; // edges' opacity in a full graph; sparser graphs get more
  const UNIT = { psnr: "dB", ssim: "logit" };
  const unit = () => UNIT[ex.metric];
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

  let D, MET, F; // F: Fig. 2, by metric
  // How the page opens. "Other" (classical and miscellaneous methods) starts
  // switched off; reset view brings it back with every other family.
  const DEFAULTS = { metric: "psnr", win: "all", minStud: 1, hidden: ["Other"], proposedOnly: false, view: "2d" };
  const ex = { ...DEFAULTS, hidden: new Set(DEFAULTS.hidden), sel: null, hover: null };
  const cv = $("canvas"),
    stage = $("[data-stage]"),
    tip = $("[data-tip]"),
    straightBtn = $("[data-straighten]");
  let W = 800,
    H = 500,
    dpr = 1,
    G = null,
    zt = d3.zoomIdentity,
    tween = null;
  const simCache = new Map();
  // The camera. 2D is the network seen from straight above with every method
  // on the ground. Tilting it away is 3D: the view turns by yaw, leans back,
  // and the methods rise to their θ, fully once the tilt reaches LIFT. A drag
  // carries the view from one to the other.
  // g fades the network out and Fig. 2 in, for the years view.
  const FLAT = { yaw: 0, tilt: 0, g: 0 },
    TILTED = { yaw: 0, tilt: 1.15, g: 0 },
    YEARS = { yaw: 0, tilt: Math.PI / 2, g: 1 }, // square from the side, as Fig. 2
    LIFT = 0.4,
    SNAP = 0.25; // let go below this tilt (about 14°) and the view settles
  const cam = { ...FLAT };
  let PJ = null,
    camTween = null,
    marks = []; // the years view's hollow marks as last drawn: [x, y, method]
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
    // In 3D the 98th percentile of |θ| rises to half the graph's radius, so a
    // few extreme methods do not flatten the rest.
    G.R = d3.max(G.nodes, (n) => Math.hypot(n.gx - W / 2, n.gy - H / 2)) || 1;
    G.q = d3.quantile(G.nodes, 0.98, (n) => Math.abs(n.th)) || 1;
    G.zs = (0.5 * G.R) / G.q;
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
    // A phone has no years view (its button is hidden there), so a window
    // narrowed to one falls back to 3D.
    if (ex.view === "years" && !$('[data-v="years"]').offsetParent) {
      setView("3d");
      turnTo(TILTED);
    }
    if (G) {
      targets();
      G.nodes.forEach((n) => {
        n.wx = n.gx;
        n.wy = n.gy;
      });
      draw();
    }
  }

  // A point on the canvas before zoom: X, Y on the ground in pixels from the
  // reference, th its height in units of θ; w is its depth towards the viewer.
  // The projection is parallel, so upright lines stay upright.
  function P(X, Y, th) {
    const Z = th * PJ.zs,
      x = X * PJ.cy - Y * PJ.sy,
      y = X * PJ.sy + Y * PJ.cy;
    return { x: W / 2 + x, y: H / 2 + PJ.oy + y * PJ.ct - Z * PJ.st, w: y * PJ.st + Z * PJ.ct };
  }
  const S = (p) => [zt.applyX(p.x), zt.applyY(p.y)];

  // Each frame: the projection, the θ range the axis spans (the methods
  // shown, or Fig. 2's in the years view, which as a chart is centred on the
  // canvas rather than on U-Net's level), and where every method lands.
  function project() {
    const t = Math.min(1, cam.tilt / LIFT),
      h = t * t * (3 - 2 * t),
      g = F ? cam.g * h : 0;
    PJ = { cy: Math.cos(cam.yaw), sy: Math.sin(cam.yaw), ct: Math.cos(cam.tilt), st: Math.sin(cam.tilt), h, g, zs: h * G.zs, oy: 0 };
    const [a, b] = d3.extent(G.nodes.filter(vis), (n) => n.th),
      [fa, fb] = g ? F[ex.metric].range : [a, b];
    PJ.lo = a + g * (fa - a);
    PJ.hi = b + g * (fb - b);
    PJ.oy = (g * (PJ.lo + PJ.hi) * PJ.zs * PJ.st) / 2;
    for (const n of G.nodes) {
      n.X = n.wx - W / 2;
      n.Y = n.wy - H / 2;
      const p = P(n.X, n.Y, n.th);
      n.px = p.x;
      n.py = p.y;
      n.pw = p.w;
    }
  }

  // Fig. 2's year axis across the years view: its first to its last year.
  const yearX = (y) => {
    const [y0, y1] = F[ex.metric].years;
    return 0.95 * G.R * ((2 * (y - y0)) / (y1 - y0) - 1);
  };

  const SX = (n) => zt.applyX(n.px),
    SY = (n) => zt.applyY(n.py);

  function setView(v) {
    if (v === ex.view) return;
    const was = ex.view;
    ex.view = v;
    $("[data-view]")
      .querySelectorAll("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
    // Years is Fig. 2 as the paper draws it: the controls show its setting
    // (proposed methods of every family, in any number of studies, all years)
    // and are locked while it is open, then put back as they were. The
    // network steps aside; a selected method stays selected.
    const win = ex.win;
    if (v === "years") {
      ex.keep = { proposedOnly: ex.proposedOnly, minStud: ex.minStud, win: ex.win, hidden: ex.hidden };
      Object.assign(ex, { proposedOnly: true, minStud: 1, win: "all", hidden: new Set(), hover: null });
      if (ex.sel === G.ref) ex.sel = null; // U-Net's level is the dashed line, and its fan would cover the figure
    } else if (was === "years") Object.assign(ex, ex.keep);
    syncControls();
    if (ex.win !== win) refresh();
    const hint = $("[data-hint]");
    hint.hidden = v === "2d";
    hint.textContent =
      v === "years"
        ? "One point per study: its proposed method against U-Net. Hover or click one to see what it was compared with."
        : "Height: difference from U-Net. Drag to turn.";
    renderPanel();
  }

  // Puts the controls in step with ex, locking those the years view holds.
  function syncControls() {
    const lock = ex.view === "years";
    $("[data-proposed]").setAttribute("aria-pressed", String(ex.proposedOnly));
    $("[data-min]").value = String(ex.minStud);
    $("[data-win]").value = ex.win;
    paintLegend();
    root.querySelectorAll("[data-proposed], [data-min], [data-win], [data-legend] button").forEach((el) => (el.disabled = lock));
  }

  function stopCam() {
    if (camTween) camTween.stop();
    camTween = null;
  }

  function turnTo(c) {
    stopCam();
    const a = { ...cam, yaw: Math.atan2(Math.sin(cam.yaw), Math.cos(cam.yaw)) }; // back the short way round
    if (reduceMotion) {
      Object.assign(cam, c);
      draw();
      return;
    }
    camTween = d3.timer((el) => {
      const u = d3.easeCubicInOut(Math.min(1, el / 900));
      for (const k in c) cam[k] = a[k] + (c[k] - a[k]) * u;
      if (u >= 1) stopCam();
      draw();
    });
  }

  function draw() {
    if (!G || root.hidden) return;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = T.surface;
    ctx.fillRect(0, 0, W, H);
    project();
    // "straighten axes" is offered while the 3D view is turned off them.
    const off = ex.view === "3d" && !camTween && Math.abs(Math.atan2(Math.sin(cam.yaw), Math.cos(cam.yaw))) > 0.03;
    if (straightBtn.hidden === off) straightBtn.hidden = !off;
    const { lo, hi } = PJ,
      fig = PJ.g > 0.01 ? F[ex.metric] : null,
      along = (t, v) => S(P(yearX(t), 0, v)),
      net = 1 - PJ.g; // the network's share of the picture
    const focus = PJ.g < 0.5 ? ex.sel || ex.hover : null;
    const nb = focus ? new Set(G.adj.get(focus.i).map(([m]) => m.i)) : null;
    // In the years view a study stands for its proposed methods: the method
    // selected, or those of the study under the pointer. Its links run to the
    // studies whose methods they were compared with.
    const fm = fig && PJ.g > 0.5 ? (ex.sel ? [ex.sel] : ex.study ? ex.study[3].map((i) => G.byI.get(i)).filter(Boolean) : []) : [],
      fmi = new Set(fm.map((n) => n.i)),
      fnb = new Map(); // compared method → most conditions shared with the focus
    for (const n of fm) for (const [m, e] of G.adj.get(n.i)) if (!fmi.has(m.i)) fnb.set(m.i, Math.max(fnb.get(m.i) || 0, e.c));
    const role = (pt) => (pt[3].some((i) => fmi.has(i)) ? 2 : pt[3].some((i) => fnb.has(i)) ? 1 : 0); // focus, compared, other
    // Where a method stands: its study's point, or, for one no study in Fig. 2
    // proposed (the focus too, when it is such a method), a hollow mark at its
    // first year and all-years θ.
    const hollow = (i) => !fig.byMethod.has(i) && G.byI.has(i),
      at = (i) => (hollow(i) ? [along(MET[i].year + 0.5, G.byI.get(i).th)] : (fig.byMethod.get(i) || []).map((pt) => along(pt[0], pt[1])));
    marks = [];

    // Circles of equal standard error around the reference, on the ground.
    // Every method sits at rk·√SE from it, so the circles read as how firmly
    // the comparisons tie a method to U-Net (bin/graph-layout.js).
    ctx.globalAlpha = 1 - PJ.g;
    if (G.ref && G.g.rk && G.k && PJ.g < 0.99) {
      const top = d3.max(G.nodes, (n) => n.se) || 0;
      const e10 = 10 ** Math.floor(Math.log10(top / 4)),
        f = top / 4 / e10;
      const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e10;
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = T.grid;
      ctx.font = "11px " + T.font;
      ctx.textBaseline = "bottom";
      ctx.lineJoin = "round";
      for (let v = step; v <= top + 1e-9; v += step) {
        const r = G.k * G.g.rk * Math.sqrt(v);
        ctx.beginPath();
        for (let a = 0; a <= 96; a++) ctx.lineTo(...S(P(r * Math.cos((a * Math.PI) / 48), r * Math.sin((a * Math.PI) / 48), 0)));
        ctx.stroke();
        // Labelled at the upper right when flat and at the front right in 3D,
        // below the methods, which mostly stand above U-Net.
        const a = (Math.PI / 4) * (2 * PJ.h - 1),
          rx = r * Math.cos(a),
          ry = r * Math.sin(a);
        const [px, py] = S(P(rx * PJ.cy + ry * PJ.sy, ry * PJ.cy - rx * PJ.sy, 0));
        ctx.textBaseline = PJ.h > 0.5 ? "top" : "bottom";
        const t = `±${+v.toFixed(3)} ${unit()}`,
          x = px + 3,
          y = py + (PJ.h > 0.5 ? 2 : -2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = T.surface;
        ctx.strokeText(t, x, y);
        ctx.fillStyle = T.muted;
        ctx.fillText(t, x, y);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = T.grid;
      }
    }

    // The years view's frame, as a chart: U-Net's level dashed at 0, and the
    // years along the bottom, where the θ axis meets them.
    if (fig) {
      const [y0, y1] = fig.years,
        A = 0.95 * G.R,
        X = yearX,
        x0 = -A - 22;
      ctx.globalAlpha = PJ.g;
      ctx.strokeStyle = T.muted;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(...S(P(x0, 0, 0)));
      ctx.lineTo(...S(P(A, 0, 0)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(...S(P(x0, 0, lo)));
      ctx.lineTo(...S(P(A, 0, lo)));
      for (let y = y0; y <= y1; y++) {
        const [x, yy] = S(P(X(y), 0, lo));
        ctx.moveTo(x, yy);
        ctx.lineTo(x, yy + 4);
      }
      ctx.stroke();
      ctx.font = "11px " + T.font;
      ctx.fillStyle = T.muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let y = y0; y < y1; y++) {
        const [x, yy] = S(P(X(y + 0.5), 0, lo));
        ctx.fillText(String(y), x, yy + 7);
      }
      ctx.textAlign = "start";
    }
    ctx.globalAlpha = 1;

    // The θ axis, standing on the ground at the left edge of the graph as seen
    // from the camera (in the years view, left of the first year), and as long
    // as the methods shown reach.
    if (PJ.h > 0.01 && G.R) {
      const R = G.R + 16,
        X = -R * PJ.cy + PJ.g * (-0.95 * G.R - 22 + R * PJ.cy),
        Y = R * PJ.sy * (1 - PJ.g),
        ticks = d3.ticks(lo, hi, 8),
        at = (v) => S(P(X, Y, v));
      ctx.globalAlpha = PJ.h;
      ctx.strokeStyle = T.muted;
      ctx.fillStyle = T.muted;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(...at(lo));
      ctx.lineTo(...at(hi));
      for (const v of ticks) {
        const [x, y] = at(v);
        ctx.moveTo(x - 4, y);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.font = "11px " + T.font;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const v of ticks) {
        const [x, y] = at(v);
        ctx.fillText(v ? `${v > 0 ? "+" : "−"}${+Math.abs(v).toFixed(3)}` : "0", x - 7, y);
      }
      ctx.textAlign = "start";
      // The unit once, beside the top of the axis, so the labels stay narrow
      // enough for a phone.
      const [x, y] = at(hi);
      ctx.fillText(unit(), x + 5, y + 4);
      ctx.globalAlpha = 1;
    }

    // Fig. 2's 95% band, under its points.
    if (fig) {
      const { grid, lo: blo, hi: bhi } = fig.mean;
      ctx.globalAlpha = 0.15 * PJ.g;
      ctx.fillStyle = T.ink;
      ctx.beginPath();
      grid.forEach((t, k) => ctx.lineTo(...along(t, bhi[k])));
      for (let k = grid.length - 1; k >= 0; k--) ctx.lineTo(...along(grid[k], blo[k]));
      ctx.fill();
    }

    // Edges in their own colour and strong enough to read against the canvas,
    // fading back when a method is in focus. In 3D only the focus's edges are
    // drawn: the rest crossing at every height would hide the heights.
    ctx.strokeStyle = T.edge;
    ctx.lineWidth = 0.7;
    ctx.globalAlpha = (focus ? 0.05 : G.edges.length > 2500 ? EDGE_ALPHA : EDGE_ALPHA * 1.5) * (1 - PJ.h) * net;
    if (PJ.h < 0.99) {
      ctx.beginPath();
      for (const e of G.edges) {
        if (!vis(e.a) || !vis(e.b)) continue;
        ctx.moveTo(SX(e.a), SY(e.a));
        ctx.lineTo(SX(e.b), SY(e.b));
      }
      ctx.stroke();
    }
    if (focus) {
      // In 3D a hub's edges fan out at every height, so the more methods it
      // was compared with, the fainter they are.
      const hub = Math.min(1, Math.sqrt(80 / G.adj.get(focus.i).length));
      ctx.strokeStyle = T.ink;
      ctx.globalAlpha = 0.6 * (1 - PJ.h + PJ.h * hub);
      for (const [m, e] of G.adj.get(focus.i)) {
        if (!vis(m)) continue;
        ctx.lineWidth = 0.7 + 0.5 * Math.sqrt(e.c) * (1 - 0.6 * PJ.h);
        ctx.beginPath();
        ctx.moveTo(SX(focus), SY(focus));
        ctx.lineTo(SX(m), SY(m));
        ctx.stroke();
      }
      // In 3D, a dashed line down to where the focus stands on the ground, and
      // its 95% interval on θ.
      if (PJ.h > 0.01 && focus !== G.ref) {
        const { X, Y, th, se } = focus,
          [x0, y0] = S(P(X, Y, th - 1.96 * se)),
          [x1, y1] = S(P(X, Y, th + 1.96 * se));
        ctx.globalAlpha = PJ.h * net;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(SX(focus), SY(focus));
        ctx.lineTo(...S(P(X, Y, 0)));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.moveTo(x0 - 4, y0);
        ctx.lineTo(x0 + 4, y0);
        ctx.moveTo(x1 - 4, y1);
        ctx.lineTo(x1 + 4, y1);
        ctx.stroke();
      }
    }
    // Far to near, so nearer methods cover farther ones; flat, smallest first.
    // In 3D the farther ones also fade a little.
    for (const n of net > 0.01 ? G.nodes.filter(vis).sort((a, b) => a.pw - b.pw) : []) {
      const dim = focus && n !== focus && !nb.has(n.i),
        far = Math.min(1, Math.max(0, (G.R - n.pw) / (2 * G.R)));
      ctx.globalAlpha = (dim ? 0.16 : 0.95) * (1 - 0.45 * PJ.h * far) * net;
      ctx.beginPath();
      ctx.arc(SX(n), SY(n), rad(n), 0, 2 * Math.PI);
      ctx.fillStyle = T["f-" + n.m.family];
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = T.surface;
      ctx.stroke();
    }
    // Fig. 2's studies, the focus's links among them, and the mean trend.
    if (fig) {
      if (fm.length) {
        const hub = Math.min(1, Math.sqrt(80 / d3.sum(fm, (n) => G.adj.get(n.i).length)));
        ctx.globalAlpha = 0.6 * PJ.g * hub;
        ctx.strokeStyle = T.ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const n of fm)
          for (const a of at(n.i))
            for (const i of fnb.keys())
              for (const b of at(i)) {
                ctx.moveTo(...a);
                ctx.lineTo(...b);
              }
        ctx.stroke();
        ctx.globalAlpha = 0.9 * PJ.g;
        ctx.lineWidth = 1.5;
        for (const i of [...fnb.keys(), ...fmi])
          if (hollow(i)) {
            const [x, y] = at(i)[0];
            marks.push([x, y, i]);
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
            ctx.fillStyle = T.surface;
            ctx.fill();
            ctx.strokeStyle = T["f-" + MET[i].family];
            ctx.stroke();
          }
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = T.surface;
      for (const pt of fm.length ? [...fig.points].sort((a, b) => role(a) - role(b)) : fig.points) {
        const r = fm.length ? role(pt) : 1;
        ctx.globalAlpha = (r ? 0.9 : 0.16) * PJ.g;
        ctx.beginPath();
        ctx.arc(...along(pt[0], pt[1]), r === 2 || pt === ex.study ? 5 : 3.2, 0, 2 * Math.PI);
        ctx.fillStyle = T["f-" + pt[2]];
        ctx.fill();
        ctx.stroke();
      }
      const { grid, fit } = fig.mean;
      ctx.globalAlpha = 0.9 * PJ.g;
      ctx.strokeStyle = T.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      grid.forEach((t, k) => ctx.lineTo(...along(t, fit[k])));
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
    if (G.ref && net > 0.5) ring(G.ref, 1.4);
    if (focus) ring(focus, 2);
    for (const n of fm)
      for (const a of at(n.i)) {
        ctx.beginPath();
        ctx.arc(...a, 7.5, 0, 2 * Math.PI);
        ctx.lineWidth = 2;
        ctx.strokeStyle = T.ink;
        ctx.stroke();
      }

    // Labels: the focus and the reference, then the most studied methods or the
    // focus's strongest links. Each takes the first free spot beside its method
    // (right, left, above, below); one with none is left out rather than
    // drawn over another. In the years view they go with the network.
    const lab = new Set(focus ? [focus, G.ref] : [G.ref]);
    const ranked = G.nodes.filter(vis).sort((a, b) => b.ns - a.ns);
    if (!focus) ranked.slice(0, 9).forEach((n) => lab.add(n));
    else {
      G.adj
        .get(focus.i)
        .filter(([m]) => vis(m))
        .sort((a, b) => b[1].c - a[1].c)
        .slice(0, 8)
        .forEach(([m]) => lab.add(m));
    }
    if (net < 0.5) lab.clear();
    ctx.font = "500 11.5px " + T.font;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const taken = [];
    const free = (b) => b.x0 > 0 && b.x1 < W && b.y0 > 0 && b.y1 < H && taken.every((o) => b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1);
    // Fig. 2's slope, at the end of its line.
    if (fig && PJ.g > 0.5) {
      const { grid, fit, slope } = fig.mean,
        [x, y] = along(grid[grid.length - 1], fit[fit.length - 1]),
        t = `${slope < 0 ? "−" : "+"}${fmt(Math.abs(slope))} ${unit()}/year`;
      taken.push({ x0: x + 5, x1: x + ctx.measureText(t).width + 9, y0: y - 8, y1: y + 8 });
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = T.surface;
      ctx.strokeText(t, x + 7, y);
      ctx.fillStyle = T.ink;
      ctx.fillText(t, x + 7, y);
    }
    const put = (t, x, y, r, must) => {
      const tw = ctx.measureText(t).width;
      const spots = [
        [x + r + 5, y],
        [x - r - 5 - tw, y],
        [x - tw / 2, y - r - 10],
        [x - tw / 2, y + r + 10],
      ].map(([lx, ly]) => ({ lx, ly, x0: lx - 2, x1: lx + tw + 2, y0: ly - 8, y1: ly + 8 }));
      const at = spots.find(free) || (must ? spots[0] : null);
      if (!at) return;
      taken.push(at);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = T.surface;
      ctx.strokeText(t, at.lx, at.ly);
      ctx.fillStyle = T.ink;
      ctx.fillText(t, at.lx, at.ly);
    };
    for (const n of lab) if (n) put(n === G.ref ? n.m.name + " · reference" : n.m.name, SX(n), SY(n), rad(n), n === focus || n === G.ref);
    // In the years view: the focus's study, then its strongest comparisons.
    for (const n of fm) for (const a of at(n.i)) put(n.m.name, ...a, 5, true);
    [...fnb]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .forEach(([i]) => {
        const a = at(i)[0];
        if (a) put(MET[i].name, ...a, 4, false);
      });
  }

  // --- interaction ---------------------------------------------------------

  function pick(mx, my) {
    let best = null,
      bd = Infinity;
    if (PJ && PJ.g > 0.5) return null; // the network has stepped aside
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

  // The Fig. 2 study under the pointer, in the years view.
  function pickStudy(mx, my) {
    if (!PJ || PJ.g < 0.5) return null;
    let best = null,
      bd = 7 * 7;
    for (const pt of F[ex.metric].points) {
      const [x, y] = S(P(yearX(pt[0]), 0, pt[1])),
        d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bd) [bd, best] = [d, pt];
    }
    return best;
  }

  // The hollow mark under the pointer, in the years view: a method.
  function pickMark(mx, my) {
    let best = null,
      bd = 7 * 7;
    for (const [x, y, i] of marks) {
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bd) [bd, best] = [d, G.byI.get(i)];
    }
    return best;
  }

  // Drags are handled in wire(), so the zoom keeps the wheel and the pinch.
  const zoom = d3
    .zoom()
    .scaleExtent([0.5, 14])
    .filter((e) => e.type === "wheel" || e.touches?.length > 1)
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
        .filter(([m]) => ex.view === "years" || vis(m)) // the years view links every comparison, so it lists them all
        .sort((a, b) => b[1].c - a[1].c)
        .slice(0, 10);
      const path = n === G.ref ? null : bfs(n, G.ref);
      const ln = n.m.paper || n.m.reported; // its own paper, or else the study that reported it; basic operations carry a note instead
      p.innerHTML = `
        <button type="button" class="rg-close" data-close>Back to graph</button>
        <h3>${esc(n.m.name)}</h3>
        <p class="rg-sub">${dot(n.m.family)}${n.m.family} · ${n.m.proposed ? "proposed in a study of Fig. 2" : "comparator only"} · since ${Math.floor(n.m.year)}</p>
        ${
          ln
            ? `<p class="rg-sub">${n.m.paper ? "Paper" : "Reported in"}: <a href="${esc(ln.url)}" target="_blank" rel="noopener">${esc(ln.title)}</a></p>`
            : n.m.note
              ? `<p class="rg-sub">${esc(n.m.note)}</p>`
              : ""
        }
        <div class="rg-big"><strong>${fmt(n.th, d)}</strong><span>${u} vs ${esc(MET[g.ref].name)}<br>95% ± ${fmt(1.96 * n.se, d)}</span></div>
        ${
          ex.view === "years" && F && F[ex.metric].byMethod.get(n.i)
            ? `<p class="rg-note">In Fig. 2: ${F[ex.metric].byMethod
                .get(n.i)
                .map((pt) => fmt(pt[1], d))
                .join(
                  ", "
                )} ${u}, fitted on the three years around its study. Above: all years in one graph. Hollow marks: compared methods no study in Fig. 2 proposed, at their first year and all-years θ.</p>`
            : ""
        }
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
    if (ex.view === "years" && F) {
      const { mean, studies, left_out: out, refitted } = F[ex.metric],
        sg = (v) => (v < 0 ? "−" : "+") + fmt(Math.abs(v)); // two decimals, as the paper prints them
      p.innerHTML = `
        <h3>Over the years</h3>
        <p class="rg-sub">${ex.metric.toUpperCase()} · Fig. 2 of the paper: one point per study, its proposed method against ${esc(MET[g.ref].name)}</p>
        <dl class="rg-kv">
          <dt>Studies</dt><dd>${int(studies)}</dd>
          <dt>Mean trend</dt><dd>${sg(mean.slope)} ${u}/year</dd>
          <dt>95% interval</dt><dd>${sg(mean.ci95[0])} to ${sg(mean.ci95[1])}</dd>
        </dl>
        <p class="rg-note">Each point is fitted on the three years around its study. The band comes from resampling the studies.</p>
        <p class="rg-note">Every method is drawn once, at its first study: ${out} studies whose proposed methods were all there before them are not drawn${
          refitted ? `, and ${refitted} drawn without such methods` : ""
        }. The trend and its numbers are the paper's.</p>`;
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
      if (ex.view === "years")
        [ex.keep, ex.proposedOnly] = [{ proposedOnly: ex.proposedOnly, minStud: ex.minStud, win: ex.win, hidden: ex.hidden }, true];
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
      syncControls();
      if (ex.view !== "2d") turnTo(ex.view === "years" ? YEARS : TILTED);
      d3.select(cv)
        .transition()
        .duration(reduceMotion ? 0 : 400)
        .call(zoom.transform, d3.zoomIdentity);
    };
    // Dragging. In 2D a drag pans, except one that sets off downwards, which
    // tilts the graph into 3D. In 3D a drag turns it (down leans it back, up
    // brings it towards the top view), and letting go near the top view
    // settles it into 2D. Shift-drag pans in both; a second finger hands over
    // to the zoom's pinch.
    let drag = null,
      dragged = false;
    cv.addEventListener("pointerdown", (e) => {
      dragged = false;
      drag = null;
      if (e.button || !e.isPrimary) return;
      drag = {
        x: e.clientX,
        y: e.clientY,
        lx: e.clientX,
        ly: e.clientY,
        yaw: cam.yaw,
        tilt: cam.tilt,
        zt,
        from: ex.view,
        shift: e.shiftKey,
        mode: null,
      };
      cv.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    // Let go near the top view: a drag that tilted out of 2D carries on into
    // 3D, any other goes back to 2D.
    const release = () => {
      if (drag && drag.mode === "turn" && cam.tilt < SNAP) {
        if (drag.from === "2d" && cam.tilt > 0.02) turnTo({ yaw: cam.yaw, tilt: TILTED.tilt });
        else {
          setView("2d");
          turnTo(FLAT);
        }
      }
      drag = null;
      cv.style.cursor = "";
    };
    cv.addEventListener("pointerup", release);
    cv.addEventListener("pointercancel", release);
    cv.addEventListener("pointermove", (e) => {
      if (drag) {
        const dx = e.clientX - drag.x,
          dy = e.clientY - drag.y;
        if (!drag.mode) {
          if (Math.hypot(dx, dy) < 6) return;
          drag.mode = !drag.shift && ex.view === "3d" ? "turn" : "pan";
          stopCam();
          dragged = true;
          ex.hover = null;
          tip.hidden = true;
          cv.style.cursor = "grabbing";
        }
        // A 2D drag that turns out to head down (within 45° of straight down)
        // in its first 40 px tilts after all, from where it began, so a
        // sideways wobble at the start does not make it a pan.
        if (drag.mode === "pan" && !drag.shift && drag.from === "2d" && dy >= 10 && dy > Math.abs(dx) && Math.hypot(dx, dy) < 40) {
          d3.select(cv).call(zoom.transform, drag.zt);
          drag.mode = "turn";
          setView("3d");
        }
        if (drag.mode === "pan") d3.select(cv).call(zoom.translateBy, (e.clientX - drag.lx) / zt.k, (e.clientY - drag.ly) / zt.k);
        else {
          cam.yaw = drag.yaw - dx * 0.008;
          cam.tilt = Math.max(0, Math.min(1.5, drag.tilt + dy * 0.008));
          draw();
        }
        drag.lx = e.clientX;
        drag.ly = e.clientY;
        return;
      }
      if (e.buttons) return; // a pinch, or a button other than the first
      const r = cv.getBoundingClientRect(),
        mx = e.clientX - r.left,
        my = e.clientY - r.top;
      const pt = pickStudy(mx, my),
        n = pick(mx, my) || (pt ? null : pickMark(mx, my));
      if (n !== ex.hover || pt !== ex.study) {
        ex.hover = n;
        ex.study = pt;
        draw();
      }
      cv.style.cursor = n || pt ? "pointer" : "grab";
      if (!n && !pt) {
        tip.hidden = true;
        return;
      }
      const u = UNIT[ex.metric],
        d = ex.metric === "psnr" ? 2 : 3;
      tip.innerHTML = n
        ? `<b>${esc(n.m.name)}</b><br>${dot(n.m.family)}${n.m.family} · ${n.m.proposed ? "proposed" : "comparator"} · since ${Math.floor(n.m.year)}<br>θ <span class="rg-num">${fmt(n.th, d)} ± ${fmt(1.96 * n.se, d)}</span> ${u}<br><span class="rg-num">${n.ns}</span> studies · <span class="rg-num">${n.nc}</span> conditions · <span class="rg-num">${n.dg}</span> neighbours${
            PJ.g > 0.5 ? "<br>No study of its own in Fig. 2; θ from all years" : ""
          }`
        : `<b>${pt[3].length ? esc(pt[3].map((i) => MET[i].name).join(", ")) : "A study"}</b><br>${dot(pt[2])}${pt[2]} · ${Math.floor(pt[0])}<br>θ <span class="rg-num">${fmt(pt[1], d)}</span> ${u} vs ${esc(MET[G.g.ref].name)} in Fig. 2`;
      tip.hidden = false;
      const tw = tip.offsetWidth,
        th = tip.offsetHeight;
      tip.style.left = Math.min(mx + 14, W - tw - 6) + "px";
      tip.style.top = (my + 14 + th > H ? my - th - 10 : my + 14) + "px";
    });
    cv.addEventListener("pointerleave", () => {
      ex.hover = ex.study = null;
      tip.hidden = true;
      draw();
    });
    cv.addEventListener("click", (e) => {
      if (dragged) return;
      const r = cv.getBoundingClientRect(),
        [mx, my] = [e.clientX - r.left, e.clientY - r.top],
        pt = pickStudy(mx, my);
      // In the years view a study selects its (first) proposed method, a hollow
      // mark its method.
      select(pt ? G.byI.get(pt[3][0]) || null : pick(mx, my) || pickMark(mx, my));
    });

    straightBtn.onclick = () => turnTo({ yaw: 0 });
    $("[data-view]")
      .querySelectorAll("button")
      .forEach(
        (b) =>
          (b.onclick = () => {
            setView(b.dataset.v);
            turnTo({ "2d": FLAT, "3d": TILTED, years: YEARS }[b.dataset.v]);
          })
      );
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
      renderPanel();
      draw();
    };
    $("[data-proposed]").onclick = (e) => {
      ex.proposedOnly = !ex.proposedOnly;
      e.currentTarget.setAttribute("aria-pressed", String(ex.proposedOnly));
      renderPanel();
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
          renderPanel();
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
    .then(() => (root.dataset.fig2 ? fetch(root.dataset.fig2) : Promise.reject(new Error("no Fig. 2"))))
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((f) => {
      // Fig. 2 for the years view, with the ranges its axes span.
      for (const k of ["psnr", "ssim"]) {
        const { points, mean } = f[k];
        f[k].range = [d3.min([...points.map((p) => p[1]), ...mean.lo]), d3.max([...points.map((p) => p[1]), ...mean.hi])];
        f[k].years = [Math.floor(d3.min(points, (p) => p[0])), Math.ceil(d3.max(points, (p) => p[0]))];
        f[k].byMethod = new Map();
        for (const p of points) for (const i of p[3]) (f[k].byMethod.get(i) || f[k].byMethod.set(i, []).get(i)).push(p);
      }
      F = f;
    })
    .catch((err) => {
      if (D) {
        $('[data-v="years"]')?.remove(); // no Fig. 2, no years view
        return;
      }
      $("[data-panel]").innerHTML = '<p class="rg-note">Could not load the graph.</p>';
      console.error("recon-graph: data failed to load", err);
    });
})();
