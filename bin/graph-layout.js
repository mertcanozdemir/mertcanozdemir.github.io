// Lays out the evidence graph ahead of time, so /graph/ does not spend
// a second or more in a force simulation before it can draw anything.
//
// Reads assets/json/mri_recon_graph.json and appends [x, y] to every node of
// every window, in place. Run it again whenever that file is regenerated:
//   node bin/graph-layout.js
//
// The layout is radial and reads as evidence strength. The reference method
// (U-Net) is pinned to the centre, and every other method sits on a circle of
// radius rk·√SE, where SE is the standard error of its θ against U-Net. SE²/σ²
// is the effective resistance between the two methods in the comparison graph
// (θ's covariance is σ² times the inverse of the reduced graph Laplacian
// M'P_C M), so methods tied to U-Net by many independent comparisons sit close
// and methods resting on a single study sit further out. The square root keeps
// the well-connected core from piling up on U-Net. Every tick puts each method
// back on its circle, so the other forces only arrange methods around their
// circles, keeping compared methods near each other. Each network stores rk,
// which the page uses to draw circles of equal SE.
//
// The forces match runForce() in assets/js/recon-graph.js. "all" is laid out
// from scratch, then each window starts from the positions methods already
// have, so switching windows on the page moves methods instead of scattering
// them. A fixed seed keeps the layout the same from run to run.
const fs = require("fs"),
  path = require("path");
const d3 = require("d3-force");

const file = path.resolve(__dirname, "../assets/json/mri_recon_graph.json");
const D = JSON.parse(fs.readFileSync(file, "utf8"));
const rad = (ns) => 1.8 + 1.5 * Math.sqrt(ns);
const EXTENT = 300; // radius of the outermost method, in layout units

// Puts every free node back on its circle and keeps only the tangential part
// of its velocity, so the radius always encodes the standard error exactly.
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

function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

for (const [metric, windows] of Object.entries(D.networks)) {
  const cache = new Map();
  const random = lcg(20260101);
  const order = [
    "all",
    ...Object.keys(windows)
      .filter((k) => k !== "all")
      .sort(),
  ];
  for (const w of order) {
    const g = windows[w];
    g.nodes = g.nodes.map((n) => n.slice(0, 6));
    g.rk = EXTENT / Math.sqrt(Math.max(...g.nodes.map((n) => n[2])));
    const sn = g.nodes.map(([i, , se, , ns, dg]) => {
      const c = cache.get(i);
      return { i, ns, dg, r: g.rk * Math.sqrt(se), x: c ? c[0] : (random() - 0.5) * 400, y: c ? c[1] : (random() - 0.5) * 400 };
    });
    const ix = new Map(sn.map((s) => [s.i, s]));
    const ref = ix.get(g.ref);
    if (ref) [ref.x, ref.y, ref.fx, ref.fy] = [0, 0, 0, 0];
    const links = g.edges.map(([a, b, c]) => ({ source: ix.get(a), target: ix.get(b), c }));
    const fresh = sn.filter((s) => !cache.has(s.i)).length > sn.length / 2;
    const sim = d3
      .forceSimulation(sn)
      .randomSource(random)
      .force(
        "link",
        d3
          .forceLink(links)
          .distance((l) => 10 + 22 / Math.sqrt(l.c))
          .strength((l) => (0.3 * Math.min(1, 0.25 + 0.08 * l.c)) / Math.min(l.source.dg, l.target.dg))
      )
      .force("charge", d3.forceManyBody().strength(-8).distanceMax(160))
      .force(
        "collide",
        d3.forceCollide((s) => rad(s.ns) + 0.5)
      )
      .alpha(fresh ? 1 : 0.45)
      .stop();
    onCircles(sn);
    for (let k = 0; k < (fresh ? 400 : 200); k++) {
      sim.tick();
      onCircles(sn);
    }
    sn.forEach((s, k) => {
      cache.set(s.i, [s.x, s.y]);
      g.nodes[k].push(Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10);
    });
  }
}

fs.writeFileSync(file, JSON.stringify(D));
console.log(
  "laid out",
  Object.values(D.networks).reduce((n, ws) => n + Object.keys(ws).length, 0),
  "windows"
);
