// Lays out the evidence graph ahead of time, so the home page does not spend
// a second or more in a force simulation before it can draw anything.
//
// Reads assets/json/mri_recon_graph.json and appends [x, y] to every node of
// every window, in place. Run it again whenever that file is regenerated:
//   node bin/graph-layout.js
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
    const sn = g.nodes.map(([i, , , , ns, dg]) => {
      const c = cache.get(i);
      return { i, ns, dg, x: c ? c[0] : (random() - 0.5) * 400, y: c ? c[1] : (random() - 0.5) * 400 };
    });
    const ix = new Map(sn.map((s) => [s.i, s]));
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
          .strength((l) => Math.min(1, 0.25 + 0.08 * l.c) / Math.min(l.source.dg, l.target.dg))
      )
      .force("charge", d3.forceManyBody().strength(-16).distanceMax(320))
      .force(
        "collide",
        d3.forceCollide((s) => rad(s.ns) + 1)
      )
      .force("x", d3.forceX(0).strength(0.035))
      .force("y", d3.forceY(0).strength(0.035))
      .alpha(fresh ? 1 : 0.45)
      .stop();
    for (let k = 0; k < (fresh ? 320 : 160); k++) sim.tick();
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
