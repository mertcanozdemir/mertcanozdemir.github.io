#!/usr/bin/env node
// Plays the hockey game (assets/js/game.js) without a browser and checks that
// it behaves: nobody leaves the rink, nothing turns into NaN, the puck never
// sits loose for long, and goals come at a sensible rate, for the computer
// against itself and for a simple scripted person against the computer.
//
//   node bin/check-game.js [games]
//
// Exits non-zero when something is off.

const { Game, STEP, GOAL_X } = require("../assets/js/game.js");

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
  return { x: dx / d, y: dy / d, shoot: d < 1.8 && Math.random() < 0.1, pass: d > 15 && Math.random() < 0.02 };
}

function inside(o, r) {
  const cx = 30 - 8.5,
    cy = 15 - 8.5;
  if (Math.abs(o.x) > cx && Math.abs(o.y) > cy) return Math.hypot(Math.abs(o.x) - cx, Math.abs(o.y) - cy) <= 8.5 - r + 0.05;
  return Math.abs(o.x) <= 30 - r + 0.05 && Math.abs(o.y) <= 15 - r + 0.05;
}

function run(seed, mode) {
  Math.random = mulberry32(seed * 7 + 1); // the scripted person's own dice
  const game = new Game({ random: mulberry32(seed), human: mode !== "cpu" });
  const problems = [];
  let loose = 0,
    longestLoose = 0,
    t = 0;
  const counts = { save: 0, post: 0, steal: 0, block: 0, pass: 0 };
  while (game.phase !== "over" && t < 600) {
    const input = mode === "script" ? scripted(game) : {};
    game.step(STEP, input);
    t += STEP;
    for (const ev of game.events.splice(0)) if (ev.type in counts) counts[ev.type]++;
    const pk = game.puck;
    for (const o of [pk, ...game.players]) {
      if (![o.x, o.y, o.vx, o.vy].every(Number.isFinite)) problems.push(`NaN at ${t.toFixed(1)} s`);
    }
    if (!inside(pk, 0.3)) problems.push(`puck outside the rink at ${t.toFixed(1)} s (${pk.x.toFixed(2)}, ${pk.y.toFixed(2)})`);
    for (const p of game.players) {
      if (!inside(p, 0.9)) problems.push(`${p.team}${p.slot} outside the rink at ${t.toFixed(1)} s`);
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
  return { score: game.score, shots: game.shots, counts, longestLoose, problems, overtime: game.overtime, t };
}

const games = +process.argv[2] || 12;
let bad = 0;
for (const mode of ["cpu", "idle", "script"]) {
  const totals = { goals: 0, shots: 0, a: 0, b: 0, saves: 0, blocks: 0, steals: 0, passes: 0, ot: 0 };
  for (let i = 1; i <= games; i++) {
    const r = run(i, mode);
    totals.goals += r.score.a + r.score.b;
    totals.a += r.score.a;
    totals.b += r.score.b;
    totals.shots += r.shots.a + r.shots.b;
    totals.saves += r.counts.save;
    totals.blocks += r.counts.block;
    totals.steals += r.counts.steal;
    totals.passes += r.counts.pass;
    totals.ot += r.overtime ? 1 : 0;
    if (r.problems.length) {
      bad++;
      console.log(`${mode} game ${i}: ${r.problems.slice(0, 3).join("; ")}`);
    }
  }
  const per = (v) => (v / games).toFixed(1);
  console.log(
    `${mode.padEnd(6)} goals/game ${per(totals.goals)} (blue ${per(totals.a)}, orange ${per(totals.b)}), shots ${per(totals.shots)}, saves ${per(totals.saves)}, blocks ${per(
      totals.blocks
    )}, steals ${per(totals.steals)}, passes ${per(totals.passes)}, overtime ${totals.ot}/${games}`
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
console.log(bad ? `\n${bad} problem(s)` : "\nok");
process.exit(bad ? 1 : 0);
