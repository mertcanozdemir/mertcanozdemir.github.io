// A small game of three-on-three hockey against the computer, on the rink the
// drills use (drills.js draws it). Rink coordinates: centre ice (0,0), x ±30 m,
// y ±15 m. You are team a (blue) and attack the right-hand goal.
//
// The simulation (Game) touches no DOM, so `node bin/check-game.js` can play
// the computer against itself; the page part at the bottom draws it as SVG and
// reads the keyboard and the touch controls.
(function (root) {
  "use strict";

  const L = 30,
    W = 15,
    CORNER = 8.5,
    GOAL_X = 26; // goal lines, 4 m from the end boards
  const NET_HALF = 1.35,
    NET_DEPTH = 1.6; // as drawn by drills.js: half as big again as regulation
  const PUCK_R = 0.35,
    SKATER_R = 1.0,
    GOALIE_R = 1.15,
    REACH = 1.3; // the stick, ahead of a skater's centre
  const STEP = 1 / 120; // simulation step, in seconds
  // A body check: the burst's speed (m/s) and length (s), how long whoever it
  // knocks down stays down, and the closing speed it takes to knock them down.
  const CHECK = { speed: 10.5, time: 0.3, down: 1.2, hard: 3.5 };
  const DIR = { a: 1, b: -1 }; // the way each team attacks

  const hypot = Math.hypot;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (a, b) => hypot(a.x - b.x, a.y - b.y);
  const other = (team) => (team === "a" ? "b" : "a");

  // Keeps a circle of radius r inside the boards; returns the wall's inward
  // normal when it had to be pushed back, else null.
  function confine(o, r) {
    const cx = L - CORNER,
      cy = W - CORNER;
    if (Math.abs(o.x) > cx && Math.abs(o.y) > cy) {
      const kx = Math.sign(o.x) * cx,
        ky = Math.sign(o.y) * cy;
      const d = hypot(o.x - kx, o.y - ky);
      if (d > CORNER - r) {
        const nx = (o.x - kx) / d,
          ny = (o.y - ky) / d;
        o.x = kx + nx * (CORNER - r);
        o.y = ky + ny * (CORNER - r);
        return [-nx, -ny];
      }
      return null;
    }
    if (Math.abs(o.x) > L - r) {
      const s = Math.sign(o.x);
      o.x = s * (L - r);
      return [-s, 0];
    }
    if (Math.abs(o.y) > W - r) {
      const s = Math.sign(o.y);
      o.y = s * (W - r);
      return [0, -s];
    }
    return null;
  }

  // The nets as boxes, from the goal line back. Returns the outward normal of
  // the side a circle of radius r was pushed out through, else null.
  function outOfNet(o, r) {
    for (const s of [1, -1]) {
      const x0 = s > 0 ? GOAL_X : -GOAL_X - NET_DEPTH,
        x1 = x0 + NET_DEPTH;
      const nx = clamp(o.x, x0, x1),
        ny = clamp(o.y, -NET_HALF, NET_HALF);
      const dx = o.x - nx,
        dy = o.y - ny,
        d = hypot(dx, dy);
      if (d >= r) continue;
      if (d > 1e-6) {
        o.x = nx + (dx / d) * r;
        o.y = ny + (dy / d) * r;
        return [dx / d, dy / d];
      }
      // The centre is inside the box: out through the nearest side.
      const sides = [
        [o.x - x0, -1, 0],
        [x1 - o.x, 1, 0],
        [o.y + NET_HALF, 0, -1],
        [NET_HALF - o.y, 0, 1],
      ].sort((a, b) => a[0] - b[0]);
      const [, ox, oy] = sides[0];
      if (ox) o.x = (ox < 0 ? x0 : x1) + ox * r;
      else o.y = oy * (NET_HALF + r);
      return [ox, oy];
    }
    return null;
  }

  // The back and sides of each net, as segments: what a puck can hit. The
  // mouth is open. Returns the normal to push the puck along, and whether it
  // hit a post (the front end of a side), else null.
  const FRAMES = [1, -1].flatMap((s) => {
    const front = s * GOAL_X,
      back = s * (GOAL_X + NET_DEPTH);
    return [
      [back, -NET_HALF, back, NET_HALF],
      [front, -NET_HALF, back, -NET_HALF],
      [front, NET_HALF, back, NET_HALF],
    ];
  });
  function offFrame(o, r) {
    for (const [x0, y0, x1, y1] of FRAMES) {
      const dx = x1 - x0,
        dy = y1 - y0;
      const t = clamp(((o.x - x0) * dx + (o.y - y0) * dy) / (dx * dx + dy * dy), 0, 1);
      const cx = x0 + dx * t,
        cy = y0 + dy * t;
      let nx = o.x - cx,
        ny = o.y - cy;
      const d = hypot(nx, ny);
      if (d >= r) continue;
      if (d < 1e-6) [nx, ny] = [Math.sign(o.x - Math.sign(o.x) * (GOAL_X + NET_DEPTH / 2)) || 1, 0];
      else [nx, ny] = [nx / d, ny / d];
      o.x = cx + nx * r;
      o.y = cy + ny * r;
      return { n: [nx, ny], post: dy === 0 && t === 0 };
    }
    return null;
  }

  class Game {
    constructor(opts = {}) {
      this.random = opts.random || Math.random;
      this.human = opts.human !== false; // a person plays team a's controlled skater
      this.seconds = opts.seconds || 180;
      this.reset();
    }

    reset() {
      this.score = { a: 0, b: 0 };
      this.shots = { a: 0, b: 0 };
      this.clock = this.seconds;
      this.overtime = false;
      this.events = [];
      this.players = [];
      for (const team of ["a", "b"]) {
        for (let slot = 0; slot < 3; slot++) this.players.push(this.player(team, "skater", slot));
        this.players.push(this.player(team, "goalie", 3));
      }
      this.puck = { x: 0, y: 0, vx: 0, vy: 0, carrier: null, last: null, held: 0, beat: null, rebound: 0, from: null, trail: [] };
      this.controlled = this.players[0];
      this.faceoff();
    }

    player(team, role, slot) {
      return {
        team,
        role,
        slot,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        fx: DIR[team],
        fy: 0,
        wx: 0,
        wy: 0,
        idle: false,
        noTouch: 0,
        cool: 0,
        tx: 0,
        ty: 0,
        down: 0, // seconds left on the ice after a check
        dash: 0, // seconds left of a check's burst, at dashX, dashY
        dashX: 0,
        dashY: 0,
        checkCool: 0,
        oneTimer: 0, // seconds left to shoot a pass straight back
        goals: 0,
      };
    }

    goalieOf(team) {
      return this.players.find((p) => p.team === team && p.role === "goalie");
    }

    skaters(team) {
      return this.players.filter((p) => p.team === team && p.role === "skater");
    }

    stick(p) {
      return { x: p.x + p.fx * REACH, y: p.y + p.fy * REACH };
    }

    faceoff() {
      const spots = [
        [-1.6, 0],
        [-6, -6],
        [-12, 4],
      ];
      for (const p of this.players) {
        const s = DIR[p.team];
        if (p.role === "goalie") [p.x, p.y] = [-s * (GOAL_X - 1), 0];
        else [p.x, p.y] = [s * spots[p.slot][0], s * spots[p.slot][1]];
        Object.assign(p, { vx: 0, vy: 0, fx: s, fy: 0, wx: 0, wy: 0, noTouch: 0, cool: 0, down: 0, dash: 0, checkCool: 0, oneTimer: 0 });
      }
      Object.assign(this.puck, { x: 0, y: 0, vx: 0, vy: 0, carrier: null, last: null, held: 0, beat: null, rebound: 0, trail: [] });
      if (this.human) this.controlled = this.players[0];
      this.phase = "faceoff";
      this.wait = 1.1;
      this.events.push({ type: "faceoff" });
    }

    // One simulation step. `input` is the person's: {x, y} to skate, and
    // `shoot` and `pass` for presses since the last step.
    step(dt, input = {}) {
      if (this.phase === "over") return;
      if (this.phase !== "play") {
        this.wait -= dt;
        if (this.phase === "goal") this.glide(dt);
        if (this.wait > 0) return;
        if (this.phase === "goal") return this.decided ? this.finish() : this.faceoff();
        this.phase = "play";
        return;
      }
      if (!this.overtime) {
        this.clock -= dt;
        if (this.clock <= 0) {
          this.clock = 0;
          if (this.score.a !== this.score.b) return this.finish();
          this.overtime = true;
          this.events.push({ type: "overtime" });
        }
      }
      const pk = this.puck;
      pk.rebound = Math.max(0, pk.rebound - dt);
      for (const team of ["a", "b"]) this.plan(team);
      this.t = (this.t || 0) + dt;
      for (const p of this.players) {
        p.cool = Math.max(0, p.cool - dt);
        p.noTouch = Math.max(0, p.noTouch - dt);
        p.checkCool = Math.max(0, p.checkCool - dt);
        p.oneTimer = Math.max(0, p.oneTimer - dt);
        p.dash = Math.max(0, p.dash - dt);
        if (p.down > 0) {
          // Knocked down: slides to a stop, then gets up.
          p.down = Math.max(0, p.down - dt);
          p.wx = p.wy = 0;
          continue;
        }
        if (p.role === "goalie") this.keepGoal(p, dt);
        else if (this.human && p === this.controlled) this.obey(p, input);
        else this.think(p, dt);
      }
      this.move(dt);
      this.movePuck(dt);
    }

    finish() {
      this.phase = "over";
      this.events.push({ type: "final", score: { ...this.score } });
    }

    // After a goal everyone coasts to a stop.
    glide(dt) {
      for (const p of this.players) {
        const f = Math.max(0, 1 - 2.5 * dt);
        p.vx *= f;
        p.vy *= f;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        confine(p, SKATER_R);
      }
    }

    // Against a person, the computer's team plays a little better than the
    // person's own teammates: as fast as the person, keener with the stick,
    // and a sharper goalie.
    sharp(team) {
      return this.human && team === "b";
    }

    maxSpeed(p) {
      if (p.role === "goalie") return 5;
      const base = (this.human && p === this.controlled) || this.sharp(p.team) ? 7.8 : 7.6;
      return this.puck.carrier === p ? base * 0.9 : base;
    }

    // Where each skater the computer moves should go: chase or carry the puck,
    // get open, cover a player or the slot.
    plan(team) {
      const pk = this.puck,
        s = DIR[team],
        own = -s * GOAL_X,
        opp = s * GOAL_X;
      const c = pk.carrier;
      const mine = this.skaters(team).filter((p) => p !== c && !(this.human && p === this.controlled));
      const spots = [];
      if (c && c.team === team && c.role === "goalie") {
        spots.push([own + s * 9, 7], [own + s * 9, -7], [own + s * 17, 0]);
      } else if (c && c.team === team) {
        spots.push([opp - s * 7, c.y > 0 ? -6 : 6], [c.x - s * 8, c.y * 0.3], [opp - s * 12, c.y > 0 ? 3 : -3]);
      } else if (c && c.role === "goalie") {
        spots.push([opp - s * 9, 5], [opp - s * 9, -5], [opp - s * 18, 0]);
      } else if (c) {
        // The nearest goes for the puck, where it is about to be; the next
        // covers the opponent nearest its goal; the last minds the slot.
        // ...from the stick side, not through the carrier.
        const away = hypot(pk.x - c.x, pk.y - c.y) || 1;
        const ahead = { x: pk.x + ((pk.x - c.x) / away) * 0.9 + c.vx * 0.2, y: pk.y + ((pk.y - c.y) / away) * 0.9 + c.vy * 0.2 };
        const threat = this.skaters(other(team))
          .filter((o) => o !== c)
          .sort((a, b) => Math.abs(a.x - own) - Math.abs(b.x - own))[0];
        spots.push([ahead.x, ahead.y]);
        if (threat) spots.push([threat.x + (own - threat.x) * 0.12, threat.y * 0.85]);
        spots.push([own + s * 6, clamp(pk.y * 0.35, -3, 3)]);
      } else {
        const lead = { x: pk.x + pk.vx * 0.3, y: pk.y + pk.vy * 0.3 };
        spots.push([lead.x, lead.y], [pk.x - s * 7, pk.y * 0.5], [own + s * 7, pk.y * 0.3]);
      }
      // Nearest-first, so the closest skater takes the first (most urgent) spot.
      const free = mine.slice();
      for (const [x, y] of spots) {
        if (!free.length) break;
        let best = 0;
        free.forEach((p, i) => {
          if (hypot(p.x - x, p.y - y) < hypot(free[best].x - x, free[best].y - y)) best = i;
        });
        const p = free.splice(best, 1)[0];
        const spot = { x, y };
        confine(spot, SKATER_R);
        p.tx = spot.x;
        p.ty = spot.y;
      }
    }

    // Wanted velocity toward a point, slowing on arrival so nobody jitters.
    steer(p, x, y, speed) {
      const dx = x - p.x,
        dy = y - p.y,
        d = hypot(dx, dy);
      const v = Math.min(speed === undefined ? this.maxSpeed(p) : speed, d * 2.2);
      p.wx = d > 1e-6 ? (dx / d) * v : 0;
      p.wy = d > 1e-6 ? (dy / d) * v : 0;
      p.idle = false;
    }

    think(p, dt) {
      const pk = this.puck,
        c = pk.carrier;
      if (c === p) return this.carry(p, dt);
      // ...or line up a body check on a carrier close by.
      if (c && c.team !== p.team && c.role === "skater" && p.checkCool <= 0) {
        const d = dist(p, c);
        if (d > 1.8 && d < 3.4 && this.random() < (this.sharp(p.team) ? 0.6 : 0.45) * dt) {
          return this.check(p, c.x + c.vx * 0.15 - p.x, c.y + c.vy * 0.15 - p.y);
        }
      }
      if (c && c.team !== p.team && c.role === "skater" && p.cool <= 0) {
        if (Math.min(dist(this.stick(p), pk), dist(p, pk) - 0.8) < 1.4 && this.random() < 1.8 * dt)
          this.poke(p, this.sharp(p.team) ? 0.55 : 0.45, 1.4);
      }
      this.steer(p, p.tx, p.ty);
    }

    // The computer with the puck: up the ice, then across the slot looking for
    // a lane. It shoots from a good spot (through traffic too, less often, and
    // more often the longer it has had the puck), and passes when pressed.
    carry(p, dt) {
      const s = DIR[p.team],
        opp = s * GOAL_X;
      p.held = (p.held || 0) + dt;
      const front = s * (opp - p.x);
      const toGoal = hypot(opp - p.x, p.y);
      const urge = 1 + Math.max(0, p.held - 3) * 0.6;
      if (p.cool <= 0 && front > 1.5 && toGoal < 18 && Math.abs(p.y) < front * 1.3 + 2) {
        const open = !this.blocked(p, { x: opp, y: 0 }, 1.0);
        const rate = (open ? (toGoal < 9 ? 3.5 : 1.4) : 0.5) * urge;
        if (this.random() < rate * dt) return this.shoot(p, null);
      }
      const near = this.nearestOpponent(p);
      const pressed = near && dist(near, p) < 2.8;
      if (p.cool <= 0 && this.random() < (pressed ? 1 : 0.15) * urge * dt) {
        const mate = this.passTarget(p, null);
        if (mate) return this.pass(p, mate);
      }
      let tx, ty;
      if (front > 14) [tx, ty] = [opp - s * 10, clamp(p.y * 0.6, -5, 5)];
      else if (front < 1.5) [tx, ty] = [opp - s * 6, p.y > 0 ? 4 : -4];
      else {
        // In the zone: keep moving across the slot, turning back at either side.
        if (!p.side || Math.abs(p.y - p.side * 4) < 1.2) p.side = p.y > 0 ? -1 : 1;
        [tx, ty] = [opp - s * 7, p.side * 4];
      }
      if (near && dist(near, p) < 4) {
        const ax = tx - p.x,
          ay = ty - p.y,
          al = hypot(ax, ay) || 1;
        const side = (near.x - p.x) * -ay + (near.y - p.y) * ax > 0 ? -1 : 1;
        tx += side * (-ay / al) * 3;
        ty += side * (ax / al) * 3;
      }
      const spot = { x: tx, y: ty };
      confine(spot, SKATER_R);
      // Never park with the puck: the target stays a few metres away.
      const d = dist(spot, p);
      if (d < 3) {
        const k = 3 / (d || 1);
        spot.x = p.x + (spot.x - p.x) * k || p.x + s * 3;
        spot.y = p.y + (spot.y - p.y) * k;
      }
      this.steer(p, spot.x, spot.y, this.maxSpeed(p));
    }

    // The person's skater: skate where the stick points; shoot or poke, pass
    // or switch to the teammate nearest the puck.
    obey(p, input) {
      const ix = input.x || 0,
        iy = input.y || 0,
        il = hypot(ix, iy);
      const max = this.maxSpeed(p);
      p.idle = il < 0.15;
      p.wx = p.idle ? 0 : (ix / il) * max * Math.min(1, il);
      p.wy = p.idle ? 0 : (iy / il) * max * Math.min(1, il);
      const pk = this.puck;
      if (input.shoot) {
        if (pk.carrier === p) this.shoot(p, il > 0.3 && Math.abs(iy / il) > 0.35 ? Math.sign(iy) * NET_HALF * 0.7 : null);
        else if (p.cool <= 0) this.poke(p, 0.5, 1.6);
      }
      if (input.check) this.check(p, il > 0.3 ? ix : p.fx, il > 0.3 ? iy : p.fy);
      if (input.pass) {
        if (pk.carrier === p) {
          const mate = this.passTarget(p, il > 0.3 ? [ix / il, iy / il] : null);
          if (mate) this.pass(p, mate);
        } else this.switchPlayer();
      }
    }

    // A body check: a short burst along (dx, dy). Whoever it hits hard enough,
    // with the puck or not, goes down (see move()).
    check(p, dx, dy) {
      if (p.checkCool > 0 || p.down > 0 || p.role === "goalie" || this.puck.carrier === p) return;
      const l = hypot(dx, dy) || 1;
      p.dash = CHECK.time;
      p.dashX = (dx / l) * CHECK.speed;
      p.dashY = (dy / l) * CHECK.speed;
      p.checkCool = this.human && p === this.controlled ? 1.2 : 2.8;
      this.events.push({ type: "lunge", team: p.team });
    }

    knock(hitter, victim, nx, ny, speed) {
      const pk = this.puck;
      victim.down = CHECK.down;
      victim.noTouch = CHECK.down + 0.2;
      victim.dash = 0;
      victim.vx += nx * speed * 0.7;
      victim.vy += ny * speed * 0.7;
      hitter.dash = 0;
      hitter.vx *= 0.35;
      hitter.vy *= 0.35;
      if (pk.carrier === victim) {
        const a = Math.atan2(ny, nx) + (this.random() - 0.5) * 2;
        pk.carrier = null;
        pk.last = hitter;
        pk.vx = victim.vx + Math.cos(a) * 4;
        pk.vy = victim.vy + Math.sin(a) * 4;
      }
      const near = { x: victim.x, y: victim.y };
      const boards = !!confine(near, SKATER_R + 2.2);
      this.events.push({ type: "hit", team: hitter.team, boards, by: this.players.indexOf(hitter), on: this.players.indexOf(victim) });
    }

    switchPlayer() {
      const pk = this.puck;
      const mates = this.skaters("a").filter((p) => p !== this.controlled);
      mates.sort((a, b) => dist(a, pk) - dist(b, pk));
      if (mates[0]) {
        this.controlled = mates[0];
        this.events.push({ type: "switch" });
      }
    }

    nearestOpponent(p) {
      let best = null;
      for (const o of this.skaters(other(p.team))) if (!best || dist(o, p) < dist(best, p)) best = o;
      return best;
    }

    // Is an opponent within reach of the straight line from p's puck to q?
    blocked(p, q, margin = 1.2) {
      const a = this.puck;
      const dx = q.x - a.x,
        dy = q.y - a.y,
        len2 = dx * dx + dy * dy || 1;
      return this.players.some((o) => {
        if (o.team === p.team || o.role === "goalie") return false;
        const t = clamp(((o.x - a.x) * dx + (o.y - a.y) * dy) / len2, 0, 1);
        return hypot(a.x + dx * t - o.x, a.y + dy * t - o.y) < margin;
      });
    }

    // The teammate to pass to: open, ahead, not too near or far; with a
    // direction from the person, the one most along it.
    passTarget(p, toward) {
      const s = DIR[p.team];
      let best = null,
        bestScore = -Infinity;
      for (const m of this.skaters(p.team)) {
        if (m === p) continue;
        const d = dist(m, p);
        if (d < 3 || d > 32) continue;
        let score = (s * (m.x - p.x)) / 10 - d / 30;
        if (this.blocked(p, m, 1.3)) score -= toward ? 1.5 : 100;
        if (toward) score += 4 * (((m.x - p.x) * toward[0] + (m.y - p.y) * toward[1]) / d);
        if (score > bestScore) [best, bestScore] = [m, score];
      }
      return bestScore > -50 ? best : null;
    }

    release(p) {
      const pk = this.puck;
      pk.carrier = null;
      pk.last = p;
      pk.beat = null;
      pk.oneTimer = false;
      p.noTouch = p.role === "goalie" ? 0.8 : 0.35;
      p.cool = 0.45;
    }

    shoot(p, aimY) {
      const pk = this.puck,
        s = DIR[p.team],
        gx = s * GOAL_X;
      const goalie = this.goalieOf(other(p.team));
      const corner = NET_HALF * 0.7;
      let ty = aimY !== null ? aimY : goalie.y > 0 ? -corner : corner;
      const d = hypot(gx - pk.x, ty - pk.y);
      ty += (this.random() - 0.5) * 2 * (0.25 + d * 0.035);
      const quick = p.oneTimer > 0;
      const speed = 25 + this.random() * 5 + (quick ? 4 : 0);
      const dx = gx - pk.x,
        dy = ty - pk.y,
        l = hypot(dx, dy) || 1;
      this.release(p);
      pk.vx = (dx / l) * speed;
      pk.vy = (dy / l) * speed;
      pk.from = { x: pk.x, y: pk.y };
      pk.oneTimer = quick;
      p.oneTimer = 0;
      this.shots[p.team]++;
      this.events.push({ type: "shot", team: p.team, oneTimer: quick, you: this.human && p === this.controlled });
    }

    pass(p, m) {
      const pk = this.puck;
      const d = dist(m, pk),
        speed = clamp(8 + d * 0.7, 10, 20);
      const t = d / speed;
      const aim = { x: m.x + m.vx * t, y: m.y + m.vy * t };
      confine(aim, SKATER_R);
      const dx = aim.x - pk.x,
        dy = aim.y - pk.y,
        l = hypot(dx, dy) || 1;
      this.release(p);
      pk.vx = (dx / l) * speed;
      pk.vy = (dy / l) * speed;
      pk.from = null;
      pk.passedAt = this.t;
      this.events.push({ type: "pass", team: p.team });
    }

    // A stick at the carrier's puck: knocks it loose with the given chance.
    poke(p, chance, reach) {
      const pk = this.puck,
        c = pk.carrier;
      p.cool = 0.5;
      if (!c || c.team === p.team || c.role === "goalie") return;
      if (Math.min(dist(this.stick(p), pk), dist(p, pk) - 0.8) > reach) return;
      if (this.random() >= chance) return;
      const ang = Math.atan2(p.fy, p.fx) + (this.random() - 0.5) * 1.8;
      pk.carrier = null;
      pk.last = p;
      pk.vx = c.vx * 0.3 + Math.cos(ang) * 5;
      pk.vy = c.vy * 0.3 + Math.sin(ang) * 5;
      c.noTouch = 0.45;
      this.events.push({ type: "steal", team: p.team });
    }

    // Goalies stay on an arc in front of their goal, facing the puck, and pass
    // a covered puck out after a moment.
    keepGoal(g, dt) {
      const pk = this.puck,
        s = DIR[g.team],
        gx = -s * GOAL_X;
      if (pk.carrier === g) {
        pk.held -= dt;
        if (pk.held <= 0) {
          const mate = this.passTarget(g, null) || this.skaters(g.team).sort((a, b) => dist(a, g) - dist(b, g))[0];
          this.pass(g, mate);
        }
      }
      const ang = clamp(Math.atan2(pk.y, (pk.x - gx) * s), -1.25, 1.25);
      this.steer(g, gx + s * Math.cos(ang) * 1.3, Math.sin(ang) * 1.3, 5);
    }

    move(dt) {
      for (const p of this.players) {
        if (p.dash > 0) [p.wx, p.wy] = [p.dashX, p.dashY];
        let dvx = p.wx - p.vx,
          dvy = p.wy - p.vy;
        const acc = (p.dash > 0 ? 60 : p.down > 0 ? 6 : p.role === "goalie" ? 20 : p.idle ? 3 : 13) * dt,
          dl = hypot(dvx, dvy);
        if (dl > acc) [dvx, dvy] = [(dvx * acc) / dl, (dvy * acc) / dl];
        p.vx += dvx;
        p.vy += dvy;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // Skaters face where they skate; goalies face the puck.
        let hx = p.vx,
          hy = p.vy;
        if (p.role === "goalie") [hx, hy] = [this.puck.x - p.x, this.puck.y - p.y];
        const hl = hypot(hx, hy);
        if (hl > (p.role === "goalie" ? 0.01 : 0.6)) {
          const k = Math.min(1, 9 * dt);
          p.fx += (hx / hl - p.fx) * k;
          p.fy += (hy / hl - p.fy) * k;
          const fl = hypot(p.fx, p.fy) || 1;
          p.fx /= fl;
          p.fy /= fl;
        }
      }
      // Bodies bump: pushed apart, and the closing speed shared.
      const ps = this.players;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i],
            b = ps[j];
          const ra = a.role === "goalie" ? GOALIE_R : SKATER_R,
            rb = b.role === "goalie" ? GOALIE_R : SKATER_R;
          const dx = b.x - a.x,
            dy = b.y - a.y,
            d = hypot(dx, dy);
          if (d >= ra + rb || d < 1e-6) continue;
          const nx = dx / d,
            ny = dy / d,
            push = (ra + rb - d) / 2;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
          const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (closing > CHECK.hard && a.team !== b.team && (a.dash > 0 || b.dash > 0)) {
            const hitter = a.dash > 0 && (b.dash <= 0 || hypot(a.vx, a.vy) >= hypot(b.vx, b.vy)) ? a : b;
            const victim = hitter === a ? b : a;
            if (victim.role === "skater" && victim.down <= 0) {
              this.knock(hitter, victim, hitter === a ? nx : -nx, hitter === a ? ny : -ny, closing);
              continue;
            }
          }
          if (closing > 0) {
            a.vx -= nx * closing * 0.4;
            a.vy -= ny * closing * 0.4;
            b.vx += nx * closing * 0.4;
            b.vy += ny * closing * 0.4;
          }
        }
      }
      for (const p of ps) {
        const r = p.role === "goalie" ? GOALIE_R : SKATER_R;
        const n = confine(p, r) || outOfNet(p, r);
        if (n) {
          const into = p.vx * n[0] + p.vy * n[1];
          if (into < 0) {
            p.vx -= n[0] * into;
            p.vy -= n[1] * into;
          }
        }
      }
    }

    movePuck(dt) {
      const pk = this.puck;
      const c = pk.carrier;
      if (c) {
        if (c.role === "goalie") {
          pk.x = c.x + DIR[c.team] * 0.7;
          pk.y = c.y;
        } else {
          const st = this.stick(c);
          pk.x = st.x;
          pk.y = st.y;
        }
        pk.vx = c.vx;
        pk.vy = c.vy;
        confine(pk, PUCK_R);
        outOfNet(pk, PUCK_R);
        pk.trail = [];
        return;
      }
      const n = 4,
        h = dt / n;
      for (let i = 0; i < n; i++) {
        const sp = hypot(pk.vx, pk.vy);
        if (sp > 0) {
          const f = Math.max(0, sp - (1.1 + 0.08 * sp) * h) / sp;
          pk.vx *= f;
          pk.vy *= f;
        }
        const px = pk.x;
        pk.x += pk.vx * h;
        pk.y += pk.vy * h;
        for (const s of [1, -1]) {
          const line = s * GOAL_X;
          if ((px - line) * s < 0 && (pk.x - line) * s >= 0 && Math.abs(pk.y) < NET_HALF) {
            return this.goal(s > 0 ? "a" : "b");
          }
        }
        const wall = confine(pk, PUCK_R);
        const frame = wall ? null : offFrame(pk, PUCK_R);
        const nrm = wall || (frame && frame.n);
        if (nrm) {
          const into = pk.vx * nrm[0] + pk.vy * nrm[1];
          if (into < 0) {
            const e = frame ? 0.45 : 0.7;
            pk.vx -= (1 + e) * into * nrm[0];
            pk.vy -= (1 + e) * into * nrm[1];
            if (frame && frame.post && -into > 8) this.events.push({ type: "post" });
          }
        }
        if (this.touch()) break;
      }
      // A streak behind a fast puck.
      if (hypot(pk.vx, pk.vy) < 12) pk.trail = [];
      else if (pk.trail.push([pk.x, pk.y]) > 7) pk.trail.shift();
    }

    // Saves, blocks and pickups. Returns true when the puck changed hands or
    // direction, which ends the step.
    touch() {
      const pk = this.puck,
        sp = hypot(pk.vx, pk.vy);
      if (pk.beat && dist(pk.beat, pk) > GOALIE_R + PUCK_R + 0.3) pk.beat = null;
      if (pk.through && dist(pk.through, pk) > SKATER_R + PUCK_R + 0.3) pk.through = null;
      for (const g of this.players) {
        if (g.role !== "goalie" || g.noTouch > 0 || pk.beat === g) continue;
        if (dist(g, pk) > GOALIE_R + PUCK_R) continue;
        if (sp < 6) {
          this.cover(g);
          return true;
        }
        const s = DIR[g.team];
        const shotLength = pk.from ? hypot(pk.from.x + s * GOAL_X, pk.from.y) : 20;
        let chance =
          0.82 -
          Math.max(0, sp - 18) * 0.02 -
          Math.abs(g.vy) * 0.06 -
          (pk.rebound > 0 ? 0.18 : 0) -
          (shotLength < 6 ? 0.12 : 0) -
          (pk.oneTimer ? 0.12 : 0);
        if (this.sharp(g.team)) chance += 0.1;
        chance = clamp(chance, 0.3, 0.95);
        if (this.random() < chance) {
          pk.oneTimer = false;
          this.events.push({ type: "save", team: g.team });
          if (sp < 14 || this.random() < 0.3) this.cover(g);
          else {
            // A rebound, off the pads and away from the middle.
            const away = Math.atan2(pk.y - g.y, pk.x - g.x) + (this.random() - 0.5) * 1.2;
            const v = Math.min(10, sp * 0.35);
            pk.vx = Math.cos(away) * v + DIR[g.team] * 2;
            pk.vy = Math.sin(away) * v;
            pk.last = g;
            pk.rebound = 1.5;
            pk.from = null;
            g.noTouch = 0.4;
          }
          return true;
        }
        pk.beat = g;
      }
      let best = null,
        bestReach = 0.8;
      for (const p of this.players) {
        if (p.role !== "skater" || p.noTouch > 0) continue;
        if (sp > 21) {
          // Too fast to take: an opponent in its way may block it with the
          // body, or it slips through, past the skates.
          if (!pk.last || p.team === pk.last.team || dist(p, pk) > SKATER_R + PUCK_R || pk.through === p) continue;
          if (this.random() > 0.45) {
            pk.through = p;
            continue;
          }
          const nx = (pk.x - p.x) / (dist(p, pk) || 1),
            ny = (pk.y - p.y) / (dist(p, pk) || 1);
          const into = pk.vx * nx + pk.vy * ny;
          if (into < 0) {
            pk.vx = (pk.vx - 2 * into * nx) * 0.35;
            pk.vy = (pk.vy - 2 * into * ny) * 0.35;
            pk.last = p;
            pk.from = null;
            pk.oneTimer = false;
            this.events.push({ type: "block", team: p.team });
            return true;
          }
          continue;
        }
        // A little luck breaks ties, as at a faceoff.
        const reach = Math.min(dist(this.stick(p), pk), dist(p, pk) - (SKATER_R - 0.3)) + this.random() * 0.1;
        if (reach < bestReach) [best, bestReach] = [p, reach];
      }
      if (best) {
        this.take(best);
        return true;
      }
      return false;
    }

    cover(g) {
      const pk = this.puck;
      pk.carrier = g;
      pk.last = g;
      pk.held = 1.1;
      pk.vx = pk.vy = 0;
      pk.from = null;
      pk.rebound = 0;
      if (this.human && g.team === "b") this.switchNearest();
    }

    take(p) {
      const pk = this.puck,
        had = pk.last && pk.last.team;
      const passed = pk.last && pk.last !== p && pk.last.team === p.team && this.t - (pk.passedAt ?? -9) < 1.6;
      p.oneTimer = passed ? 0.45 : 0;
      pk.oneTimer = false;
      pk.carrier = p;
      pk.last = p;
      pk.beat = null;
      pk.from = null;
      pk.rebound = 0;
      p.held = 0;
      if (this.human && p.team === "a") this.controlled = p;
      else if (this.human && had !== "b") this.switchNearest();
      this.events.push({ type: "take", team: p.team });
    }

    // When the computer gets the puck, the person takes over the skater
    // nearest it, if that is clearly a better one to defend with.
    switchNearest() {
      const pk = this.puck;
      const near = this.skaters("a").sort((a, b) => dist(a, pk) - dist(b, pk))[0];
      if (near && near !== this.controlled && dist(this.controlled, pk) - dist(near, pk) > 3) this.controlled = near;
    }

    goal(team) {
      this.score[team]++;
      const pk = this.puck;
      pk.vx *= 0.2;
      pk.vy *= 0.2;
      this.phase = "goal";
      this.wait = 2.4;
      this.decided = this.overtime;
      const by = pk.last,
        own = !by || by.team !== team;
      if (!own) by.goals++;
      this.events.push({
        type: "goal",
        team,
        score: { ...this.score },
        overtime: this.overtime,
        own,
        hatTrick: !own && by.goals === 3,
        oneTimer: !!pk.oneTimer,
      });
    }
  }

  const api = { Game, STEP, GOAL_X };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HockeyGame = api;

  // ——— The page ———

  if (typeof document === "undefined") return;

  const QUIPS = {
    a: ["Goal! Top shelf.", "Goal! Through the five-hole.", "Goal! The goalie is still looking for it.", "Goal! Somebody tell the computer."],
    b: [
      "The computer scores. It will be unbearable now.",
      "Goal for the computer. It practised all night.",
      "The computer scores, and does a small dance.",
    ],
  };
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const NS = "http://www.w3.org/2000/svg";
  const el = (name, attrs, parent) => {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  // Stars that circle a player who has been knocked down.
  const STARS = `<g data-stars visibility="hidden">${[0, 120, 240]
    .map(
      (a) =>
        `<path transform="rotate(${a}) translate(0 -1.5)" d="M 0 -0.3 L 0.08 -0.08 L 0.3 0 L 0.08 0.08 L 0 0.3 L -0.08 0.08 L -0.3 0 L -0.08 -0.08 Z" fill="var(--rink-puck)"/>`
    )
    .join("")}</g>`;

  // `fx` carries what only the page knows: the time, a lit goal lamp, hats.
  function draw(svg, game, fx = {}) {
    if (!svg.querySelector("[data-players]")) {
      svg.insertAdjacentHTML("afterbegin", root.rinkSVG ? root.rinkSVG() : "");
      el("g", { "data-marks": "", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
      svg.insertAdjacentHTML(
        "beforeend",
        `<defs><radialGradient id="rink-lamp"><stop offset="0" stop-color="#ff3b30" stop-opacity="0.85"/><stop offset="1" stop-color="#ff3b30" stop-opacity="0"/></radialGradient></defs>`
      );
      for (const s of [1, -1])
        el("circle", { "data-lamp": s, cx: s * (GOAL_X + NET_DEPTH * 0.6), cy: 0, r: 3.4, fill: "url(#rink-lamp)", opacity: 0 }, svg);
      el("g", { "data-hats": "" }, svg);
      el(
        "polyline",
        { "data-trail": "", fill: "none", stroke: "var(--rink-shot)", "stroke-width": "0.35", "stroke-linecap": "round", opacity: ".45" },
        svg
      );
      el("circle", { "data-puck": "", r: "0.45", fill: "var(--rink-puck)", stroke: "var(--rink-puck-edge)", "stroke-width": "0.1" }, svg);
      el(
        "circle",
        {
          "data-you": "",
          r: "1.75",
          fill: "none",
          stroke: "var(--rink-team-a)",
          "stroke-width": "0.2",
          "stroke-dasharray": "0.7 0.45",
          opacity: ".8",
        },
        svg
      );
      const layer = el("g", { "data-players": "" }, svg);
      game.players.forEach((p, i) => {
        const g = el("g", { "data-player": i }, layer);
        g.insertAdjacentHTML("beforeend", root.helmetSVG(p.team, p.role === "goalie") + STARS);
      });
    }
    const pk = game.puck,
      now = fx.now || 0;
    const groups = svg.querySelectorAll("[data-player]");
    game.players.forEach((p, i) => {
      const g = groups[i];
      g.setAttribute("transform", `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
      // Everyone watches the puck, except whoever has it, who looks ahead; a
      // player knocked down lies turned, with crosses for eyes and stars.
      const down = p.down > 0;
      const [lx, ly] = pk.carrier === p ? [p.fx, p.fy] : [pk.x - p.x, pk.y - p.y];
      root.helmetLook(g, Math.atan2(p.fy, p.fx) + (down ? 1.2 : 0), lx, ly, down);
      const stars = g.querySelector("[data-stars]");
      stars.setAttribute("visibility", down ? "visible" : "hidden");
      if (down) stars.setAttribute("transform", `rotate(${((now / 4) % 360).toFixed(0)})`);
    });
    svg.querySelector("[data-puck]").setAttribute("transform", `translate(${pk.x.toFixed(2)} ${pk.y.toFixed(2)})`);
    svg.querySelector("[data-trail]").setAttribute("points", pk.trail.map((t) => t.map((v) => v.toFixed(2)).join(",")).join(" "));
    const you = svg.querySelector("[data-you]");
    you.style.display = game.human ? "" : "none";
    if (game.human) you.setAttribute("transform", `translate(${game.controlled.x.toFixed(2)} ${game.controlled.y.toFixed(2)})`);
    for (const lamp of svg.querySelectorAll("[data-lamp]")) {
      const on = fx.lamp && +lamp.dataset.lamp === fx.lamp.side && now < fx.lamp.until;
      lamp.setAttribute("opacity", on ? (0.55 + 0.35 * Math.sin(now / 80)).toFixed(2) : "0");
    }
    // Hats fall onto the ice, spinning, stay a while and fade.
    svg.querySelectorAll("[data-hat]").forEach((h) => {
      const age = (now - +h.dataset.t0) / 1000;
      if (age > 8) return h.remove();
      const k = clamp(age / 0.9, 0, 1),
        e = 1 - (1 - k) * (1 - k);
      const y = -19 + (+h.dataset.y + 19) * e;
      h.setAttribute("transform", `translate(${h.dataset.x} ${y.toFixed(2)}) rotate(${(+h.dataset.r + (1 - e) * 240).toFixed(0)})`);
      h.setAttribute("opacity", age > 7 ? (8 - age).toFixed(2) : "1");
    });
  }

  // Skate marks: twin tracks carved into the ice as players skate, and a fan of
  // snow where they stop hard, turn sharply or get knocked down. They build up
  // through a game (goalies scratch up their creases), the oldest going once
  // there are too many, and the ice is clean again for the next game.
  function skateMarks(svg) {
    const layer = svg.querySelector("[data-marks]");
    const LIMIT = 420; // elements kept: tracks come in pairs
    const seen = new Map();
    const add = (name, attrs) => {
      const e = el(name, attrs, layer);
      while (layer.childElementCount > LIMIT) layer.firstChild.remove();
      return e;
    };
    function spray(p, vx, vy) {
      const sp = hypot(vx, vy) || 1,
        a = Math.atan2(vy, vx);
      const d = [];
      for (let i = 0; i < 5; i++) {
        const b = a + (i - 2) * 0.32,
          r0 = 0.7 + Math.random() * 0.2,
          r1 = r0 + 0.45 + Math.random() * 0.5;
        const [ox, oy] = [p.x + (vx / sp) * 0.4, p.y + (vy / sp) * 0.4];
        d.push(
          `M ${(ox + Math.cos(b) * r0).toFixed(2)} ${(oy + Math.sin(b) * r0).toFixed(2)} L ${(ox + Math.cos(b) * r1).toFixed(2)} ${(oy + Math.sin(b) * r1).toFixed(2)}`
        );
      }
      add("path", { d: d.join(" "), stroke: "var(--rink-snow)", "stroke-width": "0.16" });
    }
    return {
      update(game, now) {
        for (const p of game.players) {
          let m = seen.get(p);
          if (!m) seen.set(p, (m = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, t: now, down: false, tracks: null, n: 0 }));
          // A jump (the faceoff after a goal) starts afresh, with no line across the ice.
          if (hypot(p.x - m.x, p.y - m.y) > 3) Object.assign(m, { x: p.x, y: p.y, tracks: null });
          const sp = hypot(p.vx, p.vy);
          if (now - m.t > 120) {
            const was = hypot(m.vx, m.vy);
            const turn = was > 4 && sp > 2 ? Math.acos(clamp((m.vx * p.vx + m.vy * p.vy) / (was * sp), -1, 1)) : 0;
            if ((was > 5 && was - sp > 3.2) || turn > 0.9) spray(p, m.vx, m.vy);
            if (p.down > 0 && !m.down) spray(p, p.vx || m.vx, p.vy || m.vy);
            Object.assign(m, { vx: p.vx, vy: p.vy, t: now, down: p.down > 0 });
          }
          if (sp < 1) {
            m.tracks = null;
            continue;
          }
          if (m.tracks && hypot(p.x - m.x, p.y - m.y) < 0.6) continue;
          // The two blades, either side of the line of travel.
          const nx = (-p.vy / sp) * 0.22,
            ny = (p.vx / sp) * 0.22;
          const at = (x, y, k) => `${(x + k * nx).toFixed(2)},${(y + k * ny).toFixed(2)}`;
          if (!m.tracks || m.n > 24) {
            const from = m.tracks ? [m.x, m.y] : [p.x, p.y];
            m.tracks = [-1, 1].map((k) => ({
              pts: [at(from[0], from[1], k)],
              e: add("polyline", { stroke: "var(--rink-mark)", "stroke-width": "0.09" }),
              k,
            }));
            m.n = 0;
          }
          for (const t of m.tracks) {
            t.pts.push(at(p.x, p.y, t.k));
            t.e.setAttribute("points", t.pts.join(" "));
          }
          Object.assign(m, { x: p.x, y: p.y });
          m.n++;
        }
      },
      clear() {
        layer.replaceChildren();
        seen.clear();
      },
    };
  }

  const HAT_COLOURS = ["var(--rink-team-a)", "var(--rink-team-b)", "#2b2f36", "#c9ced4", "#b3261e", "#3d7a4f"];
  function throwHats(svg, now) {
    const layer = svg.querySelector("[data-hats]");
    for (let i = 0; i < 18; i++) {
      const c = HAT_COLOURS[i % HAT_COLOURS.length];
      const x = (Math.random() * 52 - 26).toFixed(1),
        y = (Math.random() * 24 - 12).toFixed(1),
        r = Math.floor(Math.random() * 360);
      layer.insertAdjacentHTML(
        "beforeend",
        `<g data-hat data-x="${x}" data-y="${y}" data-r="${r}" data-t0="${Math.round(now + i * 70)}" transform="translate(0 -19)">
          <ellipse cx="0.55" rx="0.5" ry="0.36" fill="${c}"/><circle r="0.6" fill="${c}" stroke="var(--rink-helmet-edge)" stroke-width="0.06"/>
          <circle r="0.12" fill="#fff" opacity="0.6"/></g>`
      );
    }
  }

  // The home page's piece: the computer against itself, a few seconds in,
  // drawn once.
  function still(rootEl) {
    const game = new Game({ human: false });
    for (let t = 0; t < 7; t += STEP) game.step(STEP);
    draw(rootEl.querySelector("svg"), game);
  }

  function play(rootEl) {
    const svg = rootEl.querySelector("svg");
    const $ = (sel) => rootEl.querySelector(sel);
    const overlay = $("[data-overlay]"),
      title = $("[data-overlay-title]"),
      text = $("[data-overlay-text]"),
      button = $("[data-overlay-button]");
    const toast = $("[data-toast]"),
      live = $("[data-live]");
    let game = new Game();
    let state = "ready"; // ready, playing, paused, over
    // The running game, for tests and the console.
    rootEl.hockey = { game: () => game };
    draw(svg, game);
    const marks = skateMarks(svg);

    function show(t, body, label) {
      title.textContent = t;
      text.textContent = body;
      button.textContent = label;
      overlay.hidden = false;
    }
    let toastTimer = 0;
    function say(msg, seconds = 1.6) {
      toast.textContent = msg;
      toast.hidden = false;
      toastTimer = seconds;
      live.textContent = msg;
    }
    function hud() {
      $("[data-score-a]").textContent = game.score.a;
      $("[data-score-b]").textContent = game.score.b;
      const t = Math.ceil(game.clock);
      $("[data-clock]").textContent = game.overtime ? "overtime" : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
      $("[data-pause]").textContent = state === "paused" ? "resume" : "pause";
    }

    function start() {
      if (state === "over") {
        game = new Game();
        marks.clear();
      }
      if (state === "over" || state === "ready") draw(svg, game);
      state = "playing";
      overlay.hidden = true;
      last = null;
      svg.focus({ preventScroll: true });
    }
    function pause() {
      if (state !== "playing") return;
      state = "paused";
      show("Paused", "The computer is waiting. Patiently, for now.", "resume");
      hud();
    }
    // Buttons give focus back, so Space shoots instead of pressing them again.
    rootEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => b.blur()));
    button.addEventListener("click", start);
    $("[data-pause]").addEventListener("click", () => (state === "playing" ? pause() : state === "paused" ? start() : null));
    $("[data-restart]").addEventListener("click", () => {
      game = new Game();
      marks.clear();
      draw(svg, game);
      state = "playing";
      overlay.hidden = true;
      toast.hidden = true;
      last = null;
    });
    document.addEventListener("visibilitychange", () => document.hidden && pause());

    // Input: the keyboard, and on touch screens a stick and two buttons. The
    // first touch shows those, for touch screens the media query misses.
    window.addEventListener("pointerdown", (e) => e.pointerType === "touch" && rootEl.classList.add("is-touch"));
    const keys = new Set();
    const presses = { shoot: false, pass: false, check: false };
    const GAME_KEYS = [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "Space",
      "KeyX",
      "KeyK",
      "KeyJ",
      "KeyC",
      "KeyL",
    ];
    window.addEventListener("keydown", (e) => {
      if (e.target.closest && e.target.closest("input, textarea, select")) return;
      if (state === "playing" && GAME_KEYS.includes(e.code)) e.preventDefault();
      if (e.code === "KeyP" || e.code === "Escape") return state === "playing" ? pause() : state === "paused" ? start() : null;
      if ((state === "ready" || state === "over" || state === "paused") && (e.code === "Enter" || e.code === "Space")) {
        e.preventDefault();
        return start();
      }
      if (e.repeat) return;
      keys.add(e.code);
      if (e.code === "Space" || e.code === "KeyJ") presses.shoot = true;
      if (e.code === "KeyX" || e.code === "KeyK") presses.pass = true;
      if (e.code === "KeyC" || e.code === "KeyL") presses.check = true;
    });
    window.addEventListener("keyup", (e) => keys.delete(e.code));
    window.addEventListener("blur", () => keys.clear());

    const stickPad = $("[data-stick]"),
      knob = $("[data-knob]");
    const touch = { x: 0, y: 0, id: null };
    const aim = (e) => {
      const box = stickPad.getBoundingClientRect();
      const r = box.width / 2;
      let x = (e.clientX - box.left - r) / r,
        y = (e.clientY - box.top - r) / r;
      const l = hypot(x, y);
      if (l > 1) [x, y] = [x / l, y / l];
      touch.x = x;
      touch.y = y;
      knob.style.transform = `translate(${(x * 75).toFixed(1)}%, ${(y * 75).toFixed(1)}%)`;
    };
    stickPad.addEventListener("pointerdown", (e) => {
      touch.id = e.pointerId;
      try {
        stickPad.setPointerCapture(e.pointerId);
      } catch (err) {
        // Not a live pointer (a synthetic event): the stick still works.
      }
      aim(e);
    });
    stickPad.addEventListener("pointermove", (e) => e.pointerId === touch.id && aim(e));
    const letGo = (e) => {
      if (e.pointerId !== touch.id) return;
      touch.id = null;
      touch.x = touch.y = 0;
      knob.style.transform = "";
    };
    stickPad.addEventListener("pointerup", letGo);
    stickPad.addEventListener("pointercancel", letGo);
    for (const name of ["shoot", "pass", "check"]) {
      $(`[data-${name}]`).addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (state === "playing") presses[name] = true;
        else start();
      });
    }

    function input() {
      let x = touch.x,
        y = touch.y;
      if (keys.has("ArrowLeft") || keys.has("KeyA")) x -= 1;
      if (keys.has("ArrowRight") || keys.has("KeyD")) x += 1;
      if (keys.has("ArrowUp") || keys.has("KeyW")) y -= 1;
      if (keys.has("ArrowDown") || keys.has("KeyS")) y += 1;
      const l = hypot(x, y);
      if (l > 1) [x, y] = [x / l, y / l];
      const out = { x, y, shoot: presses.shoot, pass: presses.pass, check: presses.check };
      presses.shoot = presses.pass = presses.check = false;
      return out;
    }

    let last = null,
      spare = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = last === null ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      if (toastTimer > 0 && (toastTimer -= dt) <= 0) toast.hidden = true;
      if (state !== "playing") return;
      spare += dt;
      // Presses count once, in the first step of the frame.
      const held = input();
      let first = true;
      while (spare >= STEP) {
        game.step(STEP, first ? held : { x: held.x, y: held.y });
        first = false;
        spare -= STEP;
      }
      const you = game.players.indexOf(game.controlled);
      for (const ev of game.events.splice(0)) {
        if (ev.type === "goal") {
          lamp = { side: ev.team === "a" ? 1 : -1, until: now + 2400 };
          let msg = pick(QUIPS[ev.team]);
          if (ev.hatTrick && ev.team === "a") {
            msg = "Hat trick! Hats on the ice.";
            throwHats(svg, now);
          } else if (ev.hatTrick) msg = "Hat trick for the computer. Nobody throws a hat.";
          else if (ev.own) msg = ev.team === "a" ? "Goal! Off a computer skate." : "Own goal. It happens.";
          else if (ev.oneTimer && ev.team === "a") msg = "One-timer goal!";
          say(ev.overtime ? (ev.team === "a" ? "Overtime winner! " : "Overtime goal. ") + msg : msg, 2.3);
        } else if (ev.type === "hit") {
          if (ev.by === you) say(ev.boards ? "Into the boards!" : "Checked!", 1);
          else if (ev.on === you) say(ev.boards ? "Into the boards. Ouch." : "Ouch.", 1);
        } else if (ev.type === "shot" && ev.oneTimer && ev.you) say("One-timer!", 0.8);
        else if (ev.type === "post") say("Off the post!", 1);
        else if (ev.type === "overtime") say("Tied. Next goal wins.", 2.5);
        else if (ev.type === "final") {
          state = "over";
          const { a, b } = ev.score;
          const verdict = a > b ? "You win. The computer would like a rematch." : "The computer wins. It says good game, and means it.";
          show(`You ${a}, computer ${b}`, verdict, "play again");
        }
      }
      marks.update(game, now);
      draw(svg, game, { now, lamp });
      hud();
    }
    let lamp = null;
    hud();
    show("Three on three", "You are blue and attack the goal on the right. Most goals in three minutes wins.", "play");
    requestAnimationFrame(frame);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-game]").forEach((e) => (e.dataset.game === "still" ? still(e) : play(e)));
  });
})(typeof window !== "undefined" ? window : globalThis);
