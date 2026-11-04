#!/usr/bin/env node
// Plays the hockey game (assets/js/game.js) without a browser and checks that
// it behaves: nobody leaves the rink, nothing turns into NaN, the puck never
// sits loose for long, and goals come at a sensible rate, for the computer
// against itself and for a simple scripted person against the computer. And
// the Kamboni between periods: driven in rows it cleans the ice in good time,
// and driven anyhow it stays on the ice.
//
//   node bin/check-game.js [games]
//
// Exits non-zero when something is off.

const { Game, Resurfacer, RZ, LEVELS, STEP, GOAL_X } = require("../assets/js/game.js");

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A person who skates at the puck, and with it straight for the net, shooting
// from close in. Not clever, but it should be able to score.
function scripted(game) {
  // At a faceoff, the stick comes down a tenth of a second after the ring
  // closes and the referee lets the puck go (a person watching the ring).
  if (game.phase === "faceoff") {
    const f = game.drop;
    return { pass: f.you === null && f.t >= f.release + 0.1 };
  }
  const p = game.controlled,
    pk = game.puck;
  if (pk.carrier === p) {
    const dx = GOAL_X - 6 - p.x,
      dy = -p.y * 0.5,
      d = Math.hypot(dx, dy) || 1;
    const close = Math.hypot(GOAL_X - p.x, p.y) < 10;
    return { x: dx / d, y: dy / d, shoot: close && Math.random() < 0.05 };
  }
  const dx = pk.x - p.x,
    dy = pk.y - p.y,
    d = Math.hypot(dx, dy) || 1;
  const check = pk.carrier && pk.carrier.team === "b" && d < 3.2 && d > 1.8 && Math.random() < 0.03;
  return { x: dx / d, y: dy / d, shoot: d < 1.8 && Math.random() < 0.1, pass: d > 15 && Math.random() < 0.02, check };
}

function inside(o, r) {
  const cx = 30 - 8.5,
    cy = 15 - 8.5;
  if (Math.abs(o.x) > cx && Math.abs(o.y) > cy) return Math.hypot(Math.abs(o.x) - cx, Math.abs(o.y) - cy) <= 8.5 - r + 0.05;
  return Math.abs(o.x) <= 30 - r + 0.05 && Math.abs(o.y) <= 15 - r + 0.05;
}

function run(seed, mode, level = "normal", size = 3) {
  Math.random = mulberry32(seed * 7 + 1); // the scripted person's own dice
  const game = new Game({ random: mulberry32(seed), human: mode !== "cpu", level, size });
  const problems = [];
  let loose = 0,
    longestLoose = 0,
    t = 0;
  const counts = { save: 0, post: 0, steal: 0, block: 0, pass: 0, hit: 0 },
    draws = { a: 0, b: 0 };
  while (game.phase !== "over" && t < 600) {
    // Between periods everyone skates off, then the next one starts.
    if (game.phase === "intermission" && game.benched) game.nextPeriod();
    const input = mode === "script" ? scripted(game) : {};
    game.step(STEP, input);
    t += STEP;
    for (const ev of game.events.splice(0)) {
      if (ev.type in counts) counts[ev.type]++;
      if (ev.type === "draw") draws[ev.team]++;
    }
    const pk = game.puck;
    for (const o of [pk, ...game.players, game.ref]) {
      if (![o.x, o.y, o.vx, o.vy].every(Number.isFinite)) problems.push(`NaN at ${t.toFixed(1)} s`);
    }
    if (!inside(pk, 0.3)) problems.push(`puck outside the rink at ${t.toFixed(1)} s (${pk.x.toFixed(2)}, ${pk.y.toFixed(2)})`);
    for (const p of game.players) {
      if (!inside(p, 0.9)) problems.push(`${p.team}${p.slot} outside the rink at ${t.toFixed(1)} s`);
      if (p.down > 1.25) problems.push(`${p.team}${p.slot} down for too long at ${t.toFixed(1)} s`);
    }
    if (game.phase === "play" && !pk.carrier && Math.hypot(pk.vx, pk.vy) < 0.5) {
      loose += STEP;
      longestLoose = Math.max(longestLoose, loose);
    } else loose = 0;
    if (problems.length > 5) break;
  }
  if (longestLoose > 6) problems.push(`the puck sat loose for ${longestLoose.toFixed(1)} s`);
  // A person who does nothing can hold the puck for ever; that is their call.
  if (game.phase !== "over" && mode !== "idle") problems.push("the game never ended");
  return { score: game.score, shots: game.shots, counts, draws, longestLoose, problems, overtime: game.overtime, t };
}

// The Kamboni: the crew's way (rows along the rink), or anyhow: steering a
// new way every second or so, from above or from the cab.
function kamboni(seed, how) {
  Math.random = mulberry32(seed * 13 + 5);
  const rz = new Resurfacer();
  const problems = [];
  let input = {};
  while (how === "crew" ? !rz.done && rz.time < 120 : rz.time < 60) {
    if (how === "crew") input = rz.autopilot();
    else if (Math.random() < STEP / 0.9) {
      const a = Math.random() * 2 * Math.PI;
      input = how === "cab" ? { drive: true, steer: Math.random() * 2 - 1, throttle: Math.random() * 2 - 1 } : { x: Math.cos(a), y: Math.sin(a) };
    }
    rz.step(STEP, input);
    if (![rz.x, rz.y, rz.h, rz.v].every(Number.isFinite)) {
      problems.push(`NaN at ${rz.time.toFixed(1)} s`);
      break;
    }
    // Its front and back stay on the ice.
    for (const o of [-1.6, 1.6]) {
      const end = { x: rz.x + Math.cos(rz.h) * o, y: rz.y + Math.sin(rz.h) * o };
      if (!inside(end, RZ.body / 2 - 0.1)) problems.push(`off the ice at ${rz.time.toFixed(1)} s`);
    }
    if (problems.length > 5) break;
  }
  if (how === "crew" && !rz.done) problems.push(`not clean after ${rz.time.toFixed(0)} s (${(100 * rz.part).toFixed(0)}%)`);
  return { time: rz.time, part: rz.part, problems };
}

const games = +process.argv[2] || 12;
let bad = 0;
// Three on three, and five on five (without the person doing nothing).
for (const [mode, size] of [
  ["cpu", 3],
  ["idle", 3],
  ["script", 3],
  ["cpu", 5],
  ["script", 5],
]) {
  const label = size === 5 ? `${mode} 5v5` : mode;
  const totals = { goals: 0, shots: 0, a: 0, b: 0, saves: 0, blocks: 0, steals: 0, hits: 0, passes: 0, ot: 0 };
  for (let i = 1; i <= games; i++) {
    const r = run(i, mode, "normal", size);
    totals.goals += r.score.a + r.score.b;
    totals.a += r.score.a;
    totals.b += r.score.b;
    totals.shots += r.shots.a + r.shots.b;
    totals.saves += r.counts.save;
    totals.blocks += r.counts.block;
    totals.hits += r.counts.hit;
    totals.steals += r.counts.steal;
    totals.passes += r.counts.pass;
    totals.ot += r.overtime ? 1 : 0;
    if (r.problems.length) {
      bad++;
      console.log(`${label} game ${i}: ${r.problems.slice(0, 3).join("; ")}`);
    }
  }
  const per = (v) => (v / games).toFixed(1);
  console.log(
    `${label.padEnd(10)} goals/game ${per(totals.goals)} (blue ${per(totals.a)}, orange ${per(totals.b)}), shots ${per(totals.shots)}, saves ${per(totals.saves)}, blocks ${per(
      totals.blocks
    )}, steals ${per(totals.steals)}, hits ${per(totals.hits)}, passes ${per(totals.passes)}, overtime ${totals.ot}/${games}`
  );
  const avg = totals.goals / games;
  if (mode === "cpu" && (avg < 2 || avg > 14)) {
    bad++;
    console.log(`  computer against itself scores ${avg.toFixed(1)} a game: want 2 to 14`);
  }
  if (mode === "script" && totals.a === 0) {
    bad++;
    console.log("  the scripted person never scored");
  }
}
// The levels: the scripted person should do better on easy than on hard.
{
  const margin = {};
  for (const level of Object.keys(LEVELS)) {
    let a = 0,
      b = 0,
      won = 0,
      draws = 0;
    for (let i = 1; i <= games; i++) {
      const r = run(i, "script", level);
      a += r.score.a;
      b += r.score.b;
      won += r.draws.a;
      draws += r.draws.a + r.draws.b;
      if (r.problems.length) {
        bad++;
        console.log(`script on ${level} game ${i}: ${r.problems.slice(0, 3).join("; ")}`);
      }
    }
    margin[level] = (a - b) / games;
    console.log(
      `level ${level.padEnd(6)} scripted person ${(a / games).toFixed(1)}, computer ${(b / games).toFixed(1)}, faceoffs won ${((100 * won) / (draws || 1)).toFixed(0)}%`
    );
  }
  // (A few games are too few to tell normal from hard.)
  if (games >= 8 && !(margin.easy > margin.normal && margin.normal > margin.hard)) {
    bad++;
    console.log("  the levels are not in order: easy should be easiest");
  }
}
{
  let time = 0,
    part = 0,
    slowest = 0;
  for (let i = 1; i <= games; i++) {
    const crew = kamboni(i, "crew"),
      anyhow = kamboni(i, "above"),
      cab = kamboni(i, "cab");
    time += crew.time;
    slowest = Math.max(slowest, crew.time);
    part += anyhow.part;
    for (const [how, r] of [
      ["the crew's way", crew],
      ["anyhow from above", anyhow],
      ["anyhow from the cab", cab],
    ]) {
      if (r.problems.length) {
        bad++;
        console.log(`kamboni ${how} ${i}: ${r.problems.slice(0, 3).join("; ")}`);
      }
    }
  }
  console.log(
    `kamboni, the crew's way: ${(100 * RZ.done).toFixed(0)}% clean in ${(time / games).toFixed(1)} s; anyhow: ${((100 * part) / games).toFixed(0)}% clean after a minute`
  );
  // The crew's way should take well under a minute: the intermission is a break.
  if (slowest > 45) {
    bad++;
    console.log(`  the Kamboni took ${slowest.toFixed(0)} s the crew's way: want 45 at most`);
  }
}
console.log(bad ? `\n${bad} problem(s)` : "\nok");
process.exit(bad ? 1 : 0);
