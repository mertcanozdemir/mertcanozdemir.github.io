// Runs every drill in _data/drills.yml through the page's own engine and
// reports what would look wrong: passes thrown before the last one landed,
// opponents standing on a pass or shot line, players overlapping, skating
// faster than 9 m/s, anyone leaving the rink, steps out of order.
//
// usage: node bin/check-drills.js [other.yml] [drill-id ...]
const fs = require("fs"),
  path = require("path");
const yaml = require("js-yaml");
const repo = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const file = args[0] && args[0].endsWith(".yml") ? args.shift() : path.join(repo, "_data/drills.yml");
const only = args;
let src = fs.readFileSync(path.join(repo, "assets/js/drills.js"), "utf8");
src = src.replace(/\}\)\(\);\s*$/, "globalThis.__d = { along, simulate, pucksAt };\n})();");
globalThis.document = { addEventListener() {} };
globalThis.window = {};
eval(src);
const { along, simulate, pucksAt } = globalThis.__d;
const drills = yaml.load(fs.readFileSync(file, "utf8"));
const sections = yaml.load(fs.readFileSync(path.join(repo, "_data/drill_sections.yml"), "utf8")).map((s) => s.id);
const inRink = ([x, y]) => {
  const L = 29.6,
    W = 14.6,
    R = 8.5;
  if (Math.abs(x) > L || Math.abs(y) > W) return false;
  const cx = L - R,
    cy = W - R;
  if (Math.abs(x) > cx && Math.abs(y) > cy) return Math.hypot(Math.abs(x) - cx, Math.abs(y) - cy) <= R;
  return true;
};
const ids = new Set();
let bad = 0;
for (const d of drills) {
  if (only.length && !only.includes(d.id)) continue;
  const issues = [];
  if (ids.has(d.id)) issues.push(`duplicate id`);
  ids.add(d.id);
  for (const k of ["title", "section", "category", "duration", "actors", "steps"]) if (d[k] === undefined) issues.push(`missing ${k}`);
  if (!sections.includes(d.section)) issues.push(`unknown section ${d.section}`);
  const sim = simulate(d);
  issues.push(...sim.warnings);
  console.log(`== ${d.id} (${d.duration}s)`);
  for (const l of sim.lines) {
    const dist = Math.hypot(l.to[0] - l.from[0], l.to[1] - l.from[1]);
    console.log(
      `   ${l.shot ? "shot" : "pass"} t=${l.t} (${l.from.map((v) => v.toFixed(1))}) -> (${l.to.map((v) => v.toFixed(1))}) ${dist.toFixed(1)} m, lands ${(l.t + l.f).toFixed(2)}`
    );
    if (l.t + l.f > 1.001) issues.push(`puck from t=${l.t} lands after the end`);
    for (const o of d.actors.filter((o) => o.team === "b")) {
      // A shot that ends at the goalie is a save, not a shot through them.
      const end = along(o, l.t + l.f);
      if (l.shot && /^G/.test(o.label) && Math.hypot(l.to[0] - end[0], l.to[1] - end[1]) < 1.6) continue;
      for (let s = 0.15; s <= 0.85; s += 0.05) {
        const q = along(o, l.t + s * l.f);
        const p = [l.from[0] + (l.to[0] - l.from[0]) * s, l.from[1] + (l.to[1] - l.from[1]) * s];
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.4) {
          issues.push(`${l.shot ? "shot" : "pass"} t=${l.t} goes through ${o.id}`);
          break;
        }
      }
    }
  }
  for (const a of d.actors) {
    let vmax = 0,
      out = null,
      prev = along(a, 0);
    for (let t = 0.002; t <= 1; t += 0.002) {
      const p = along(a, t);
      vmax = Math.max(vmax, Math.hypot(p[0] - prev[0], p[1] - prev[1]) / (0.002 * d.duration));
      if (!inRink(p) && !out) out = p.map((v) => v.toFixed(1));
      prev = p;
    }
    if (vmax > 9) issues.push(`${a.id} reaches ${vmax.toFixed(1)} m/s`);
    if (out) issues.push(`${a.id} leaves the rink at (${out})`);
  }
  outer: for (let t = 0; t <= 1; t += 0.01)
    for (let i = 0; i < d.actors.length; i++)
      for (let j = i + 1; j < d.actors.length; j++) {
        const p = along(d.actors[i], t),
          q = along(d.actors[j], t);
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 2.4) {
          issues.push(`${d.actors[i].id}/${d.actors[j].id} overlap at t=${t.toFixed(2)}`);
          break outer;
        }
      }
  const st = (d.steps || []).map((s) => s.t);
  if (st.some((v, i) => i && v < st[i - 1]) || st.some((v) => v < 0 || v > 1)) issues.push("steps out of order or range");
  for (const p of pucksAt(d, 1)) if (!inRink(p.pos) && Math.abs(p.pos[0]) < 26.5) issues.push(`a puck ends outside the rink`);
  if (issues.length) bad++;
  console.log(issues.length ? issues.map((x) => "  !! " + x).join("\n") : "   ok");
}
console.log(`\n${bad} drill(s) with issues`);
process.exitCode = bad ? 1 : 0;
