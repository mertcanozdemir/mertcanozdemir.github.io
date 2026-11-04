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
  // The rules' lines and spots, as drills.js draws the rink: the blue lines,
  // the faceoff spots in the neutral zone and in the ends, and a minor
  // penalty's length here, with periods of a minute (two minutes of twenty
  // would be six seconds; ten make a power play worth having).
  const BLUE = 7.5,
    SPOT = { neutral: 5, end: 20, side: 7 },
    MINOR = 10;
  // A fight: how likely after a dirty hit (or a hard one into the boards),
  // each fighter's balance, a punch's wind-up (what the other can see
  // coming), a duck, what a punch and a jersey pulled take off, how long
  // before the linesmen step in, and a major for fighting, 15 s here (five
  // minutes of twenty, as in the NHL; the IIHF throws both out of the game).
  const FIGHT = { foul: 0.5, boards: 0.15, balance: 100, windup: 0.32, duck: 0.45, punch: [12, 19], pull: 7, long: 10, major: 15 };
  // A body check: the burst's speed (m/s) and length (s), how long whoever it
  // knocks down stays down, and the closing speed it takes to knock them down.
  const CHECK = { speed: 10.5, time: 0.3, down: 1.2, hard: 3.5 };
  // Skating, in m/s²: speeding up and turning, coasting to a stop once the
  // keys are let go (a little over a second from full speed), and a hockey
  // stop: skating the other way brakes hard. Top speed is in maxSpeed():
  // 8.6 m/s, near a real player's 9 to 11 (it was 7.6, which Mertcan found
  // slow).
  const SKATE = { push: 15, coast: 7.5, brake: 20 };
  // Whether a skater wants to go roughly the other way from where it is going.
  const reversing = (p) => {
    const sp = hypot(p.vx, p.vy),
      w = hypot(p.wx, p.wy);
    return sp > 3 && w > 0.5 && p.vx * p.wx + p.vy * p.wy < -0.4 * sp * w;
  };
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

  // How much the computer's team is ahead of the person's at each level, and
  // how soon after the puck lands at a faceoff its centre's stick comes down (s).
  const LEVELS = { easy: -0.5, normal: 1, hard: 1.6 };
  const REACTION = { easy: [0.2, 0.45], normal: [0.09, 0.26], hard: [0.04, 0.15] };

  class Game {
    constructor(opts = {}) {
      this.random = opts.random || Math.random;
      this.human = opts.human !== false; // a person plays team a's controlled skater
      // Three periods of a minute, with an intermission between them (the page
      // resurfaces the ice there; nextPeriod() carries on).
      this.periods = opts.periods || 3;
      this.periodLength = opts.periodLength || 60;
      this.level = opts.level || "normal"; // easy, normal or hard: see sharp()
      this.size = opts.size === 5 ? 5 : 3; // skaters a side: three on three, or five on five
      this.reset();
    }

    reset() {
      this.score = { a: 0, b: 0 };
      this.shots = { a: 0, b: 0 };
      this.offside = this.icing = this.delayed = this.fight = null;
      this.boxBound = [];
      this.period = 1;
      this.clock = this.periodLength;
      this.overtime = false;
      this.events = [];
      this.players = [];
      for (const team of ["a", "b"]) {
        for (let slot = 0; slot < this.size; slot++) this.players.push(this.player(team, "skater", slot));
        this.players.push(this.player(team, "goalie", this.size));
      }
      this.puck = { x: 0, y: 0, h: 0, vx: 0, vy: 0, carrier: null, last: null, held: 0, beat: null, rebound: 0, from: null, trail: [] };
      // The referee: only drawn, never in the way.
      this.ref = { x: 0, y: -0.9, vx: 0, vy: 0, fx: 0, fy: 1, arm: 0 };
      this.draws = 0;
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
        box: 0, // seconds left in the penalty box
        lostAt: -9, // when it last gave up the puck
      };
    }

    goalieOf(team) {
      return this.players.find((p) => p.team === team && p.role === "goalie");
    }

    // The team's skaters on the ice: not those in the penalty box.
    skaters(team) {
      return this.players.filter((p) => p.team === team && p.role === "skater" && !(p.box > 0));
    }
    // More of its players in the box than the other team's: on the penalty kill.
    shorthanded(team) {
      const n = (t) => this.players.filter((p) => p.team === t && p.box > 0).length;
      return n(team) > n(other(team));
    }

    stick(p) {
      return { x: p.x + p.fx * REACH, y: p.y + p.fy * REACH };
    }

    // Where each lines up for a faceoff at the spot `at`: the centre at the
    // dot, then a wing and a defender; five a side add the other wing and the
    // other defender (`spot`, its place in the line-up: someone in the box
    // leaves it to the next). Never behind a goal line; goalies in their nets.
    spotOf(p, at = [0, 0]) {
      const s = DIR[p.team];
      if (p.role === "goalie") return [-s * (GOAL_X - 1), 0];
      const [dx, dy] = [
        [-1.6, 0],
        [-6, -6],
        [-12, 4],
        [-6, 6],
        [-12, -4],
      ][p.spot ?? p.slot];
      const o = { x: clamp(at[0] + s * dx, -GOAL_X + 2.5, GOAL_X - 2.5), y: at[1] + s * dy };
      confine(o, SKATER_R + 0.3);
      outOfNet(o, SKATER_R);
      return [o.x, o.y];
    }
    lineUp() {
      for (const team of ["a", "b"])
        this.skaters(team)
          .sort((p, q) => p.slot - q.slot)
          .forEach((p, i) => (p.spot = i));
    }

    faceoff(at = [0, 0]) {
      this.lineUp();
      for (const p of this.players) {
        if (p.box > 0) continue;
        const s = DIR[p.team];
        [p.x, p.y] = this.spotOf(p, at);
        Object.assign(p, { vx: 0, vy: 0, fx: s, fy: 0, wx: 0, wy: 0, noTouch: 0, cool: 0, down: 0, dash: 0, checkCool: 0, oneTimer: 0, off: false });
      }
      // The referee holds the puck over the dot, between the centres, and
      // drops it at a moment of its own: see dropPuck().
      Object.assign(this.puck, { x: at[0], y: at[1], h: 1.3, vx: 0, vy: 0, carrier: null, last: null, held: 0, beat: null, rebound: 0, trail: [] });
      Object.assign(this.ref, { x: at[0], y: at[1] - 0.9, vx: 0, vy: 0, fx: 0, fy: 1, arm: 1, signal: false });
      this.offside = this.icing = null;
      const release = 0.7 + this.random() * 0.9,
        [lo, hi] = REACTION[this.level] || REACTION.normal;
      this.drop = { t: 0, release, land: release + 0.32, you: null, cpu: lo + this.random() * (hi - lo), winner: null, why: "", gone: false, at };
      if (this.human) this.controlled = this.skaters("a").find((p) => p.spot === 0) || this.controlled;
      this.phase = "faceoff";
      this.events.push({ type: "faceoff", n: ++this.draws });
    }

    // One simulation step. `input` is the person's: {x, y} to skate, and
    // `shoot` and `pass` for presses since the last step.
    step(dt, input = {}) {
      if (this.phase === "over") return;
      if (this.phase === "intermission") return this.leave(dt);
      if (this.phase === "return") return this.comeOn(dt);
      if (this.phase === "fight") return this.fightStep(dt, input);
      if (this.phase === "faceoff") return this.dropPuck(dt, input);
      if (this.phase !== "play") {
        this.wait -= dt;
        if (this.phase === "goal" || this.phase === "stop") {
          this.glide(dt);
          this.moveRef(dt);
          if (this.boxBound.length) this.toTheBox(dt);
        }
        if (this.wait > 0) return;
        if (this.phase === "goal") return this.decided ? this.finish() : this.faceoff();
        if (this.phase === "stop") {
          for (const [p, len] of this.boxBound) this.toBox(p, len);
          this.boxBound = [];
          return this.faceoff(this.stopAt);
        }
        this.phase = "play";
        this.dropped = this.t || 0;
        return;
      }
      if (!this.overtime) {
        this.clock -= dt;
        if (this.clock <= 0) {
          this.clock = 0;
          // A penalty still to call is served all the same.
          if (this.delayed) {
            this.toBox(this.delayed.p);
            this.delayed = null;
          }
          this.offside = this.icing = null;
          if (this.period < this.periods) {
            this.phase = "intermission";
            this.wait = 0;
            this.puck.carrier = null;
            for (const p of this.players) Object.assign(p, { down: 0, dash: 0, braking: false });
            this.events.push({ type: "intermission", period: this.period });
            return;
          }
          if (this.score.a !== this.score.b) return this.finish();
          this.overtime = true;
          this.events.push({ type: "overtime" });
        }
      }
      const pk = this.puck;
      pk.rebound = Math.max(0, pk.rebound - dt);
      for (const team of ["a", "b"]) this.plan(team);
      this.t = (this.t || 0) + dt;
      // The person's skater as the step begins: a switch hands over the next
      // step, so the press that made it is not taken twice.
      const you = this.human ? this.controlled : null;
      for (const p of this.players) {
        if (p.box > 0) {
          // In the penalty box, the clock running only in play.
          if ((p.box -= dt) <= 0) this.outOfBox(p);
          continue;
        }
        p.cool = Math.max(0, p.cool - dt);
        p.noTouch = Math.max(0, p.noTouch - dt);
        p.checkCool = Math.max(0, p.checkCool - dt);
        p.oneTimer = Math.max(0, p.oneTimer - dt);
        p.dash = Math.max(0, p.dash - dt);
        if (p.down > 0) {
          // Knocked down: slides to a stop, then gets up. The person can
          // switch to someone still standing.
          p.down = Math.max(0, p.down - dt);
          p.wx = p.wy = 0;
          if (p === you && input.pass) this.switchPlayer();
          continue;
        }
        if (p.role === "goalie") this.keepGoal(p, dt);
        else if (p === you) this.obey(p, input);
        else this.think(p, dt);
      }
      const px = this.puck.x;
      this.move(dt);
      this.movePuck(dt);
      this.moveRef(dt);
      this.rules(px);
    }

    // The lines. Offside: an attacker ahead of the puck into the zone. Carried
    // in, the whistle goes at once; sent in, the linesman waits (a delayed
    // offside), and it is waved off once they are all back out of the zone
    // (tagging up), or called if one of them plays the puck first. Icing: the
    // puck sent from behind the centre line over the far goal line, past the
    // net and untouched; not against a team a skater short. And a delayed
    // penalty, called once the team that took it has the puck.
    rules(px) {
      if (this.phase !== "play") return;
      const pk = this.puck,
        side = Math.sign(pk.y) || 1;
      for (const team of ["a", "b"]) {
        const s = DIR[team],
          by = pk.carrier || pk.last;
        if (!(s * px <= BLUE && s * pk.x > BLUE) || !by || by.team !== team) continue;
        const ahead = this.skaters(team).filter((p) => p !== pk.carrier && s * p.x > BLUE + 0.4);
        if (!ahead.length) continue;
        if (pk.carrier) return this.whistle("offside", team, [s * SPOT.neutral, side * SPOT.side], ahead[0]);
        this.offside = { team, by: ahead[0] };
        this.events.push({ type: "delayed", why: "offside", team, by: this.players.indexOf(ahead[0]) });
      }
      const o = this.offside;
      if (o) {
        const s = DIR[o.team];
        if (s * pk.x < BLUE || !this.skaters(o.team).some((p) => s * p.x > BLUE)) {
          this.offside = null;
          this.events.push({ type: "onside", team: o.team });
        } else if (pk.carrier && pk.carrier.team === o.team) return this.whistle("offside", o.team, [s * SPOT.neutral, side * SPOT.side], o.by);
      }
      const ic = this.icing;
      if (ic && (pk.carrier || pk.last !== ic.by)) this.icing = null;
      else if (ic && DIR[ic.team] * pk.x > GOAL_X && Math.abs(pk.y) > NET_HALF) {
        return this.whistle("icing", ic.team, [-DIR[ic.team] * SPOT.end, (Math.sign(ic.y) || side) * SPOT.side], ic.by);
      }
      const d = this.delayed;
      if (d && pk.carrier && pk.carrier.team === d.p.team) this.callPenalty();
      this.ref.signal = !!(this.offside || this.delayed);
    }

    // The whistle: play stops; everyone coasts, then the faceoff at `at`.
    whistle(why, team, at, by, foul) {
      // Any whistle calls a penalty waiting to be called.
      if (this.delayed && why !== "penalty") return this.callPenalty();
      this.phase = "stop";
      // Long enough to see what was called (the page shows it), and for a
      // penalty to skate to the box.
      this.wait = why === "penalty" ? 5 : why === "fight" ? 5 : 2.8;
      this.stopAt = at;
      this.offside = this.icing = null;
      this.ref.signal = false;
      const pk = this.puck;
      if (pk.carrier) [pk.vx, pk.vy] = [pk.carrier.vx, pk.carrier.vy];
      pk.carrier = null;
      this.events.push({ type: "whistle", why, team, by: by ? this.players.indexOf(by) : -1, foul });
    }

    // A penalty, called: whoever took it sits in the box for a minor, the team
    // a skater short, and the faceoff is in its own end.
    callPenalty() {
      const { p, why, on } = this.delayed;
      this.delayed = null;
      this.whistle("penalty", p.team, [-DIR[p.team] * SPOT.end, (Math.sign(this.puck.y) || 1) * SPOT.side], p, why);
      this.events[this.events.length - 1].on = this.players.indexOf(on);
      // Off to the box, skating: in it by the faceoff at the latest.
      this.boxBound.push([p, MINOR]);
      p.down = 0;
    }
    // The one going to the box skates to its door, across the ice.
    toTheBox(dt) {
      for (const [p, len] of this.boxBound.slice()) this.skateToBox(p, len, dt);
    }
    skateToBox(p, len, dt) {
      if (p.down > 0) return (p.down = Math.max(0, p.down - dt));
      const dx = -DIR[p.team] * 5.4 - p.x,
        dy = -W + SKATER_R + 0.4 - p.y,
        d = hypot(dx, dy);
      if (d < 0.8) {
        this.boxBound = this.boxBound.filter(([q]) => q !== p);
        return this.toBox(p, len);
      }
      const want = Math.min(6, d * 2),
        ax = (dx / d) * want - p.vx,
        ay = (dy / d) * want - p.vy,
        al = hypot(ax, ay) || 1,
        acc = Math.min(al, 12 * dt);
      p.vx += (ax / al) * acc;
      p.vy += (ay / al) * acc;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const sp = hypot(p.vx, p.vy);
      if (sp > 0.5) [p.fx, p.fy] = [p.vx / sp, p.vy / sp];
      confine(p, SKATER_R);
    }
    // The gloves come off: one of the team knocked down stands up for them
    // (or whoever was hit, once up) against the one who hit. Play stops; a
    // penalty waiting goes with the fight.
    startFight(hitter, mate) {
      this.delayed = this.offside = this.icing = null;
      const [a, b] = hitter.team === "a" ? [hitter, mate] : [mate, hitter],
        at = { x: clamp((a.x + b.x) / 2, -L + 4, L - 4), y: clamp((a.y + b.y) / 2, -W + 2.5, W - 2.5) };
      outOfNet(at, 2.5);
      const pk = this.puck;
      if (pk.carrier) [pk.vx, pk.vy, pk.carrier] = [pk.carrier.vx, pk.carrier.vy, null];
      this.phase = "fight";
      this.fight = { a, b, t: 0, at: [at.x, at.y], bal: { a: FIGHT.balance, b: FIGHT.balance }, act: { a: {}, b: {} }, winner: null, end: 0 };
      for (const f of [a, b]) Object.assign(f, { down: 0, dash: 0, wx: 0, wy: 0 });
      if (this.human) this.controlled = a;
      this.events.push({ type: "fight", a: this.players.indexOf(a), b: this.players.indexOf(b) });
    }
    // Each fighter holds the other's jersey with one hand and punches with
    // the other. A punch is wound up first (FIGHT.windup: what the other sees
    // coming), and misses if they duck in time; a pull takes balance and can
    // put the jersey over their head (they cannot punch for a moment). Out of
    // balance, down; or the linesmen step in after FIGHT.long.
    fightStep(dt, input) {
      const F = this.fight,
        pk = this.puck,
        f = Math.max(0, 1 - 1.2 * dt);
      F.t += dt;
      pk.vx *= f;
      pk.vy *= f;
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      confine(pk, PUCK_R);
      this.glide(dt);
      // The others give them room: back to a ring round the fight.
      for (const p of this.players) {
        if (p === F.a || p === F.b || p.box > 0 || p.role === "goalie" || this.boxBound.some(([q]) => q === p)) continue;
        const dx = p.x - F.at[0],
          dy = p.y - F.at[1],
          d = hypot(dx, dy) || 1;
        if (d < 5.5) {
          p.x += (dx / d) * Math.min(2.2 * dt, 5.5 - d);
          p.y += (dy / d) * Math.min(2.2 * dt, 5.5 - d);
          confine(p, SKATER_R);
        }
      }
      this.moveRef(dt, F.at[0], clamp(F.at[1] - 3.5, -W + 1.6, W - 1.6));
      for (const [k, p, side] of [
        ["a", F.a, -1],
        ["b", F.b, 1],
      ]) {
        const tx = F.at[0] + side * 0.78,
          ty = F.at[1],
          e = Math.min(1, 6 * dt);
        if (!(p.down > 0)) {
          p.x += (tx - p.x) * e;
          p.y += (ty - p.y) * e;
          [p.fx, p.fy] = [-side, 0];
        } else p.down = Math.max(0.5, p.down - dt);
        p.vx = p.vy = 0;
        const act = F.act[k];
        for (const n of ["wind", "punch", "duck", "pull", "blind", "cool", "duckCool"]) act[n] = Math.max(0, (act[n] || 0) - dt);
      }
      if (F.end) {
        if ((F.end -= dt) <= 0) this.endFight();
        return;
      }
      // What each does: the person's fighter from the keys, the computer's by itself.
      for (const k of ["a", "b"]) {
        const me = F.act[k],
          them = F.act[k === "a" ? "b" : "a"],
          person = this.human && k === "a",
          s = this.sharp(k);
        let punch = false,
          pull = false,
          duck = false;
        if (person) [punch, pull, duck] = [!!input.shoot, !!input.pass, !!input.duck];
        else {
          // Sees a punch coming about a third of the time (more on hard).
          duck = them.wind > 0 && them.wind < FIGHT.windup * 0.8 && this.random() < Math.max(0.3, 0.7 + 0.6 * s) * dt;
          punch = this.random() < (0.9 + 0.3 * s) * dt;
          pull = this.random() < 0.18 * dt;
        }
        if (duck && !me.duckCool && !me.wind) [me.duck, me.duckCool] = [FIGHT.duck, FIGHT.duck + 0.45];
        if (me.cool || me.wind || me.duck || me.blind) continue;
        if (punch) [me.wind, me.cool] = [FIGHT.windup * (1 - 0.15 * Math.max(0, s)), 0.75];
        else if (pull) {
          me.pull = 0.3;
          me.cool = 0.9;
          F.bal[k === "a" ? "b" : "a"] -= FIGHT.pull;
          if (!them.duck && this.random() < 0.4) them.blind = 1.1;
          this.events.push({ type: "pull", team: k, blind: them.blind > 0 });
        }
      }
      // Punches that were wound up land now, unless the other ducked.
      for (const k of ["a", "b"]) {
        const me = F.act[k],
          o = k === "a" ? "b" : "a";
        if (!me.landing && me.wind > 0) me.landing = true;
        if (me.landing && me.wind <= 0) {
          me.landing = false;
          me.punch = 0.2;
          const landed = !F.act[o].duck;
          if (landed) F.bal[o] -= FIGHT.punch[0] + this.random() * (FIGHT.punch[1] - FIGHT.punch[0]) * (F.act[o].blind ? 1.3 : 1);
          else me.cool += 0.3;
          this.events.push({ type: "punch", team: k, landed });
        }
      }
      const down = F.bal.a <= 0 ? F.a : F.bal.b <= 0 ? F.b : null;
      if (down || F.t > FIGHT.long) {
        F.winner = down ? (down === F.a ? F.b : F.a) : Math.abs(F.bal.a - F.bal.b) < 8 ? null : F.bal.a > F.bal.b ? F.a : F.b;
        if (down) down.down = CHECK.down;
        F.end = 1.4;
        this.events.push({ type: "fight-end", winner: F.winner ? this.players.indexOf(F.winner) : -1, down: !!down });
      }
    }
    // The linesmen part them: both to the box for fighting, and the faceoff
    // at the spot nearest the fight.
    endFight() {
      const F = this.fight,
        dots = [[0, 0]];
      for (const x of [-SPOT.end, -SPOT.neutral, SPOT.neutral, SPOT.end]) for (const y of [-SPOT.side, SPOT.side]) dots.push([x, y]);
      const at = dots.sort((p, q) => hypot(p[0] - F.at[0], p[1] - F.at[1]) - hypot(q[0] - F.at[0], q[1] - F.at[1]))[0];
      this.fight = null;
      this.whistle("fight", null, at, F.a);
      this.events[this.events.length - 1].b = this.players.indexOf(F.b);
      this.events[this.events.length - 1].winner = F.winner ? this.players.indexOf(F.winner) : -1;
      for (const p of [F.a, F.b]) this.boxBound.push([p, FIGHT.major]);
    }

    // The page's "go on": the faceoff now.
    skipStop() {
      if (this.phase === "stop") this.wait = 0;
    }
    // At a stoppage the person can drop the gloves with an opponent close by.
    challenge() {
      const me = this.controlled;
      if (this.phase !== "stop" || !me || me.box > 0 || this.boxBound.some(([q]) => q === me)) return false;
      const them = this.skaters("b")
        .filter((o) => !this.boxBound.some(([q]) => q === o))
        .sort((p, q) => dist(p, me) - dist(q, me))[0];
      if (!them || dist(them, me) > 4) return false;
      this.wait = 0;
      this.startFight(me, them);
      return true;
    }
    // The penalty boxes are across the ice from the benches, either side of
    // the timekeeper: team a's on the left, b's on the right.
    toBox(p, len = MINOR) {
      const k = this.players.filter((q) => q.team === p.team && q.box > 0).length;
      Object.assign(p, { box: len, off: true, vx: 0, vy: 0, wx: 0, wy: 0, down: 0, dash: 0, fx: 0, fy: 1 });
      [p.x, p.y] = [-DIR[p.team] * (5.4 + k * 1.3), -W - 0.85];
      if (this.human && p === this.controlled) {
        const pk = this.puck,
          next = this.skaters("a").sort((a, b) => dist(a, pk) - dist(b, pk))[0];
        if (next) this.controlled = next;
      }
    }
    // Out of the box, by its door onto the ice.
    outOfBox(p) {
      Object.assign(p, { box: 0, off: false, vx: 0, vy: 2, fx: 0, fy: 1 });
      p.y = -W + SKATER_R + 0.6;
      this.events.push({ type: "back", team: p.team, by: this.players.indexOf(p) });
    }
    // Who sent the puck on its way, for icing: from its own half.
    sent(p) {
      const pk = this.puck;
      this.icing = p.role === "skater" && DIR[p.team] * pk.x < 0 && !this.shorthanded(p.team) ? { team: p.team, y: pk.y, by: p } : null;
    }

    // The end of a period: everyone skates off to the bench (on the near side,
    // each team's in its own half), and the puck slides to a stop. Once all
    // are off, or after a few seconds, `benched`.
    leave(dt) {
      this.wait += dt;
      this.moveRef(dt, 0, -(W - 1.4));
      for (const p of this.players) {
        if (p.off) continue;
        const tx = -DIR[p.team] * (3.4 + p.slot * 2.3),
          ty = W - SKATER_R - 0.4;
        const dx = tx - p.x,
          dy = ty - p.y,
          d = hypot(dx, dy);
        if (d < 0.7 || this.wait > 6) {
          p.off = true;
          continue;
        }
        const want = Math.min(6.5, d * 2),
          ax = (dx / d) * want - p.vx,
          ay = (dy / d) * want - p.vy,
          al = hypot(ax, ay) || 1,
          acc = Math.min(al, 10 * dt);
        p.vx += (ax / al) * acc;
        p.vy += (ay / al) * acc;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const sp = hypot(p.vx, p.vy);
        if (sp > 0.5) [p.fx, p.fy] = [p.vx / sp, p.vy / sp];
        const r = p.role === "goalie" ? GOALIE_R : SKATER_R;
        confine(p, r);
        outOfNet(p, r);
      }
      const pk = this.puck,
        f = Math.max(0, 1 - 1.2 * dt);
      pk.vx *= f;
      pk.vy *= f;
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      const n = confine(pk, PUCK_R) || (offFrame(pk, PUCK_R) || {}).n;
      if (n) {
        const vn = pk.vx * n[0] + pk.vy * n[1];
        if (vn < 0) [pk.vx, pk.vy] = [pk.vx - 1.6 * vn * n[0], pk.vy - 1.6 * vn * n[1]];
      }
      if (!this.benched && this.players.every((p) => p.off)) {
        this.benched = true;
        this.events.push({ type: "benched" });
      }
    }

    // A faceoff: the referee lets the puck go, and the quicker stick wins the
    // draw. For the person that is pressing pass (or shoot) once the puck has
    // left the referee's hand, which the page shows coming with a ring closing
    // on the dot: before that is early, and loses (the rule). The computer's
    // centre reacts in REACTION seconds for the level. Two computer teams
    // toss for it. The draw happens once the puck is down.
    dropPuck(dt, input) {
      const f = this.drop,
        pk = this.puck;
      f.t += dt;
      const fall = clamp((f.t - f.release) / (f.land - f.release), 0, 1),
        since = f.t - f.release;
      pk.h = 1.3 * (1 - fall * fall);
      this.ref.arm = since < 0 ? 1 : Math.max(0, 1 - since * 3);
      if (this.human && (input.pass || input.shoot) && f.you === null) f.you = since;
      if (since >= 0 && !f.gone) {
        f.gone = true;
        this.events.push({ type: "release" });
      }
      if (!f.winner) {
        if (!this.human) {
          if (since >= 0) f.winner = this.random() < 0.5 ? "a" : "b";
        } else if (f.you !== null && f.you < -0.05) [f.winner, f.why] = ["b", "early"];
        else if (f.you !== null && f.you <= f.cpu) f.winner = "a";
        else if (since >= f.cpu) [f.winner, f.why] = ["b", "slow"];
      }
      if (f.winner && f.t >= f.land) this.wonDraw(f.winner, f.why);
    }
    // The winner's centre draws it back to a teammate.
    wonDraw(team, why = "") {
      const pk = this.puck,
        mine = (spot) => this.skaters(team).find((p) => p.spot === spot),
        centre = mine(0),
        back = mine(1) || this.goalieOf(team),
        loser = this.skaters(other(team)).find((p) => p.spot === 0);
      const dx = back.x - pk.x,
        dy = back.y - pk.y,
        d = hypot(dx, dy) || 1;
      Object.assign(pk, { h: 0, carrier: null, last: centre, vx: (dx / d) * 9, vy: (dy / d) * 9 });
      centre.noTouch = 0.5;
      if (loser) loser.noTouch = 0.45;
      this.events.push({ type: "draw", team, why });
      this.phase = "play";
      this.dropped = this.t || 0;
    }

    // The referee keeps out of the way: along the far boards, level with the
    // play, and off to the side between periods.
    moveRef(dt, tx = clamp(this.puck.x * 0.7, -18, 18), ty = -(W - 1.6)) {
      const r = this.ref,
        dx = tx - r.x,
        dy = ty - r.y,
        d = hypot(dx, dy);
      const want = Math.min(5, d * 1.5),
        ax = (d ? (dx / d) * want : 0) - r.vx,
        ay = (d ? (dy / d) * want : 0) - r.vy,
        al = hypot(ax, ay) || 1,
        acc = Math.min(al, 7 * dt);
      r.vx += (ax / al) * acc;
      r.vy += (ay / al) * acc;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      const sp = hypot(r.vx, r.vy);
      if (sp > 0.6) [r.fx, r.fy] = [r.vx / sp, r.vy / sp];
      r.arm = 0;
      confine(r, SKATER_R);
    }

    nextPeriod() {
      if (this.phase !== "intermission") return;
      this.benched = false;
      this.period++;
      this.clock = this.periodLength;
      this.comeBack();
    }

    // After the intermission the teams come back out through their bench
    // doors onto the fresh ice, a few at a time, and skate to their places
    // for the faceoff; the goalies go to their nets and scrape the crease
    // (goalies do, to take the shine off the new ice), and the referee brings
    // the puck to the dot. The faceoff once all are there, or after a while.
    comeBack() {
      this.phase = "return";
      this.wait = 0;
      this.lineUp();
      this.players.forEach((p) => {
        // Out of the door in turn, a goalie first, as teams come out.
        p.cue = 0.5 + (p.role === "goalie" ? 0 : 0.35 + p.slot * 0.3) + (p.team === "b" ? 0.15 : 0);
        p.scrape = 0;
        Object.assign(p, { vx: 0, vy: 0, down: 0, dash: 0, braking: false });
      });
      Object.assign(this.puck, { carrier: null, vx: 0, vy: 0, h: 1.3, trail: [] });
      this.events.push({ type: "return", period: this.period });
    }
    comeOn(dt) {
      this.wait += dt;
      this.moveRef(dt, 0, -0.9);
      Object.assign(this.puck, { x: this.ref.x, y: this.ref.y + 0.9 });
      let ready = true;
      for (const p of this.players) {
        if (p.box > 0) continue;
        if (this.wait < p.cue) {
          ready = false;
          continue;
        }
        p.off = false;
        const [hx, hy] = this.spotOf(p),
          s = DIR[p.team];
        let [tx, ty] = [hx, hy];
        // The scrape: side to side across the crease, three times.
        if (p.role === "goalie" && p.scrape < 1.8) {
          if (hypot(hx - p.x, hy - p.y) < 1.2 || p.scrape > 0) p.scrape += dt;
          if (p.scrape > 0) ty = Math.sin(p.scrape * 5.2) > 0 ? 1.1 : -1.1;
          ready = false;
        }
        const dx = tx - p.x,
          dy = ty - p.y,
          d = hypot(dx, dy);
        if (d > 0.3) ready = false;
        const want = Math.min(p.role === "goalie" && p.scrape > 0 ? 3.5 : 6.5, d * 2),
          ax = (d ? (dx / d) * want : 0) - p.vx,
          ay = (d ? (dy / d) * want : 0) - p.vy,
          al = hypot(ax, ay) || 1,
          acc = Math.min(al, 12 * dt);
        p.vx += (ax / al) * acc;
        p.vy += (ay / al) * acc;
        p.braking = d < 1.5 && hypot(p.vx, p.vy) > 2.5;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const sp = hypot(p.vx, p.vy);
        // Facing the way they skate; once there, the play.
        if (sp > 1.2 && d > 1) [p.fx, p.fy] = [p.vx / sp, p.vy / sp];
        else [p.fx, p.fy] = [s, 0];
        const r = p.role === "goalie" ? GOALIE_R : SKATER_R;
        confine(p, r);
        outOfNet(p, r);
      }
      if ((ready && this.wait > 2) || this.wait > 9) this.faceoff();
    }

    finish() {
      this.phase = "over";
      this.events.push({ type: "final", score: { ...this.score } });
    }

    // After a goal everyone coasts to a stop.
    glide(dt) {
      for (const p of this.players) {
        if (p.box > 0 || this.boxBound.some(([q]) => q === p) || (this.fight && (p === this.fight.a || p === this.fight.b))) continue;
        const f = Math.max(0, 1 - 2.5 * dt);
        p.vx *= f;
        p.vy *= f;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        confine(p, SKATER_R);
      }
    }

    // Against a person, how much better the computer's team plays than the
    // person's own teammates (0 for them): at normal a step quicker than the
    // person, keener with the stick and to check, and a sharper goalie; less
    // than that on easy, a little behind even, and more on hard.
    sharp(team) {
      return this.human && team === "b" ? (LEVELS[this.level] ?? 1) : 0;
    }

    maxSpeed(p) {
      if (p.role === "goalie") return 5;
      const s = this.sharp(p.team);
      const base = s ? 8.6 + 0.7 * s : this.human && p === this.controlled ? 8.8 : 8.6;
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
        spots.push([own + s * 9, 7], [own + s * 9, -7], [own + s * 17, 0], [own + s * 22, 9], [own + s * 22, -9]);
      } else if (c && c.team === team) {
        // The far post, for a pass across and a one-timer; a trailer; the
        // point; five a side, the other point and someone in front of the net.
        const deep = s * (opp - c.x) < 18;
        spots.push(
          [opp - s * (deep ? 4.5 : 7), c.y > 0 ? -3.5 : 3.5],
          [c.x - s * 8, c.y * 0.3],
          [opp - s * 12, c.y > 0 ? 3 : -3],
          [opp - s * 16, c.y > 0 ? -7 : 7],
          [opp - s * 3.5, c.y > 0 ? 1.5 : -1.5]
        );
      } else if (c && c.role === "goalie") {
        spots.push([opp - s * 9, 5], [opp - s * 9, -5], [opp - s * 18, 0], [opp - s * 15, 9], [opp - s * 15, -9]);
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
        // The last defender minds the slot, and when the carrier comes into it,
        // steps into the line between the carrier and the net.
        const close = hypot(own - c.x, c.y) < 11;
        spots.push(close ? [c.x + (own - c.x) * 0.35, c.y * 0.65] : [own + s * 6, clamp(pk.y * 0.35, -3, 3)]);
        // Five a side: the next two attackers nearest the goal are covered too.
        this.skaters(other(team))
          .filter((o) => o !== c && o !== threat)
          .sort((a, b) => Math.abs(a.x - own) - Math.abs(b.x - own))
          .slice(0, 2)
          .forEach((o) => spots.push([o.x + (own - o.x) * 0.12, o.y * 0.85]));
      } else {
        const lead = { x: pk.x + pk.vx * 0.3, y: pk.y + pk.vy * 0.3 };
        spots.push(
          [lead.x, lead.y],
          [pk.x - s * 7, pk.y * 0.5],
          [own + s * 7, pk.y * 0.3],
          [pk.x - s * 6, -pk.y * 0.5 + (pk.y > 0 ? -5 : 5)],
          [own + s * 13, -pk.y * 0.3]
        );
      }
      // Onside: while the puck is outside the zone it attacks (or a delayed
      // offside is on against the team, to tag up), nobody waits inside it.
      if (s * pk.x <= BLUE || (this.offside && this.offside.team === team))
        for (const sp of spots) if (s * sp[0] > BLUE - 1.6) sp[0] = s * (BLUE - 1.6);
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
      p.braking = reversing(p);
    }

    think(p, dt) {
      const pk = this.puck,
        c = pk.carrier;
      if (c === p) return this.carry(p, dt);
      // ...or line up a body check on a carrier close by.
      if (c && c.team !== p.team && c.role === "skater" && p.checkCool <= 0 && (this.t || 0) - (this.dropped || 0) > 1.2) {
        const d = dist(p, c),
          // From behind, near the boards, is boarding: it holds off.
          behind = ((c.x - p.x) * c.fx + (c.y - p.y) * c.fy) / (d || 1) > 0.4,
          near = { x: c.x, y: c.y },
          boards = !!confine(near, SKATER_R + 2.6);
        if (!(behind && boards) && d > 1.8 && d < 3.4 && this.random() < Math.max(0.1, 0.45 + 0.55 * this.sharp(p.team)) * dt) {
          return this.check(p, c.x + c.vx * 0.15 - p.x, c.y + c.vy * 0.15 - p.y);
        }
      }
      if (c && c.team !== p.team && c.role === "skater" && p.cool <= 0) {
        if (Math.min(dist(this.stick(p), pk), dist(p, pk) - 0.8) < 1.4 && this.random() < 1.8 * dt)
          this.poke(p, 0.45 + 0.15 * this.sharp(p.team), 1.4);
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
      // A pass just in, in front of the net: shoot it straight back, a one-timer.
      if (p.oneTimer > 0 && front > 1.5 && toGoal < 15 && Math.abs(p.y) < front * 1.3 + 2 && this.random() < 14 * dt) {
        return this.shoot(p, null);
      }
      if (p.cool <= 0 && front > 1.5 && toGoal < 18 && Math.abs(p.y) < front * 1.3 + 2) {
        const open = !this.blocked(p, { x: opp, y: 0 }, 1.0);
        const rate = (open ? (toGoal < 9 ? 3.5 : 1.4) : 0.5) * urge;
        if (this.random() < rate * dt) return this.shoot(p, null);
      }
      const near = this.nearestOpponent(p);
      const pressed = near && dist(near, p) < 2.8;
      // A teammate open in front of the net, well closer to it: give it to them.
      const mate = p.cool <= 0 ? this.passTarget(p, null) : null;
      const better = mate && s * (opp - mate.x) > 1.5 && hypot(opp - mate.x, mate.y) < Math.min(10, toGoal - 4);
      if (mate && this.random() < (better ? 2.5 : pressed ? 1 : 0.15) * urge * dt) return this.pass(p, mate);
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
      // Not over the blue line with the puck while a teammate is still in the
      // zone: it waits at the line for them to come out (or it is offside).
      if (s * p.x < BLUE && this.skaters(p.team).some((m) => m !== p && s * m.x > BLUE)) tx = s * Math.min(s * tx, BLUE - 1.2);
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
      p.braking = reversing(p);
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
      // Who it is aimed at, and whether they have the puck (or just had it):
      // aimed at someone without it, it is interference.
      let target = null,
        near = 4.5;
      for (const o of this.skaters(other(p.team))) {
        const along = ((o.x - p.x) * dx + (o.y - p.y) * dy) / l,
          across = Math.abs((o.x - p.x) * dy - (o.y - p.y) * dx) / l;
        if (along > 0 && along < near && across < 1.6) [target, near] = [o, along];
      }
      p.target = target;
      p.targetHad = !target || this.puck.carrier === target || (this.t || 0) - target.lostAt < 0.6;
      p.dash = CHECK.time;
      p.dashX = (dx / l) * CHECK.speed;
      p.dashY = (dy / l) * CHECK.speed;
      p.checkCool = this.human && p === this.controlled ? 1.2 : 2.8;
      this.events.push({ type: "lunge", team: p.team });
    }

    // A check that knocks someone down. Aimed at a player without the puck
    // (who has not just passed it) it is interference; from behind into the
    // boards, boarding: a penalty either way, delayed while the other team
    // has the puck. Bumping into someone else on the way is no foul.
    knock(hitter, victim, nx, ny, speed) {
      const pk = this.puck,
        had = victim !== hitter.target || hitter.targetHad,
        behind = nx * victim.fx + ny * victim.fy > 0.55;
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
      const foul = !had ? "interference" : behind && boards ? "boarding" : null;
      // Someone stands up for the one knocked down: a fight, now and then.
      const chance = foul ? FIGHT.foul : boards && speed > CHECK.hard + 2 ? FIGHT.boards : 0;
      if (chance && this.phase === "play" && hitter.role === "skater" && this.random() < chance) {
        const mate = this.skaters(victim.team)
          .filter((m) => m !== victim && !(m.down > 0))
          .sort((m, n) => dist(m, hitter) - dist(n, hitter))[0];
        if (mate && dist(mate, hitter) < 12) return this.startFight(hitter, mate);
      }
      if (foul && !this.delayed && this.phase === "play") {
        this.delayed = { p: hitter, why: foul, on: victim };
        this.events.push({
          type: "delayed",
          why: "penalty",
          foul,
          team: hitter.team,
          by: this.players.indexOf(hitter),
          on: this.players.indexOf(victim),
        });
      }
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
        if (o.team === p.team || o.role === "goalie" || o.box > 0) return false;
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
      const inside = (q) => s * q.x > BLUE - 0.2;
      for (const m of this.skaters(p.team)) {
        if (m === p) continue;
        // Into the zone from outside it, to someone already in there: offside.
        if (!inside(this.puck) && inside(m)) continue;
        const d = dist(m, p);
        if (d < 3 || d > 32) continue;
        const slot = hypot(s * GOAL_X - m.x, m.y);
        let score = (s * (m.x - p.x)) / 10 - d / 30 + (slot < 10 && s * (s * GOAL_X - m.x) > 1.5 ? (10 - slot) / 6 : 0);
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
      p.lostAt = this.t || 0;
      this.sent(p);
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
      ty += (this.random() - 0.5) * 2 * (0.25 + d * 0.035) * Math.max(0.4, 1 - 0.3 * this.sharp(p.team));
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
        speed = clamp(10 + d * 0.8, 12, 23);
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
      c.lostAt = this.t || 0;
      pk.carrier = null;
      pk.last = p;
      this.sent(p);
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
        g.stance = pk.held > 0.35 ? "butterfly" : "ready";
        if (pk.held > 0) return this.steer(g, g.x, g.y, 2);
        const mate = this.passTarget(g, null) || this.skaters(g.team).sort((a, b) => dist(a, g) - dist(b, g))[0];
        this.pass(g, mate);
      }
      // A carrier who comes in close gets the goalie's stick: a poke check.
      const c = pk.carrier;
      if (c && c.team !== g.team && c.role === "skater" && g.cool <= 0 && dist(g, pk) < 2.6) {
        g.cool = 0.6;
        if (this.random() < 0.45 + 0.25 * this.sharp(g.team)) {
          const away = Math.atan2(pk.y - g.y, pk.x - g.x) + (this.random() - 0.5) * 1.4;
          pk.carrier = null;
          pk.last = g;
          pk.vx = Math.cos(away) * 6 + s * 3;
          pk.vy = Math.sin(away) * 6;
          c.noTouch = 0.5;
          g.noTouch = 0.4;
          this.events.push({ type: "poke", team: g.team });
        }
      }
      // Where to stand, as goaltending coaches teach it: on the line from the
      // puck to the middle of the net, square to it, at a depth that follows
      // the play. The goalie sees the puck a moment late (`seen`), so a quick
      // pass across finds it off its angle, as passes across the slot beat
      // real goalies (about 30% of such shots go in, against 8.5%).
      const lag = 0.16 * (1 - 0.2 * Math.max(0, this.sharp(g.team))),
        k = 1 - Math.exp(-dt / lag);
      g.seen = g.seen || { x: pk.x, y: pk.y };
      g.seen.x += (pk.x - g.seen.x) * k;
      g.seen.y += (pk.y - g.seen.y) * k;
      const px = g.seen.x,
        py = g.seen.y,
        out = (px - gx) * s,
        r = hypot(px - gx, py);
      // On the post, one pad down along the goal line (reverse-VH): the puck
      // near the goal line and wide, or behind the net.
      g.kneel = Math.max(0, (g.kneel || 0) - dt);
      if (out < 1.5 && (Math.abs(py) > NET_HALF * 0.7 || out < 0)) {
        g.stance = "post";
        g.kneel = 0;
        const side = Math.sign(py) || Math.sign(pk.vy) || 1;
        return this.steer(g, gx + s * 0.6, side * (NET_HALF - 0.2), 5.5);
      }
      const ang = clamp(Math.atan2(py, Math.max(0.3, out)), -1.25, 1.25);
      // Depth: the top of the crease for a puck far out; further out, to
      // challenge, against a carrier with nobody to pass to; backing in as it
      // comes close, and deeper on wide angles, or with a pass across on.
      const them = this.skaters(other(g.team)),
        alone = c && c.team !== g.team && !them.some((m) => m !== c && hypot(m.x - gx, m.y) < r + 3 && Math.abs(m.y - c.y) > 3),
        across = them.some((m) => m !== c && Math.sign(m.y) !== Math.sign(py) && Math.abs(m.y) > 2 && hypot(m.x - gx, m.y) < 11);
      let depth = alone && r > 8 && r < 18 ? 3.1 : 2.3;
      if (r < 9) depth = Math.min(depth, 1.2 + Math.max(0, r - 3) * 0.2);
      depth *= 1 - 0.4 * (ang / 1.25) ** 2;
      if (across) depth -= 0.4;
      depth = clamp(depth, 0.9, 3.2);
      // Down in the butterfly, pads flat across the ice, for a shot on its way
      // to the net or a loose puck in front of it; up again a moment later.
      const t = pk.vx ? (gx - pk.x) / pk.vx : -1,
        onNet = !c && t > 0 && t < 1 && hypot(pk.vx, pk.vy) > 12 && Math.abs(pk.y + pk.vy * t) < NET_HALF + 0.6;
      if (onNet || ((!c || c.team !== g.team) && r < 3.5 && Math.abs(ang) < 0.9)) g.kneel = Math.max(g.kneel, 0.45);
      g.stance = g.kneel > 0 ? "butterfly" : "ready";
      this.steer(g, gx + s * Math.cos(ang) * depth, Math.sin(ang) * depth, g.kneel > 0 ? 3.5 : 6);
    }

    move(dt) {
      const ps = this.players.filter((p) => !(p.box > 0));
      for (const p of ps) {
        if (p.dash > 0) [p.wx, p.wy] = [p.dashX, p.dashY];
        let dvx = p.wx - p.vx,
          dvy = p.wy - p.vy;
        const acc = (p.dash > 0 ? 60 : p.down > 0 ? 6 : p.role === "goalie" ? 20 : p.braking ? SKATE.brake : p.idle ? SKATE.coast : SKATE.push) * dt,
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
        if (g.role !== "goalie" || g.noTouch > 0 || pk.beat === g || g.box > 0) continue;
        if (dist(g, pk) > GOALIE_R + PUCK_R) continue;
        if (sp < 6) {
          this.cover(g);
          return true;
        }
        const s = DIR[g.team];
        const shotLength = pk.from ? hypot(pk.from.x + s * GOAL_X, pk.from.y) : 20;
        // From the side (more than about 50° off the middle) the goalie has the
        // post covered; close in from the front is the hard one.
        const wide = pk.from ? Math.abs(pk.from.y) / (shotLength || 1) > 0.77 : false;
        // How far off its angle the goalie is: between where it stands and the
        // line from where the shot came from to the middle of the net.
        const gx = -s * GOAL_X,
          sealed = g.stance === "post" && pk.from && Math.sign(pk.from.y) === Math.sign(g.y),
          off =
            pk.from && !sealed
              ? Math.abs(Math.atan2(g.y, Math.max(0.3, (g.x - gx) * s)) - Math.atan2(pk.from.y, Math.max(0.3, (pk.from.x - gx) * s)))
              : 0;
        let chance =
          0.84 -
          Math.max(0, sp - 18) * 0.02 -
          Math.abs(g.vy) * 0.05 -
          Math.min(0.15, off * 0.35) -
          (pk.rebound > 0 ? 0.18 : 0) -
          (shotLength < 6 && !wide ? 0.12 : 0) +
          (wide ? 0.15 : 0) +
          (g.stance === "butterfly" ? 0.03 : 0) -
          (pk.oneTimer ? 0.1 : 0);
        chance += 0.15 * this.sharp(g.team);
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
      // In a delayed offside, the computer's players of that team keep off the
      // puck until they have tagged up.
      const wait = this.offside && this.offside.team;
      for (const p of this.players) {
        if (p.role !== "skater" || p.noTouch > 0 || p.box > 0) continue;
        if (p.team === wait && !(this.human && p === this.controlled)) continue;
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
      // Shot in from outside the zone with a teammate offside: no goal.
      if (this.offside && this.offside.team === team)
        return this.whistle("offside", team, [DIR[team] * SPOT.neutral, (Math.sign(this.puck.y) || 1) * SPOT.side], this.offside.by);
      // A penalty still to call on the team scored on is not served; a goal
      // on the power play lets the first of them out of the box.
      if (this.delayed && this.delayed.p.team !== team) this.delayed = null;
      if (this.shorthanded(other(team))) {
        const first = this.players.filter((q) => q.team === other(team) && q.box > 0).sort((a, b) => a.box - b.box)[0];
        if (first) this.outOfBox(first);
      }
      this.offside = this.icing = null;
      this.ref.signal = false;
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
        by: by ? this.players.indexOf(by) : -1,
      });
    }
  }

  // ——— Between periods: the Kamboni ———
  // An ice resurfacer the person drives over the cut-up ice until enough of it
  // is clean; the page draws it. About life size, so the crew takes the nets
  // off the ice first, as in a real arena. Lengths in m, speeds in m/s.
  const RZ = {
    length: 5.2, // the body; the conditioner and towel trail behind it
    body: 2.6, // wide
    width: 3, // the band the conditioner cleans, its middle `rear` behind the Kamboni's
    rear: 2.85,
    speed: 16, // flat out
    cruise: 12, // with no keys pressed: it keeps going
    turn: 3.2, // rad/s, steering toward a direction, from above
    lock: 2.4, // rad/s at full lock, from the cab
    done: 0.65, // how much of the ice is enough
    gate: 1.8, // half the width of its gate, in the middle of the left-hand end boards
  };

  // The ice as 1 m cells, to measure how much of it is clean.
  function iceCells() {
    const cells = [];
    for (let x = -29.5; x < 30; x++) for (let y = -14.5; y < 15; y++) if (!confine({ x, y }, 0.4)) cells.push({ x, y, clean: false });
    return cells;
  }

  class Resurfacer {
    constructor() {
      Object.assign(this, { x: -21, y: -12, h: 0, v: 0, wheel: 0, time: 0, bonk: false, leg: 0 });
      this.track = []; // where its back has been: the middle of the clean band
      this.cells = iceCells();
      this.clean = 0;
    }
    get part() {
      return this.clean / this.cells.length;
    }
    get done() {
      return this.part >= RZ.done;
    }

    // `input` is the person's, in both views {drive: true, steer, throttle}:
    // it keeps going at a cruise, `steer` turns the wheel (smoothly, as hands
    // do) and `throttle` goes faster or slower, down to reversing. The crew's
    // is {x, y}, the way to go on the ice: it turns that way like a vehicle,
    // slowing for a sharp turn, and stops when let go.
    step(dt, input = {}) {
      if (input.drive) {
        const thr = clamp(input.throttle || 0, -1, 1),
          target = thr >= 0 ? RZ.cruise + (RZ.speed - RZ.cruise) * thr : RZ.cruise + (RZ.cruise + 3) * thr;
        this.v += clamp(target - this.v, -10 * dt, 6 * dt);
        this.wheel += clamp(clamp(input.steer || 0, -1, 1) - this.wheel, -5 * dt, 5 * dt);
        this.h += this.wheel * RZ.lock * clamp(Math.abs(this.v) / 3, 0.3, 1) * Math.sign(this.v || 1) * dt;
      } else {
        const ix = input.x || 0,
          iy = input.y || 0,
          push = Math.min(1, hypot(ix, iy));
        if (push > 0.15) {
          const want = Math.atan2(iy, ix),
            dh = Math.atan2(Math.sin(want - this.h), Math.cos(want - this.h));
          const rate = RZ.turn * (0.45 + 0.55 * Math.min(1, Math.abs(this.v) / 4));
          this.h += clamp(dh, -rate * dt, rate * dt);
          this.wheel = clamp(dh, -1, 1);
          const target = RZ.speed * push * (0.4 + 0.6 * Math.max(0, Math.cos(dh)));
          this.v += clamp(target - this.v, -12 * dt, 7 * dt);
        } else {
          this.v += clamp(-this.v, -9 * dt, 9 * dt);
          this.wheel = 0;
        }
      }
      this.x += Math.cos(this.h) * this.v * dt;
      this.y += Math.sin(this.h) * this.v * dt;
      // Against the boards: the body as three circles along it. It stops
      // short, with a `bonk` if it was quick.
      let hit = null;
      for (const o of [-1.6, 0, 1.6]) {
        const cx = this.x + Math.cos(this.h) * o,
          cy = this.y + Math.sin(this.h) * o,
          c = { x: cx, y: cy },
          n = confine(c, RZ.body / 2);
        if (!n) continue;
        this.x += c.x - cx;
        this.y += c.y - cy;
        hit = hit || n;
      }
      this.bonk = false;
      if (hit) {
        const into = -(Math.cos(this.h) * hit[0] + Math.sin(this.h) * hit[1]) * Math.sign(this.v);
        if (into > 0.3) {
          this.bonk = Math.abs(this.v) > 6 && into > 0.6;
          this.v *= 1 - into * Math.min(1, 12 * dt);
        }
      }
      this.time += dt;
      // Its back cleans the ice, a band as wide as the conditioner.
      const bx = this.x - Math.cos(this.h) * RZ.rear,
        by = this.y - Math.sin(this.h) * RZ.rear;
      const end = this.track[this.track.length - 1];
      if (end && hypot(bx - end[0], by - end[1]) < 0.4) return;
      this.track.push([bx, by]);
      for (const c of this.cells) {
        if (!c.clean && hypot(c.x - bx, c.y - by) < RZ.width / 2) {
          c.clean = true;
          this.clean++;
        }
      }
    }

    // Off the ice, once it is done: it drives itself to the gate in the
    // middle of the left-hand end boards, first to the middle of the rink in
    // front of it, then along the middle and out through it (the boards no
    // matter there). True once it is through.
    driveOff(dt) {
      if (!this.through) {
        if (this.lined && Math.abs(this.y) > 3.5) this.lined = false;
        if (!this.lined && hypot(this.x + 14, this.y) < 3) this.lined = true;
        // At half speed, so it turns tight. Along the middle: a point on it a
        // little ahead, so it comes onto it.
        const [tx, ty] = this.lined ? [this.x - 6, 0] : [-14, 0],
          d = (hypot(tx - this.x, ty - this.y) || 1) / 0.55;
        this.step(dt, { x: (tx - this.x) / d, y: (ty - this.y) / d });
        if (this.lined && this.x < -23.5 && Math.abs(this.y) < 0.5 && Math.cos(this.h) < -0.97) this.through = true;
        return false;
      }
      // Through the gate: aimed at a point beyond it, at a steady speed.
      const want = Math.atan2(-this.y, -L - 6 - this.x),
        turn = Math.atan2(Math.sin(want - this.h), Math.cos(want - this.h));
      this.h += clamp(turn, -3 * dt, 3 * dt);
      this.v = 6;
      this.x += Math.cos(this.h) * this.v * dt;
      this.y += Math.sin(this.h) * this.v * dt;
      this.time += dt;
      return this.x < -L - 4;
    }

    // The crew's way, as input from above: rows along the rink, turning at the
    // ends, as near the boards and round the corners as it fits.
    autopilot() {
      if (!this.route) {
        const r = RZ.body / 2,
          edge = W - r - 0.1,
          rows = [];
        for (let y = -edge; y < edge; y += RZ.width - 0.4) rows.push(y);
        rows.push(edge);
        const reach = (y) =>
          (Math.abs(y) > W - CORNER ? L - CORNER + Math.sqrt(Math.max(0, (CORNER - r) ** 2 - (Math.abs(y) - (W - CORNER)) ** 2)) : L - r) - 2.2;
        this.route = rows.flatMap((y, i) =>
          i % 2
            ? [
                [reach(y), y],
                [-reach(y), y],
              ]
            : [
                [-reach(y), y],
                [reach(y), y],
              ]
        );
      }
      let [tx, ty] = this.route[this.leg % this.route.length];
      if (hypot(tx - this.x, ty - this.y) < 2.5) [tx, ty] = this.route[++this.leg % this.route.length];
      const d = hypot(tx - this.x, ty - this.y) || 1;
      return { x: (tx - this.x) / d, y: (ty - this.y) / d };
    }
  }

  const api = { Game, Resurfacer, RZ, LEVELS, STEP, GOAL_X };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HockeyGame = api;

  // ——— The page ———

  if (typeof document === "undefined") return;

  // Said when a goal goes in; % is the scorer.
  const QUIPS = {
    a: [
      "Goal! %, top shelf.",
      "Goal! % through the five-hole.",
      "Goal! %. The goalie is still looking for it.",
      "Goal! %. Somebody tell the computer.",
    ],
    b: [
      "% scores for the computer. It will be unbearable now.",
      "% scores. The computer practised all night.",
      "% scores, and the computer does a small dance.",
    ],
  };

  // Famous players, with the numbers they wore: each game deals its two
  // line-ups from them. Only the names: the players are the game's own drawings.
  const SKATERS = [
    ["Gretzky", 99],
    ["Lemieux", 66],
    ["Orr", 4],
    ["Howe", 9],
    ["Jágr", 68],
    ["Crosby", 87],
    ["McDavid", 97],
    ["Messier", 11],
    ["Lidström", 5],
    ["Bure", 10],
    ["Yzerman", 19],
    ["Forsberg", 21],
    ["Kurri", 17],
    ["Selänne", 8],
  ];
  const GOALIES = [
    ["Roy", 33],
    ["Hašek", 39],
    ["Brodeur", 30],
    ["Dryden", 29],
  ];
  function lineUp(game) {
    const deal = (list) =>
      list
        .map((v) => [Math.random(), v])
        .sort((x, y) => x[0] - y[0])
        .map((v) => v[1]);
    const skaters = deal(SKATERS),
      goalies = deal(GOALIES);
    for (const p of game.players) [p.name, p.number] = p.role === "goalie" ? goalies.shift() : skaters.shift();
    return game;
  }
  // "Gretzky, Orr and Lemieux, with Roy in goal"
  function lineUpText(game, team) {
    const them = game.players.filter((p) => p.team === team),
      skaters = them.filter((p) => p.role !== "goalie").map((p) => p.name);
    return `${skaters.slice(0, -1).join(", ")} and ${skaters[skaters.length - 1]}, with ${them.find((p) => p.role === "goalie").name} in goal`;
  }

  // ——— The scoreboard, as in an arena ———
  // Seven-segment LEDs, the unlit segments faintly there, laid out as real
  // hockey boards are: the time big and red, in tenths of a second under a
  // minute; either side the scores in amber, each with a red goal light; under
  // them the shots on goal and the period. White captions. Between periods the
  // time gives way to how clean the ice is.
  const SEGMENTS = {
    0: "abcdef",
    1: "bc",
    2: "abdeg",
    3: "abcdg",
    4: "bcfg",
    5: "acdfg",
    6: "acdefg",
    7: "abc",
    8: "abcdefg",
    9: "abcdfg",
    "-": "g",
    o: "cdeg",
    t: "defg",
  };
  const SLANT = Math.tan((7 * Math.PI) / 180);
  // One digit, w × h with segments t thick, its top left at (x, 0).
  function digitSVG(key, x, w, h, t) {
    const G = t * 0.16,
      hz = (yc) => [
        [t / 2 + G, yc],
        [t + G, yc - t / 2],
        [w - t - G, yc - t / 2],
        [w - t / 2 - G, yc],
        [w - t - G, yc + t / 2],
        [t + G, yc + t / 2],
      ],
      vt = (xc, y0, y1) => [
        [xc, y0 + G],
        [xc + t / 2, y0 + t / 2 + G],
        [xc + t / 2, y1 - t / 2 - G],
        [xc, y1 - G],
        [xc - t / 2, y1 - t / 2 - G],
        [xc - t / 2, y0 + t / 2 + G],
      ];
    const segs = {
      a: hz(t / 2),
      b: vt(w - t / 2, t / 2, h / 2),
      c: vt(w - t / 2, h / 2, h - t / 2),
      d: hz(h - t / 2),
      e: vt(t / 2, h / 2, h - t / 2),
      f: vt(t / 2, t / 2, h / 2),
      g: hz(h / 2),
    };
    const poly = (p) => p.map((q) => q.map((v) => v.toFixed(2)).join(",")).join(" ");
    return `<g data-digit="${key}" transform="translate(${x.toFixed(2)} 0)">${Object.entries(segs)
      .map(([n, p]) => `<polygon data-seg="${n}" points="${poly(p)}"/>`)
      .join("")}</g>`;
  }
  // A row of digits, slanted like the real ones, its top at y and centred on
  // cx; gaps between them, and `extra` (the clock's colon and point) inside.
  function digitsSVG(key, cls, cx, y, w, h, t, gaps, extra = () => "") {
    const total = gaps.reduce((sum, g) => sum + g + w, w);
    let x = cx - total / 2 + (SLANT * h) / 2,
      out = "";
    const xs = gaps.concat(0).map((g, i) => {
      out += digitSVG(key + i, x, w, h, t);
      const at = x;
      x += w + g;
      return at;
    });
    return `<g class="${cls}" transform="translate(0 ${y}) skewX(-7)">${out}${extra(xs)}</g>`;
  }
  function scoreboard(el) {
    const caption = (x, y, size, text, attrs = "") => `<text x="${x}" y="${y}" font-size="${size}" ${attrs}>${text}</text>`;
    const dot = (cx, cy, t, attr) => `<rect ${attr} x="${(cx - t / 2).toFixed(2)}" y="${(cy - t / 2).toFixed(2)}" width="${t}" height="${t}"/>`;
    // m:ss, and ss.t: the colon between the 2nd and 3rd digits, the point between the 3rd and 4th.
    const marks = (xs) => {
      const colon = xs[2] - 5.5,
        point = xs[3] - 4;
      return dot(colon, 12, 5, "data-colon") + dot(colon, 28, 5, "data-colon") + dot(point, 37.5, 5, "data-point");
    };
    el.innerHTML = `<svg viewBox="0 0 320 100" role="img">
      <rect class="sb-panel" x="1" y="1" width="318" height="98" rx="8"/>
      <g class="sb-caption" text-anchor="middle">
        ${caption(52, 14, 9.5, "YOU")}${caption(160, 14, 9.5, "TIME", "data-caption")}${caption(268, 14, 9.5, "COMPUTER")}
        ${caption(52, 75, 7.5, "SHOTS")}${caption(160, 75, 7.5, "PERIOD")}${caption(268, 75, 7.5, "SHOTS")}
        ${caption(91, 26, 6, "PEN", 'data-pen="a"')}${caption(229, 26, 6, "PEN", 'data-pen="b"')}</g>
      <rect x="40" y="17.5" width="24" height="1.8" fill="var(--rink-team-a)"/><rect x="241" y="17.5" width="54" height="1.8" fill="var(--rink-team-b)"/>
      <circle class="sb-lamp" data-goal="a" cx="16" cy="40" r="4"/><circle class="sb-lamp" data-goal="b" cx="304" cy="40" r="4"/>
      ${digitsSVG("a", "sb-amber", 52, 22, 19, 36, 4.6, [6])}
      ${digitsSVG("t", "sb-red", 160, 20, 21, 40, 5, [5, 11, 8], marks)}
      ${digitsSVG("b", "sb-amber", 268, 22, 19, 36, 4.6, [6])}
      ${digitsSVG("x", "sb-amber", 52, 79, 10, 17, 2.6, [3.5])}
      ${digitsSVG("p", "sb-amber", 153.25, 79, 11, 17, 2.8, [2.5])}
      ${digitsSVG("y", "sb-amber", 268, 79, 10, 17, 2.6, [3.5])}
      ${digitsSVG("q", "sb-red", 91, 30, 8, 14, 2.2, [2.5])}
      ${digitsSVG("r", "sb-red", 229, 30, 8, 14, 2.2, [2.5])}</svg>`;
    const svgEl = el.querySelector("svg"),
      digits = {};
    for (const g of el.querySelectorAll("[data-digit]")) digits[g.dataset.digit] = { ch: null, segs: [...g.children] };
    const write = (key, text) =>
      [...text].forEach((ch, i) => {
        const d = digits[key + i];
        if (!d || d.ch === ch) return;
        d.ch = ch;
        const lit = SEGMENTS[ch] || "";
        for (const seg of d.segs) seg.classList.toggle("on", lit.includes(seg.dataset.seg));
      });
    const two = (n) => String(n).padStart(2).slice(-2);
    let label = null;
    return {
      // Scores and shots as numbers, `time` four characters and `period` two.
      set(v) {
        write("a", two(v.a));
        write("b", two(v.b));
        write("x", two(v.shotsA));
        write("y", two(v.shotsB));
        write("t", v.time);
        write("p", v.period);
        // Seconds left of a penalty, the team a skater short.
        write("q", v.penA ? two(v.penA) : "  ");
        write("r", v.penB ? two(v.penB) : "  ");
        el.querySelectorAll("[data-pen]").forEach((c) => c.classList.toggle("is-off", !(c.dataset.pen === "a" ? v.penA : v.penB)));
        el.querySelectorAll("[data-colon]").forEach((c) => c.classList.toggle("on", !!v.colon));
        el.querySelector("[data-point]").classList.toggle("on", !!v.point);
        const cap = el.querySelector("[data-caption]");
        if (cap.textContent !== v.caption) cap.textContent = v.caption;
        el.querySelector(".sb-red").classList.toggle("sb-blink", !!v.blink);
        el.querySelectorAll("[data-goal]").forEach((l) => l.classList.toggle("on", l.dataset.goal === v.goal));
        if (label !== v.label) svgEl.setAttribute("aria-label", (label = v.label));
      },
    };
  }
  // The clock as a board shows it: m:ss, and under a minute ss.t.
  function boardTime(t) {
    const tenths = Math.ceil(t * 10 - 1e-6);
    if (tenths >= 600) {
      const secs = Math.ceil(t - 1e-6);
      return { time: String(Math.floor(secs / 60)).padStart(2) + String(secs % 60).padStart(2, "0"), colon: true };
    }
    const secs = Math.floor(tenths / 10);
    return { time: ` ${secs < 10 ? " " : Math.floor(secs / 10)}${secs % 10}${tenths % 10}`, point: true };
  }
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const NS = "http://www.w3.org/2000/svg";
  const el = (name, attrs, parent) => {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  // Stars that circle a player who has been knocked down.
  const starsSVG = (r) =>
    `<g data-stars visibility="hidden">${[0, 120, 240]
      .map(
        (a) =>
          `<path transform="rotate(${a}) translate(0 ${-r})" d="M 0 -0.3 L 0.08 -0.08 L 0.3 0 L 0.08 0.08 L 0 0.3 L -0.08 0.08 L -0.3 0 L -0.08 -0.08 Z" fill="var(--rink-puck-ring)"/>`
      )
      .join("")}</g>`;
  // The lamps behind the nets: red for a goal, green when time is up.
  const glow = (id, c) =>
    `<radialGradient id="${id}"><stop offset="0" stop-color="${c}" stop-opacity="0.85"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`;
  const LAMP = `<defs>${glow("rink-lamp", "#ff3b30")}${glow("rink-lamp-green", "#34c759")}</defs>`;

  // ——— Two views ———
  // From above, as the drills are drawn, or the TV camera: high in the stands
  // at centre ice, looking across the rink through a long lens, so nearly
  // without perspective (an orthographic camera, tilted so the ice is squashed
  // by SQUASH, heights rising up the screen RISE a metre; YAW would turn it).
  // It frames about three quarters of the rink (VIEW metres) and pans to follow
  // the puck, with a map of the whole rink in the corner. The game is the same
  // either way; only the drawing changes, and which way the keys skate.
  const YAW = 0,
    SQUASH = 0.56,
    RISE = 0.82,
    TALL = 0.95, // standing players are drawn a little smaller than in life ×2
    VIEW = 44;
  const TILT = (() => {
    const c = Math.cos(YAW),
      s = Math.sin(YAW);
    const m = [c, SQUASH * s, -s, SQUASH * c]; // as SVG's matrix(a b c d): x' = a x + c y, y' = b x + d y
    const det = m[0] * m[3] - m[1] * m[2];
    return {
      m,
      at: (x, y, h = 0) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y - h * RISE],
      // A direction on the screen, as a direction on the ice.
      back: (sx, sy) => [(m[3] * sx - m[2] * sy) / det, (-m[1] * sx + m[0] * sy) / det],
    };
  })();
  const BOARDS = 1.15; // m high
  const pt = (x, y, h) =>
    TILT.at(x, y, h)
      .map((v) => v.toFixed(2))
      .join(",");

  // The boards' outline, with outward normals, corner by corner.
  function outline() {
    const out = [],
      cx = L - CORNER,
      cy = W - CORNER;
    const corners = [
      [cx, cy, 0],
      [-cx, cy, Math.PI / 2],
      [-cx, -cy, Math.PI],
      [cx, -cy, (3 * Math.PI) / 2],
    ];
    for (const [kx, ky, a0] of corners) {
      for (let i = 0; i <= 10; i++) {
        const a = a0 + (i / 10) * (Math.PI / 2);
        out.push({ x: kx + Math.cos(a) * CORNER, y: ky + Math.sin(a) * CORNER, nx: Math.cos(a), ny: Math.sin(a) });
      }
    }
    return out;
  }

  // The boards standing up round the ice: the far side's inside face, drawn
  // behind everything, and the near side's, see-through, in front.
  function boardsSVG(far) {
    const pts = outline(),
      faces = [],
      kicks = [],
      rail = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i],
        b = pts[(i + 1) % pts.length];
      const facing = TILT.m[1] * (a.nx + b.nx) + TILT.m[3] * (a.ny + b.ny); // < 0: faces up the screen, the far side
      if (facing < 0 !== far) continue;
      faces.push(`M ${pt(a.x, a.y, 0)} L ${pt(b.x, b.y, 0)} L ${pt(b.x, b.y, BOARDS)} L ${pt(a.x, a.y, BOARDS)} Z`);
      kicks.push(`M ${pt(a.x, a.y, 0)} L ${pt(b.x, b.y, 0)} L ${pt(b.x, b.y, 0.25)} L ${pt(a.x, a.y, 0.25)} Z`);
      rail.push(`M ${pt(a.x, a.y, BOARDS)} L ${pt(b.x, b.y, BOARDS)}`);
    }
    return `<g opacity="${far ? 1 : 0.3}" stroke-linejoin="round">
      <path d="${faces.join(" ")}" fill="var(--rink-wall)" stroke="var(--rink-wall)" stroke-width="0.04"/>
      <path d="${kicks.join(" ")}" fill="var(--rink-board)" stroke="var(--rink-board)" stroke-width="0.04"/>
      <path d="${rail.join(" ")}" fill="none" stroke="var(--rink-board)" stroke-width="0.24" stroke-linecap="round"/></g>`;
  }

  // A net standing on the goal line: mesh on the back, sides and top, and the
  // red frame of posts and crossbar.
  function net3SVG(s) {
    const x0 = s * GOAL_X,
      x1 = s * (GOAL_X + NET_DEPTH),
      h = NET_HALF,
      top = 1.8,
      low = 1.0;
    const mesh = `fill="var(--rink-mesh)" stroke="var(--rink-mesh-line)" stroke-width="0.05" stroke-linejoin="round"`;
    const face = (...p) => `<polygon points="${p.map((q) => pt(...q)).join(" ")}" ${mesh}/>`;
    return `<g data-net="${s}">
      ${face([x1, -h, 0], [x1, h, 0], [x1, h, low], [x1, -h, low])}
      ${face([x0, -h, 0], [x1, -h, 0], [x1, -h, low], [x0, -h, top])}
      ${face([x0, h, 0], [x1, h, 0], [x1, h, low], [x0, h, top])}
      ${face([x0, -h, top], [x0, h, top], [x1, h, low], [x1, -h, low])}
      <path d="M ${pt(x0, -h, 0)} L ${pt(x0, -h, top)} L ${pt(x0, h, top)} L ${pt(x0, h, 0)}" fill="none" stroke="var(--rink-red)" stroke-width="0.17" stroke-linejoin="round" stroke-linecap="round"/></g>`;
  }

  // A hockey player standing up, its feet at (0, 0): skates with blades,
  // striped socks, hockey pants, a jersey over shoulder pads, gloves on the
  // stick, and an open helmet with ear guards, a clear half visor over the
  // eyes down to the bottom of the nose (as the IIHF rules have it), and the
  // chin strap under the chin, the mouth between: drawn lower, the visor and
  // the strap made everyone look as if smiling.
  // A goalie is another shape: big pads, a wide chest protector, a blocker and
  // a catching glove, a painted mask with a cage and a paddle stick. The parts
  // that turn with the player (face, arms, stick) are set by draw().
  // A hockey stick standing on the ice, to a real one's proportions (IIHF
  // rules: up to 1.63 m to the heel, the blade 32 cm long and 5 to 7.6 cm
  // high; a goalie's blade 39.5 cm long and 9 cm high, 11.5 at the heel, and
  // the widened paddle 71 cm up the shaft). The shaft from the top hand, and
  // a long, low blade flat on the ice, its toe rounded; a goalie's with the
  // paddle. setStick() puts it where it is held.
  function stickSVG(goalie) {
    const line = `stroke="var(--rink-stick)" stroke-linecap="round"`;
    return `<g data-sticks>
      <line data-stick ${line} stroke-width="${goalie ? 0.09 : 0.085}"/>
      ${goalie ? `<line data-paddle ${line} stroke-width="0.16"/>` : ""}
      <path data-blade fill="var(--rink-stick)"/></g>`;
  }
  // From the top hand (x1, y1) to the middle of the blade (bx, by), on the
  // ice; the blade runs on from the heel away from the shaft, `toe` 1 to the
  // right, -1 to the left.
  function setStick(g, x1, y1, bx, by, toe, goalie) {
    const f = (v) => v.toFixed(3),
      long = goalie ? 0.56 : 0.46, // the blade, heel to toe
      high = goalie ? 0.13 : 0.1, // at the heel
      tip = goalie ? 0.11 : 0.075, // at the toe
      hx = bx - toe * long * 0.4,
      tx = hx + toe * long,
      stick = g.querySelector("[data-stick]");
    stick.setAttribute("x1", f(x1));
    stick.setAttribute("y1", f(y1));
    stick.setAttribute("x2", f(hx));
    stick.setAttribute("y2", f(by - high * 0.6));
    const paddle = g.querySelector("[data-paddle]");
    if (paddle) {
      paddle.setAttribute("x1", f(x1 + (hx - x1) * 0.55));
      paddle.setAttribute("y1", f(y1 + (by - y1) * 0.55));
      paddle.setAttribute("x2", f(hx));
      paddle.setAttribute("y2", f(by - high * 0.6));
    }
    // Flat along the bottom, the toe rounded, the top edge falling a little
    // from the heel to the toe, and the heel rounded into the shaft.
    const r = tip / 2;
    g.querySelector("[data-blade]").setAttribute(
      "d",
      `M ${f(hx)} ${f(by)} L ${f(tx - toe * r)} ${f(by)} Q ${f(tx)} ${f(by)} ${f(tx)} ${f(by - r)} Q ${f(tx)} ${f(by - tip)} ${f(tx - toe * r)} ${f(by - tip)} ` +
        `L ${f(hx + toe * 0.05)} ${f(by - high)} Q ${f(hx - toe * 0.02)} ${f(by - high)} ${f(hx - toe * 0.02)} ${f(by - high * 0.5)} Q ${f(hx - toe * 0.02)} ${f(by)} ${f(hx)} ${f(by)} Z`
    );
  }

  function standingSVG(team, goalie, skin, number = "") {
    const shirt = `var(--rink-team-${team})`;
    const digits = (y) => `<text y="${y}" font-size="0.48" font-weight="800" text-anchor="middle" fill="#fff">${number}</text>`;
    const edge = `stroke="var(--rink-helmet-edge)" stroke-width="0.05"`;
    const eye = (x) =>
      `<circle cx="${x}" cy="0.03" r="0.1" fill="#fff"/>
      <circle data-pupil data-cx="${x}" data-cy="0.03" cx="${x}" cy="0.03" r="0.05" fill="#111"/>
      <path data-out d="M ${x - 0.06} -0.03 l 0.12 0.12 m 0 -0.12 l -0.12 0.12" stroke="#111" stroke-width="0.04" stroke-linecap="round" visibility="hidden"/>`;
    const skate = (x) =>
      `<rect x="${x}" y="-0.2" width="0.3" height="0.18" rx="0.06" fill="var(--rink-boot)"/>
      <line x1="${x - 0.02}" y1="0.01" x2="${x + 0.34}" y2="0.01" stroke="var(--rink-blade)" stroke-width="0.05" stroke-linecap="round"/>`;
    if (goalie) {
      const pad = (x) =>
        `<rect x="${x}" y="-1.05" width="0.6" height="1.02" rx="0.2" fill="var(--rink-mask)" ${edge}/>
        <rect x="${x}" y="-0.8" width="0.6" height="0.08" fill="${shirt}"/><rect x="${x}" y="-0.45" width="0.6" height="0.08" fill="${shirt}"/>`;
      // A pad flat on the ice, knee in the middle and toe out to the side
      // (`side` -1 left, 1 right), as in the butterfly.
      const flat = (side) =>
        `<g transform="scale(${side} 1) rotate(-9 0.04 -0.02)">
        <rect x="0.04" y="-0.6" width="1.36" height="0.58" rx="0.2" fill="var(--rink-mask)" ${edge}/>
        <rect x="0.38" y="-0.6" width="0.08" height="0.58" fill="${shirt}"/><rect x="0.86" y="-0.6" width="0.08" height="0.58" fill="${shirt}"/>
        <rect x="1.34" y="-0.42" width="0.24" height="0.32" rx="0.08" fill="var(--rink-boot)"/></g>`;
      return `${stickSVG(true)}
      <g transform="scale(${TALL})">
      <ellipse rx="1.1" ry="${(1.1 * SQUASH).toFixed(2)}" fill="var(--rink-shadow)"/>
      <g data-figure>
        <g data-stance="ready">${skate(-0.62)}${skate(0.32)}${pad(-0.68)}${pad(0.08)}</g>
        <g data-stance="butterfly" visibility="hidden">${flat(-1)}${flat(1)}</g>
        <g data-stance="post" visibility="hidden">${flat(-1)}${skate(0.32)}${pad(0.08)}</g>
        <g data-upper>
        <path d="M -0.7 -1.45 H 0.7 L 0.74 -1.05 H -0.74 Z" fill="var(--rink-pants)"/>
        <path d="M -1.02 -2 Q -1.05 -2.3 -0.7 -2.3 H 0.7 Q 1.05 -2.3 1.02 -2 L 0.86 -1.4 H -0.86 Z" fill="${shirt}" ${edge}/>
        <rect x="-0.86" y="-1.62" width="1.72" height="0.09" fill="#fff" opacity="0.8"/>
        ${digits(-1.74)}
        <rect x="0.78" y="-1.78" width="0.36" height="0.5" rx="0.07" fill="var(--rink-mask)" ${edge}/>
        <circle cx="-0.98" cy="-1.6" r="0.34" fill="var(--rink-mask)" ${edge}/>
        <circle cx="-0.98" cy="-1.6" r="0.16" fill="${shirt}" opacity="0.85"/>
        <g transform="translate(0 -2.62)">
          <g data-back><circle r="0.46" fill="var(--rink-mask)" ${edge}/><rect x="-0.08" y="-0.44" width="0.16" height="0.86" rx="0.08" fill="${shirt}"/></g>
          <g data-face>
            <circle r="0.46" fill="var(--rink-mask)" ${edge}/>
            <path d="M -0.4 -0.26 Q 0 -0.62 0.4 -0.26" fill="none" stroke="${shirt}" stroke-width="0.12" stroke-linecap="round"/>
            <ellipse cy="0.08" rx="0.3" ry="0.26" fill="${skin}"/>
            ${eye(-0.11)}${eye(0.11)}
            <path d="M -0.3 0 H 0.3 M -0.28 0.16 H 0.28 M -0.12 -0.14 V 0.32 M 0.12 -0.14 V 0.32" stroke="var(--rink-cage)" stroke-width="0.04"/>
          </g>
        </g>
        </g>
      </g>
      ${starsSVG(1)}</g>`;
    }
    const sock = (x) =>
      `<rect x="${x}" y="-0.74" width="0.24" height="0.56" rx="0.07" fill="${shirt}"/>
      <rect x="${x}" y="-0.52" width="0.24" height="0.08" fill="#fff" opacity="0.85"/>`;
    return `${stickSVG(false)}
      <g transform="scale(${TALL})">
      <ellipse rx="0.85" ry="${(0.85 * SQUASH).toFixed(2)}" fill="var(--rink-shadow)"/>
      <g data-figure>
        <g data-leg="-1">${skate(-0.34)}${sock(-0.31)}</g>
        <g data-leg="1">${skate(0.06)}${sock(0.09)}</g>
        <path d="M -0.5 -1.22 H 0.5 L 0.55 -0.78 Q 0.55 -0.7 0.46 -0.7 H -0.46 Q -0.55 -0.7 -0.55 -0.78 Z" fill="var(--rink-pants)"/>
        <path d="M -0.8 -1.98 Q -0.82 -2.2 -0.56 -2.2 H 0.56 Q 0.82 -2.2 0.8 -1.98 L 0.62 -1.14 H -0.62 Z" fill="${shirt}" ${edge}/>
        <rect x="-0.62" y="-1.36" width="1.24" height="0.09" fill="#fff" opacity="0.85"/>
        <line data-arm="-1" stroke="${shirt}" stroke-width="0.26" stroke-linecap="round"/>
        <line data-arm="1" stroke="${shirt}" stroke-width="0.26" stroke-linecap="round"/>
        <circle data-glove="-1" r="0.15" fill="var(--rink-glove)"/>
        <circle data-glove="1" r="0.15" fill="var(--rink-glove)"/>
        ${digits(-1.6)}
        <g transform="translate(0 -2.52)">
          <g data-back><circle r="0.4" fill="${shirt}" ${edge}/><rect x="-0.07" y="-0.38" width="0.14" height="0.62" rx="0.07" fill="#fff" opacity="0.5"/></g>
          <path data-over d="M -0.5 0.5 Q -0.62 -0.5 0 -0.56 Q 0.62 -0.5 0.5 0.5 Q 0 0.3 -0.5 0.5 Z" fill="${shirt}" ${edge} visibility="hidden"/>
          <g data-face>
            <circle cy="0.04" r="0.34" fill="${skin}"/>
            <path d="M -0.42 0.02 Q -0.44 -0.42 0 -0.44 Q 0.44 -0.42 0.42 0.02 L 0.3 -0.04 Q 0 -0.24 -0.3 -0.04 Z" fill="${shirt}" ${edge}/>
            <circle cx="-0.38" cy="0.04" r="0.1" fill="${shirt}"/><circle cx="0.38" cy="0.04" r="0.1" fill="${shirt}"/>
            ${eye(-0.12)}${eye(0.12)}
            <path d="M -0.07 0.25 H 0.07" stroke="var(--rink-mouth)" stroke-width="0.035" stroke-linecap="round"/>
            <path d="M -0.33 -0.1 Q 0 -0.2 0.33 -0.1 L 0.31 0.13 Q 0 0.16 -0.31 0.13 Z" fill="var(--rink-visor-clear)" stroke="rgba(255, 255, 255, 0.55)" stroke-width="0.02"/>
            <path d="M -0.22 -0.07 L -0.15 0.07" stroke="#fff" stroke-width="0.03" stroke-linecap="round" opacity="0.6"/>
            <path d="M -0.37 0.1 Q -0.31 0.42 0 0.43 Q 0.31 0.42 0.37 0.1" fill="none" stroke="var(--rink-strap)" stroke-width="0.035"/>
          </g>
        </g>
      </g>
      ${starsSVG(0.9)}</g>`;
  }

  // One of a goalie drawing's stances: standing ready, down in the
  // butterfly, or on the post with one pad down along the goal line (to the
  // left of the drawing, or with `flip` -1 to the right) and the body leaning
  // over it. Returns where the upper body has gone.
  function setStance(g, stance, flip = 1) {
    g.querySelectorAll("[data-stance]").forEach((e) => {
      const on = e.dataset.stance === stance;
      e.setAttribute("visibility", on ? "visible" : "hidden");
      if (on && stance === "post") e.setAttribute("transform", `scale(${flip} 1)`);
    });
    const [ux, uy] = stance === "butterfly" ? [0, 0.6] : stance === "post" ? [-0.1 * flip, 0.3] : [0, 0],
      upper = g.querySelector("[data-upper]");
    if (upper)
      upper.setAttribute("transform", stance === "ready" ? "" : `translate(${ux} ${uy})${stance === "post" ? ` rotate(${-6 * flip} 0 -1.1)` : ""}`);
    return [ux, uy];
  }
  // A goalie's stance (`stance` in the simulation) on its drawing; in the TV
  // camera's view the pad on the post lies toward the net. From above, the
  // post is drawn as ready.
  function poseGoalie(g, p, tv) {
    const stance = p.stance || "ready",
      flip = DIR[p.team],
      key = tv ? stance + flip : stance === "butterfly" ? stance : "ready";
    if (g.dataset.pose !== key) {
      g.dataset.pose = key;
      setStance(g, tv ? stance : key, flip);
    }
    return stance === "butterfly" ? [0, 0.6] : stance === "post" ? [-0.1 * flip, 0.3] : [0, 0];
  }

  const skinOf = (i) => {
    const skins = root.RINK_SKINS || ["#e2ad86"];
    return skins[(i * 3) % skins.length];
  };

  // ——— Skating ———
  // A stride's phase for each player, going round faster the faster they
  // skate: pushing, the skates push out to the side in turn; coasting, they
  // glide together; a hockey stop sets them wide. `amp` is 0 standing or
  // gliding, 1 striding at speed. Kept on the drawing, page side only.
  function strideOf(svg, i, p, now) {
    const all = (svg.strides = svg.strides || []),
      s = (all[i] = all[i] || { phase: i * 1.7, amp: 0, at: now }),
      dt = Math.min(0.1, Math.max(0, (now - s.at) / 1000)),
      speed = hypot(p.vx, p.vy),
      pushing = !p.idle && !p.braking && !(p.down > 0) && speed > 0.8;
    s.at = now;
    s.phase += dt * 2 * Math.PI * (0.7 + speed * 0.14);
    s.amp += ((pushing ? Math.min(1, speed / 5) : 0) - s.amp) * Math.min(1, dt * 8);
    return { phase: s.phase, amp: s.amp, speed, braking: p.braking && speed > 2 };
  }

  // ——— The referee ———
  // From above, facing +x: a striped shirt, orange armbands, a black helmet.
  const REF_TOP = `<clipPath id="rink-ref-clip"><ellipse rx="0.62" ry="0.88"/></clipPath>
    <ellipse rx="0.62" ry="0.88" fill="#f4f4f2" stroke="#1d1f22" stroke-width="0.07"/>
    <path clip-path="url(#rink-ref-clip)" d="M -1 -0.55 H 1 M -1 -0.18 H 1 M -1 0.18 H 1 M -1 0.55 H 1" stroke="#1d1f22" stroke-width="0.16"/>
    <circle cy="-0.8" r="0.14" fill="#f26b1d"/><circle cy="0.8" r="0.14" fill="#f26b1d"/>
    <circle r="0.36" fill="#1d1f22"/><circle cx="0.3" r="0.11" fill="#e8b896"/>`;
  // Standing, facing the camera; its right arm holds the puck out at a
  // faceoff (draw() moves the hand).
  const REF_STAND = `<g transform="scale(${TALL})">
    <ellipse rx="0.8" ry="${(0.8 * SQUASH).toFixed(2)}" fill="var(--rink-shadow)"/>
    <rect x="-0.34" y="-0.2" width="0.3" height="0.18" rx="0.06" fill="var(--rink-boot)"/>
    <rect x="0.06" y="-0.2" width="0.3" height="0.18" rx="0.06" fill="var(--rink-boot)"/>
    <path d="M -0.36 0.01 H -0.02 M 0.04 0.01 H 0.38" stroke="var(--rink-blade)" stroke-width="0.05" stroke-linecap="round"/>
    <path d="M -0.42 -1.2 H 0.42 L 0.4 -0.18 H 0.06 L 0 -0.7 L -0.06 -0.18 H -0.4 Z" fill="#1d1f22"/>
    <path d="M -0.74 -2 Q -0.76 -2.2 -0.5 -2.2 H 0.5 Q 0.76 -2.2 0.74 -2 L 0.56 -1.16 H -0.56 Z" fill="#f4f4f2" stroke="#1d1f22" stroke-width="0.05"/>
    <path d="M -0.4 -2.18 V -1.18 M -0.13 -2.2 V -1.16 M 0.13 -2.2 V -1.16 M 0.4 -2.18 V -1.18" stroke="#1d1f22" stroke-width="0.12"/>
    <line x1="-0.6" y1="-1.95" x2="-0.74" y2="-1.25" stroke="#f4f4f2" stroke-width="0.24" stroke-linecap="round"/>
    <line data-ref-arm x1="0.6" y1="-1.95" x2="0.74" y2="-1.25" stroke="#f4f4f2" stroke-width="0.24" stroke-linecap="round"/>
    <circle cx="-0.62" cy="-1.86" r="0.12" fill="#f26b1d"/><circle cx="0.62" cy="-1.86" r="0.12" fill="#f26b1d"/>
    <g transform="translate(0 -2.52)">
      <circle cy="0.04" r="0.32" fill="#e8b896"/>
      <path d="M -0.38 0 Q -0.4 -0.4 0 -0.42 Q 0.4 -0.4 0.38 0 L 0.28 -0.06 Q 0 -0.22 -0.28 -0.06 Z" fill="#1d1f22"/>
      <circle cx="-0.11" cy="0.04" r="0.05" fill="#111"/><circle cx="0.11" cy="0.04" r="0.05" fill="#111"/>
    </g></g>`;

  // The referee's signal for a call, as the rule books draw it: fists crossed
  // in front of the chest for interference; a fist struck into the other
  // hand's palm for boarding; an arm along the blue line for offside; arms
  // folded across the chest for icing; a punch to the side for fighting.
  function signalSVG(kind) {
    const arm = (x2, y2, side, cls = "") =>
      `<g class="${cls}"><line x1="${side * 0.6}" y1="-1.95" x2="${x2}" y2="${y2}" stroke="#1d1f22" stroke-width="0.34" stroke-linecap="round"/>
      <line x1="${side * 0.6}" y1="-1.95" x2="${x2}" y2="${y2}" stroke="#f4f4f2" stroke-width="0.24" stroke-linecap="round"/>
      <circle cx="${side * 0.62}" cy="-1.86" r="0.12" fill="#f26b1d"/>
      <circle cx="${x2}" cy="${y2}" r="0.15" fill="#e8b896" stroke="#1d1f22" stroke-width="0.04"/></g>`;
    const arms = {
      interference: arm(0.3, -1.45, -1) + arm(-0.3, -1.45, 1),
      boarding: arm(0.02, -1.55, -1) + arm(0.16, -1.55, 1, "sign-strike"),
      offside: arm(-0.74, -1.2, -1) + arm(1.55, -1.95, 1),
      icing: arm(0.4, -1.78, -1) + arm(-0.4, -1.56, 1),
      fighting: arm(-0.74, -1.2, -1) + arm(1.45, -1.85, 1, "sign-punch"),
    };
    return `<path d="M -0.42 -1.2 H 0.42 L 0.4 -0.18 H 0.06 L 0 -0.7 L -0.06 -0.18 H -0.4 Z" fill="#1d1f22"/>
      <rect x="-0.34" y="-0.2" width="0.3" height="0.18" rx="0.06" fill="#24282e"/><rect x="0.06" y="-0.2" width="0.3" height="0.18" rx="0.06" fill="#24282e"/>
      <path d="M -0.74 -2 Q -0.76 -2.2 -0.5 -2.2 H 0.5 Q 0.76 -2.2 0.74 -2 L 0.56 -1.16 H -0.56 Z" fill="#f4f4f2" stroke="#1d1f22" stroke-width="0.05"/>
      <path d="M -0.4 -2.18 V -1.18 M -0.13 -2.2 V -1.16 M 0.13 -2.2 V -1.16 M 0.4 -2.18 V -1.18" stroke="#1d1f22" stroke-width="0.12"/>
      <g transform="translate(0 -2.52)"><circle cy="0.04" r="0.32" fill="#e8b896"/>
      <path d="M -0.38 0 Q -0.4 -0.4 0 -0.42 Q 0.4 -0.4 0.38 0 L 0.28 -0.06 Q 0 -0.22 -0.28 -0.06 Z" fill="#1d1f22"/>
      <circle cx="-0.11" cy="0.04" r="0.05" fill="#111"/><circle cx="0.11" cy="0.04" r="0.05" fill="#111"/></g>
      ${arms[kind] || ""}`;
  }

  // The players and the referee for the replay in 3D (kamboni.js): each
  // player standing at rest, from the front and from the back (the hands the
  // other way round), then the referee. No shadows: the replay puts those on
  // the ice.
  function replaySprites(game) {
    const tidy = (g) => {
      g.querySelectorAll('[fill="var(--rink-shadow)"], [data-stars], [data-out]').forEach((e) => e.remove());
      return g.innerHTML;
    };
    const set = (e, attrs) => Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, typeof v === "number" ? v.toFixed(2) : v));
    const out = [],
      pose = {};
    const add = (p, i, stance, flip) => {
      const goalie = p.role === "goalie";
      for (const back of [false, true]) {
        const g = el("g", {}),
          hand = (i % 2 ? 1 : -1) * (back ? -1 : 1);
        g.innerHTML = standingSVG(p.team, goalie, skinOf(i), p.number);
        const [ux, uy] = goalie ? setStance(g, stance, flip) : [0, 0];
        const top = goalie ? [0.95 + ux, -1.55 + uy] : [hand * 0.46, -1.58],
          low = goalie ? top : [hand * 0.66, -1.24];
        if (!goalie)
          for (const [side, [hx, hy]] of [
            [-hand, top],
            [hand, low],
          ]) {
            set(g.querySelector(`[data-arm="${side}"]`), { x1: side * 0.62, y1: -1.98, x2: hx, y2: hy });
            set(g.querySelector(`[data-glove="${side}"]`), { cx: hx, cy: hy });
          }
        const [x1, y1, bx] = [top[0] * TALL, top[1] * TALL, goalie ? 0.3 : hand * 1.25];
        setStick(g, x1, y1, bx, -0.02, Math.sign(bx - x1) || hand, goalie);
        g.querySelector("[data-face]").setAttribute("visibility", back ? "hidden" : "visible");
        g.querySelector("[data-back]").setAttribute("visibility", back ? "visible" : "hidden");
        out.push(tidy(g));
      }
    };
    game.players.forEach((p, i) => add(p, i, "ready", 1));
    const ref = el("g", {});
    ref.innerHTML = REF_STAND;
    pose.ref = out.length;
    out.push(tidy(ref));
    // A goalie's other stances after those, so the replay shows the goalie as
    // the game did: the butterfly, and on the post with the pad down to the
    // drawing's left or right (toward the post, as the eye sees it).
    game.players.forEach((p, i) => {
      if (p.role !== "goalie") return;
      pose[i] = { ready: i * 2 };
      for (const [name, stance, flip] of [
        ["butterfly", "butterfly", 1],
        ["postLeft", "post", 1],
        ["postRight", "post", -1],
      ]) {
        pose[i][name] = out.length;
        add(p, i, stance, flip);
      }
    });
    return { cells: out, pose };
  }

  // ——— The Kamboni, from above ———
  // Facing +x, to size: the towel trailing on the ice, the conditioner, the
  // wheels, the snow tank with the name on it, the driver up front on the left
  // at the wheel, a beacon, mirrors and headlights.
  const KAMBONI_TOP = `<rect x="-3.75" y="-1.35" width="0.8" height="2.7" rx="0.2" fill="var(--rink-towel)"/>
    <rect x="-3.05" y="-1.5" width="0.5" height="3" rx="0.15" fill="var(--rink-rz-dark)"/>
    <path d="M -2.05 -1.32 H -1.15 M 1.15 -1.32 H 2.05 M -2.05 1.32 H -1.15 M 1.15 1.32 H 2.05" stroke="var(--rink-boot)" stroke-width="0.22" stroke-linecap="round"/>
    <rect x="-2.6" y="-1.3" width="5.2" height="2.6" rx="0.45" fill="var(--rink-rz)" stroke="var(--rink-rz-edge)" stroke-width="0.06"/>
    <path d="M -2.35 -1.16 H 2.35 M -2.35 1.16 H 2.35" stroke="var(--rink-team-a)" stroke-width="0.09"/>
    <rect x="-2.35" y="-1.02" width="3.3" height="2.04" rx="0.3" fill="var(--rink-rz-tank)" stroke="var(--rink-rz-edge)" stroke-width="0.04"/>
    <text x="-0.7" y="0.19" font-size="0.52" font-weight="700" text-anchor="middle" fill="var(--rink-team-a)">KAMBONI</text>
    <rect x="-2.85" y="0.5" width="0.55" height="0.55" rx="0.14" fill="var(--rink-rz-dark)"/>
    <rect x="1.2" y="0.05" width="1.05" height="0.95" rx="0.2" fill="var(--rink-rz-tank)" stroke="var(--rink-rz-edge)" stroke-width="0.04"/>
    <rect x="1.15" y="-1.08" width="0.8" height="0.92" rx="0.22" fill="var(--rink-visor)"/>
    <ellipse cx="1.5" cy="-0.62" rx="0.3" ry="0.4" fill="var(--rink-team-a)"/>
    <circle cx="1.56" cy="-0.62" r="0.2" fill="#c0392b"/><rect x="1.72" y="-0.74" width="0.16" height="0.24" rx="0.06" fill="#a93226"/>
    <circle cx="2.12" cy="-0.62" r="0.2" fill="none" stroke="var(--rink-stick)" stroke-width="0.07"/>
    <path d="M 1.85 -1.42 H 2.15 M 1.85 1.42 H 2.15" stroke="var(--rink-rz-dark)" stroke-width="0.18" stroke-linecap="round"/>
    <circle data-rz-beacon cx="1.05" cy="-1.12" r="0.16" fill="#f5a623"/>
    <circle cx="2.55" cy="-0.95" r="0.13" fill="#ffd54a"/><circle cx="2.55" cy="0.95" r="0.13" fill="#ffd54a"/>`;

  // The used ice between periods: a frosted film with scratches in it, one
  // tile of them repeated (the same on every visit).
  function frostSVG() {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const d = [];
    for (let i = 0; i < 30; i++) {
      const x = 0.5 + rnd() * 5,
        y = 0.5 + rnd() * 5,
        a = rnd() * Math.PI,
        l = 0.2 + rnd() * 0.5;
      d.push(`M ${x.toFixed(2)} ${y.toFixed(2)} l ${(Math.cos(a) * l).toFixed(2)} ${(Math.sin(a) * l).toFixed(2)}`);
    }
    return `<pattern id="rink-frost" patternUnits="userSpaceOnUse" width="6" height="6">
      <rect width="6" height="6" fill="var(--rink-frost)"/>
      <path d="${d.join(" ")}" stroke="var(--rink-snow)" stroke-width="0.08" stroke-linecap="round"/></pattern>`;
  }

  function build(svg, game, view) {
    // The marks on the ice stay with the ice through a change of view.
    const marks = svg.querySelector("[data-marks]");
    if (marks) marks.remove();
    svg.replaceChildren();
    svg.dataset.view = view;
    svg.camAt = undefined; // a new view: the camera starts where it should be
    svg.netsOff = svg.shine = undefined;
    const plane = el("g", { "data-plane": "" }, svg);
    plane.insertAdjacentHTML("afterbegin", root.rinkSVG ? root.rinkSVG() : "");
    // Fresh ice shines wet for a while after the Kamboni, then freezes.
    plane.insertAdjacentHTML(
      "beforeend",
      `<rect data-sheen x="-30" y="-15" width="60" height="30" rx="${CORNER}" fill="var(--rink-wet)" opacity="0"/>`
    );
    plane.appendChild(marks || el("g", { "data-marks": "", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }));
    // At a faceoff, a ring closing on the dot: the puck drops as it closes.
    el("circle", { "data-drop-ring": "", r: 1, fill: "none", stroke: "#f5a623", "stroke-width": 0.32, opacity: 0 }, plane);
    // A fight's gloves and sticks, dropped on the ice.
    plane.insertAdjacentHTML(
      "beforeend",
      `<g data-dropped style="display: none">
        <path d="M -2.6 1.3 L -0.6 2.2 M 0.8 1.8 L 2.9 0.9" stroke="var(--rink-stick)" stroke-width="0.12" stroke-linecap="round"/>
        <rect x="-1.9" y="0.5" width="0.5" height="0.38" rx="0.12" fill="var(--rink-glove)"/><rect x="-1.2" y="1.5" width="0.5" height="0.38" rx="0.12" fill="var(--rink-glove)"/>
        <rect x="1.1" y="0.7" width="0.5" height="0.38" rx="0.12" fill="var(--rink-glove)"/><rect x="1.8" y="1.7" width="0.5" height="0.38" rx="0.12" fill="var(--rink-glove)"/></g>`
    );
    // In the replay of a foul, round whoever took the penalty.
    el(
      "circle",
      { "data-foul-ring": "", r: 2, fill: "none", stroke: "#e5484d", "stroke-width": 0.28, "stroke-dasharray": "0.7 0.45", style: "display: none" },
      plane
    );
    // Between periods the used ice is frosted over. The frost and the marks
    // are masked away along the Kamboni's track, which shows as wet ice.
    const band = `fill="none" stroke-width="${RZ.width}" stroke-linecap="round" stroke-linejoin="round"`;
    svg.insertAdjacentHTML(
      "beforeend",
      `<defs>${frostSVG()}
        <clipPath id="rink-ice"><rect x="-30" y="-15" width="60" height="30" rx="${CORNER}"/></clipPath>
        <mask id="rink-clean" maskUnits="userSpaceOnUse" x="-31" y="-17" width="62" height="34">
          <rect x="-31" y="-17" width="62" height="34" fill="#fff"/><polyline data-clean ${band} stroke="#000"/></mask></defs>`
    );
    plane.insertAdjacentHTML(
      "beforeend",
      `<g data-resurface style="display: none">
        <rect x="-30" y="-15" width="60" height="30" rx="${CORNER}" fill="url(#rink-frost)" mask="url(#rink-clean)"/>
        <polyline data-clean ${band} stroke="var(--rink-wet)" clip-path="url(#rink-ice)"/></g>`
    );
    svg.insertAdjacentHTML("beforeend", LAMP);
    const trail = { "data-trail": "", fill: "none", stroke: "var(--rink-shot)", "stroke-width": "0.35", "stroke-linecap": "round", opacity: ".45" };
    const ring = {
      "data-you": "",
      r: "1.75",
      fill: "none",
      stroke: "var(--rink-team-a)",
      "stroke-width": "0.2",
      "stroke-dasharray": "0.7 0.45",
      opacity: ".8",
    };
    if (view === "top") {
      svg.setAttribute("viewBox", "-30.6 -16.8 61.2 34.2");
      for (const s of [1, -1])
        el("circle", { "data-lamp": s, cx: s * (GOAL_X + NET_DEPTH * 0.6), cy: 0, r: 3.4, fill: "url(#rink-lamp)", opacity: 0 }, plane);
      el("g", { "data-hats": "" }, plane);
      el("polyline", trail, plane);
      el("circle", { "data-puck": "", r: "0.45", fill: "var(--rink-puck)", stroke: "var(--rink-puck-ring)", "stroke-width": "0.12" }, plane);
      el("circle", ring, plane);
      plane.insertAdjacentHTML("beforeend", `<g data-ref>${REF_TOP}</g>`);
      el("text", { "data-foul-name": "", class: "rink-foul-name", "text-anchor": "middle", "font-size": "0.9", style: "display: none" }, plane);
      const layer = el("g", { "data-players": "" }, plane);
      game.players.forEach((p, i) => {
        el("g", { "data-player": i }, layer).insertAdjacentHTML(
          "beforeend",
          root.helmetSVG(p.team, p.role === "goalie", skinOf(i)) +
            starsSVG(1.5) +
            (p.number ? `<text class="rink-number" y="2.25" font-size="0.95" text-anchor="middle">${p.number}</text>` : "")
        );
      });
      // The Kamboni's gate in the left-hand end boards, open as it drives off.
      plane.insertAdjacentHTML(
        "beforeend",
        `<rect data-gate x="-31" y="${-RZ.gate}" width="1.1" height="${2 * RZ.gate}" rx="0.2" fill="#1c2026" style="display: none"/>
        <g data-rz style="display: none">${KAMBONI_TOP}</g>`
      );
      return;
    }
    // Tilted: the ice and what lies on it are one plane, drawn through the
    // camera's matrix; the boards, nets, players and puck stand on it, drawn in
    // order from the far side to the near one.
    plane.setAttribute("transform", `matrix(${TILT.m.map((v) => v.toFixed(4)).join(" ")} 0 0)`);
    el("polyline", trail, plane);
    el("circle", ring, plane);
    const xs = [],
      ys = [];
    for (const p of outline())
      for (const h of [0, BOARDS]) {
        const [x, y] = TILT.at(p.x, p.y, h);
        xs.push(x);
        ys.push(y);
      }
    const x0 = Math.min(...xs) - 1,
      y0 = Math.min(...ys) - 3.1 * TALL,
      x1 = Math.max(...xs) + 1,
      y1 = Math.max(...ys) + 0.8;
    svg.rinkBox = { x0, y0, x1, y1 };
    svg.setAttribute("viewBox", `${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}`);
    // Behind the far boards, the penalty boxes: whoever is in one shows over them.
    el("g", { "data-boxed": "" }, svg);
    svg.insertAdjacentHTML("beforeend", boardsSVG(true));
    el("g", { "data-hats": "" }, svg);
    const things = el("g", { "data-things": "" }, svg);
    for (const s of [1, -1]) things.insertAdjacentHTML("beforeend", net3SVG(s));
    things.insertAdjacentHTML("beforeend", `<g data-ref data-depth="0">${REF_STAND}</g>`);
    things.insertAdjacentHTML(
      "beforeend",
      `<g data-puck><ellipse cy="0.08" rx="0.45" ry="${(0.45 * SQUASH).toFixed(2)}" fill="var(--rink-puck)"/><ellipse rx="0.45" ry="${(0.45 * SQUASH).toFixed(2)}" fill="var(--rink-puck)" stroke="var(--rink-puck-ring)" stroke-width="0.1"/></g>`
    );
    game.players.forEach((p, i) =>
      el("g", { "data-player": i }, things).insertAdjacentHTML("beforeend", standingSVG(p.team, p.role === "goalie", skinOf(i), p.number))
    );
    svg.insertAdjacentHTML("beforeend", boardsSVG(false));
    el("text", { "data-foul-name": "", class: "rink-foul-name", "text-anchor": "middle", "font-size": "0.9", style: "display: none" }, svg);
    for (const s of [1, -1]) {
      const [cx, cy] = TILT.at(s * (GOAL_X + NET_DEPTH * 0.5), 0, 1.2);
      el("circle", { "data-lamp": s, cx, cy, r: 3.2, fill: "url(#rink-lamp)", opacity: 0 }, svg);
    }
    // Over everything: the puck's outline, so it is never lost behind a
    // player, and an arrow over your skater.
    svg.insertAdjacentHTML(
      "beforeend",
      `<ellipse data-puck-ghost rx="0.45" ry="${(0.45 * SQUASH).toFixed(2)}" fill="none" stroke="var(--rink-puck-ring)" stroke-width="0.11"/>
      <g data-you-arrow><path d="M -0.42 -0.62 L 0.42 -0.62 L 0 0 Z" fill="var(--rink-team-a)" stroke="var(--global-bg-color)" stroke-width="0.09" stroke-linejoin="round"/>
        <text data-you-name y="-0.88" font-size="0.62" font-weight="700" text-anchor="middle" fill="var(--rink-team-a)" stroke="var(--global-bg-color)" stroke-width="0.14" paint-order="stroke"></text></g>`
    );
    // The map: the whole rink from above, small, in the top right corner,
    // with every player, the puck and what the camera is showing.
    const k = 0.115;
    svg.insertAdjacentHTML(
      "beforeend",
      `<g data-map><g transform="scale(${k})">
        <rect x="-31" y="-16" width="62" height="32" rx="9" fill="var(--global-bg-color)" fill-opacity="0.85" stroke="var(--rink-board)" stroke-width="0.8"/>
        <rect data-map-view y="-15" height="30" fill="var(--rink-mark)"/>
        <path d="M 0 -15 V 15 M -26 -13 V 13 M 26 -13 V 13" stroke="var(--rink-red)" stroke-width="0.5"/>
        <path d="M -7.5 -15 V 15 M 7.5 -15 V 15" stroke="var(--rink-blue)" stroke-width="0.6"/>
        ${game.players.map((p, i) => `<circle data-map-player="${i}" r="1.5" fill="var(--rink-team-${p.team})"/>`).join("")}
        <circle data-map-puck r="1" fill="var(--rink-puck)" stroke="var(--rink-puck-ring)" stroke-width="0.4"/></g></g>`
    );
  }

  // The Kamboni (a Resurfacer) and its track, from above, when it is out; the
  // players, the puck and the nets are off the ice then (in the styles, on
  // `is-resurfacing`). From the cab it is kamboni.js that draws it.
  function drawResurfacer(svg, view, rz, now) {
    const out = !!rz && view === "top";
    if (!out && !svg.classList.contains("is-resurfacing")) return; // nothing to undo
    svg.classList.toggle("is-resurfacing", out);
    for (const e of svg.querySelectorAll("[data-rz], [data-resurface]")) e.style.display = out ? "" : "none";
    const marks = svg.querySelector("[data-marks]");
    if (!out) return marks.removeAttribute("mask");
    marks.setAttribute("mask", "url(#rink-clean)");
    // The track as SVG points, added to as it grows.
    const k = svg.rzDrawn && svg.rzDrawn.rz === rz ? svg.rzDrawn : (svg.rzDrawn = { rz, n: 0, points: "" });
    const lines = svg.querySelectorAll("[data-clean]");
    if (k.n < rz.track.length || k.line !== lines[0]) {
      for (; k.n < rz.track.length; k.n++) k.points += `${k.points ? " " : ""}${rz.track[k.n][0].toFixed(2)},${rz.track[k.n][1].toFixed(2)}`;
      lines.forEach((e) => e.setAttribute("points", k.points));
      k.line = lines[0];
    }
    const g = svg.querySelector("[data-rz]");
    g.querySelector("[data-rz-beacon]").setAttribute("opacity", Math.sin(now / 110) > 0 ? "1" : "0.35");
    g.setAttribute("transform", `translate(${rz.x.toFixed(2)} ${rz.y.toFixed(2)}) rotate(${((rz.h * 180) / Math.PI).toFixed(1)})`);
  }

  // After the Kamboni (`fx.fresh`, milliseconds since the teams began to come
  // back): the crew pushes the nets back onto their pegs from behind the goal
  // lines, and the new ice shines wet, then freezes. And its gate (`fx.gate`).
  function freshIce(svg, view, fx) {
    const gate = svg.querySelector("[data-gate]");
    if (gate) gate.style.display = fx.gate ? "" : "none";
    const t = fx.fresh ?? 1e9,
      k = clamp((t - 250) / 1300, 0, 1),
      off = +(1.9 * (1 - k * k * (3 - 2 * k))).toFixed(2),
      shine = +clamp(1 - t / 7000, 0, 1).toFixed(2);
    if (svg.netsOff !== off) {
      svg.netsOff = off;
      for (const n of svg.querySelectorAll(view === "top" ? "[data-rink-net]" : "[data-net]")) {
        const dx = view === "top" ? -off : +n.dataset.net * off;
        if (off) n.setAttribute("transform", `translate(${dx} 0)`);
        else n.removeAttribute("transform");
      }
    }
    if (svg.shine !== shine) {
      svg.shine = shine;
      svg.querySelector("[data-sheen]").setAttribute("opacity", shine);
    }
  }

  // `fx` carries what only the page knows: the view, the time, a lit lamp,
  // the Kamboni when it is out.
  function draw(svg, game, fx = {}) {
    const view = fx.view || "top";
    if (svg.dataset.view !== view) build(svg, game, view);
    const pk = game.puck,
      now = fx.now || 0;
    drawResurfacer(svg, view, fx.rz, now);
    freshIce(svg, view, fx);
    // A fight's dropped gloves and sticks, until the faceoff.
    const dropped = svg.querySelector("[data-dropped]"),
      F = game.fight;
    if (F) svg.fightAt = F.at;
    const showDropped = !!(svg.fightAt && (F || game.phase === "stop"));
    if (!showDropped) svg.fightAt = null;
    dropped.style.display = showDropped ? "" : "none";
    if (showDropped) dropped.setAttribute("transform", `translate(${svg.fightAt[0].toFixed(2)} ${svg.fightAt[1].toFixed(2)})`);
    // A foul's replay: a red ring round who took the penalty, and the name.
    const mk = fx.mark != null ? game.players[fx.mark] : null,
      foulRing = svg.querySelector("[data-foul-ring]"),
      foulName = svg.querySelector("[data-foul-name]");
    foulRing.style.display = foulName.style.display = mk ? "" : "none";
    if (mk) {
      foulRing.setAttribute("cx", mk.x.toFixed(2));
      foulRing.setAttribute("cy", mk.y.toFixed(2));
      if (foulName.textContent !== mk.name) foulName.textContent = mk.name || "";
      const [nx, ny] = view === "top" ? [mk.x, mk.y - 2.5] : TILT.at(mk.x, mk.y, 0);
      foulName.setAttribute("x", nx.toFixed(2));
      foulName.setAttribute("y", (view === "top" ? ny : ny - 3.4 * TALL).toFixed(2));
    }
    const ring = svg.querySelector("[data-drop-ring]"),
      f = game.drop;
    if (game.human && game.phase === "faceoff" && f && f.t >= 0.25 && f.t < f.release + 0.2) {
      const k = clamp((f.release - f.t) / Math.max(0.1, f.release - 0.25), 0, 1);
      ring.setAttribute("cx", (f.at || [0])[0]);
      ring.setAttribute("cy", (f.at || [0, 0])[1]);
      ring.setAttribute("r", (0.55 + 3.4 * k).toFixed(2));
      ring.setAttribute("opacity", f.t < f.release ? "0.95" : (1 - (f.t - f.release) / 0.2).toFixed(2));
      ring.setAttribute("stroke", f.t < f.release ? "#f5a623" : "#fff");
    } else if (ring.getAttribute("opacity") !== "0") ring.setAttribute("opacity", "0");
    // By player, not by place in the drawing: tilted, that order changes.
    const groups = game.players.map((p, i) => svg.querySelector(`[data-player="${i}"]`));
    if (view === "top") {
      game.players.forEach((p, i) => {
        const g = groups[i];
        g.style.display = p.off && !(p.box > 0) ? "none" : "";
        g.setAttribute("transform", `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
        // Everyone watches the puck, except whoever has it, who looks ahead; a
        // player knocked down lies turned, with crosses for eyes and stars.
        const down = p.down > 0;
        const [lx, ly] = pk.carrier === p ? [p.fx, p.fy] : [pk.x - p.x, pk.y - p.y];
        const turn =
          p.role === "goalie" || down
            ? 0
            : (() => {
                const { phase, amp } = strideOf(svg, i, p, fx.now || 0);
                return 0.12 * Math.sin(phase) * amp;
              })();
        root.helmetLook(g, Math.atan2(p.fy, p.fx) + (down ? 1.2 : 0) + turn, lx, ly, down);
        // In a fight: the stick dropped, bare fists, the one punching out ahead.
        const F = game.fight,
          fight = F && (p === F.a || p === F.b) ? F.act[p === F.a ? "a" : "b"] : null,
          stickTop = g.querySelector("[data-stick-top]");
        if (stickTop) {
          stickTop.style.display = fight ? "none" : "";
          for (const fist of g.querySelectorAll("[data-fist]")) {
            fist.setAttribute("fill", fight ? skinOf(i) : "var(--rink-glove)");
            const out =
              fight && fist.dataset.fist === "1" ? (fight.punch > 0 ? "translate(0.85 -0.45)" : fight.wind > 0 ? "translate(-0.45 0.1)" : "") : "";
            if (out) fist.setAttribute("transform", out);
            else fist.removeAttribute("transform");
          }
        }
        if (p.role === "goalie") poseGoalie(g, p, false);
        const stars = g.querySelector("[data-stars]");
        stars.setAttribute("visibility", down ? "visible" : "hidden");
        if (down) stars.setAttribute("transform", `rotate(${((now / 4) % 360).toFixed(0)})`);
      });
      svg
        .querySelector("[data-puck]")
        .setAttribute("transform", `translate(${pk.x.toFixed(2)} ${pk.y.toFixed(2)})${pk.h ? ` scale(${(1 + pk.h * 0.3).toFixed(2)})` : ""}`);
      const r = game.ref;
      svg
        .querySelector("[data-ref]")
        .setAttribute("transform", `translate(${r.x.toFixed(2)} ${r.y.toFixed(2)}) rotate(${((Math.atan2(r.fy, r.fx) * 180) / Math.PI).toFixed(0)})`);
    } else {
      const [px, py] = TILT.at(pk.x, pk.y, pk.h || 0);
      const ref = svg.querySelector("[data-ref]"),
        [rx, ry] = TILT.at(game.ref.x, game.ref.y),
        up = game.ref.arm || 0;
      ref.setAttribute("transform", `translate(${rx.toFixed(2)} ${ry.toFixed(2)})`);
      ref.dataset.depth = ry;
      const arm = ref.querySelector("[data-ref-arm]");
      // A delayed call (offside or a penalty): the arm straight up.
      arm.setAttribute("x2", game.ref.signal ? "0.66" : (0.74 + ((px - rx) / TALL - 0.74) * up).toFixed(2));
      arm.setAttribute("y2", game.ref.signal ? "-3.15" : (-1.25 + ((py - ry) / TALL + 1.25) * up).toFixed(2));
      const boxed = svg.querySelector("[data-boxed]"),
        onIce = svg.querySelector("[data-things]");
      game.players.forEach((p, i) => {
        const g = groups[i];
        g.style.display = p.off && !(p.box > 0) ? "none" : "";
        const home = p.box > 0 ? boxed : onIce;
        if (g.parentNode !== home) home.appendChild(g);
        const [x, y] = TILT.at(p.x, p.y);
        g.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
        g.dataset.depth = y;
        // Which way the player faces, on the screen: the face turns that way,
        // and is hidden when the player skates away up the screen.
        const [fx0, fy0] = TILT.at(p.fx, p.fy),
          fl = hypot(fx0, fy0) || 1;
        const sx = fx0 / fl,
          sy = fy0 / fl,
          down = p.down > 0;
        const [bx, by] = TILT.at(p.fx * REACH, p.fy * REACH);
        // Hands: a skater holds the stick at its side, half the players
        // shooting left and half right, a little toward where it faces; a
        // goalie's stick comes from the blocker.
        const goalie = p.role === "goalie",
          hand = i % 2 ? 1 : -1,
          [ux, uy] = goalie ? poseGoalie(g, p, true) : [0, 0];
        const top = goalie ? [0.95 + ux, -1.55 + uy] : [hand * 0.46 + sx * 0.22, -1.58],
          low = goalie ? top : [hand * 0.66 + sx * 0.3, -1.24];
        // In a fight: no stick, bare fists, one hand on the other's jersey and
        // the other punching (drawn back as it winds up); ducking, lower and
        // back; the jersey pulled over the head.
        const F = game.fight,
          fight = F && (p === F.a || p === F.b) ? F.act[p === F.a ? "a" : "b"] : null;
        g.querySelector("[data-sticks]").style.display = fight ? "none" : "";
        g.querySelector("[data-over]")?.setAttribute("visibility", fight && fight.blind > 0 ? "visible" : "hidden");
        for (const glove of g.querySelectorAll("[data-glove]")) glove.setAttribute("fill", fight ? skinOf(i) : "var(--rink-glove)");
        if (fight && !down) {
          const f = Math.sign(sx) || 1,
            fist = fight.wind > 0 ? [-f * 0.45, -1.9] : fight.punch > 0 ? [f * 1.35, -2.4] : [f * 0.3, -1.72],
            grab = fight.pull > 0 ? [f * 0.7, -1.7] : [f * 1.0, -2.0];
          for (const [sh, [hx, hy]] of [
            [f, grab],
            [-f, fist],
          ]) {
            const arm = g.querySelector(`[data-arm="${sh}"]`);
            arm.setAttribute("x1", sh * 0.62);
            arm.setAttribute("y1", -1.98);
            arm.setAttribute("x2", hx.toFixed(2));
            arm.setAttribute("y2", hy.toFixed(2));
            const glove = g.querySelector(`[data-glove="${sh}"]`);
            glove.setAttribute("cx", hx.toFixed(2));
            glove.setAttribute("cy", hy.toFixed(2));
          }
        } else if (!goalie) {
          for (const [s, [hx, hy]] of [
            [-hand, top],
            [hand, low],
          ]) {
            const arm = g.querySelector(`[data-arm="${s}"]`);
            arm.setAttribute("x1", s * 0.62);
            arm.setAttribute("y1", -1.98);
            arm.setAttribute("x2", hx.toFixed(2));
            arm.setAttribute("y2", hy.toFixed(2));
            const glove = g.querySelector(`[data-glove="${s}"]`);
            glove.setAttribute("cx", hx.toFixed(2));
            glove.setAttribute("cy", hy.toFixed(2));
          }
        }
        // Skating: each skate pushes out to the side in turn and the other
        // comes back lifted; the body leans the way it goes, sways over the
        // gliding skate and bobs; a hockey stop leans back on wide skates.
        let lean = 0,
          sway = 0,
          bob = 0;
        if (fight && !down) {
          if (fight.duck > 0) [lean, bob] = [-(Math.sign(sx) || 1) * 12, 0.35];
          else if (fight.punch > 0) lean = (Math.sign(sx) || 1) * 8;
        } else if (!goalie && !down) {
          const { phase, amp, speed, braking } = strideOf(svg, i, p, fx.now || 0),
            sin = Math.sin(phase);
          for (const side of [-1, 1]) {
            const out = Math.max(0, side * sin) * amp,
              lift = Math.max(0, -side * sin) * amp;
            g.querySelector(`[data-leg="${side}"]`).setAttribute(
              "transform",
              `translate(${(side * (out * 0.22 + (braking ? 0.13 : 0))).toFixed(3)} ${(-lift * 0.1).toFixed(3)})`
            );
          }
          lean = braking ? -sx * 9 : sx * Math.min(9, speed * 1.1);
          sway = -0.05 * sin * amp;
          bob = -0.035 * Math.abs(sin) * amp;
        }
        // The top hand, where the lean and sway have taken it, for the stick.
        const r = (lean * Math.PI) / 180,
          tx = (top[0] * Math.cos(r) - top[1] * Math.sin(r) + sway) * TALL,
          ty = (top[0] * Math.sin(r) + top[1] * Math.cos(r) + bob) * TALL;
        const x1 = down ? sx * 0.6 : tx;
        setStick(g, x1, down ? -0.25 : ty, bx, by, Math.sign(bx - x1) || hand, goalie);
        const lie = down ? (sx >= 0 ? 80 : -80) : 0;
        g.querySelector("[data-figure]").setAttribute(
          "transform",
          lie ? `rotate(${lie})` : lean || sway || bob ? `translate(${sway.toFixed(3)} ${bob.toFixed(3)}) rotate(${lean.toFixed(1)})` : ""
        );
        // Skating away up the screen, the back of the helmet shows instead.
        const away = sy < -0.55 && !down;
        const face = g.querySelector("[data-face]");
        face.setAttribute("visibility", away || (fight && fight.blind > 0) ? "hidden" : "visible");
        g.querySelector("[data-back]").setAttribute("visibility", away ? "visible" : "hidden");
        face.setAttribute("transform", `translate(${(sx * 0.08).toFixed(2)} 0)`);
        // The eyes watch the puck, or look ahead with it.
        const [lx, ly] = pk.carrier === p ? [sx, sy] : [px - x, py - (y - 2.5 * TALL)];
        const ll = hypot(lx, ly) || 1;
        face.querySelectorAll("[data-pupil]").forEach((e) => {
          e.setAttribute("cx", (+e.dataset.cx + (lx / ll) * 0.045).toFixed(3));
          e.setAttribute("cy", (+e.dataset.cy + (ly / ll) * 0.045).toFixed(3));
          // "inherit", not "visible", so a face turned away hides its pupils too.
          e.setAttribute("visibility", down ? "hidden" : "inherit");
        });
        face.querySelectorAll("[data-out]").forEach((e) => e.setAttribute("visibility", down ? "inherit" : "hidden"));
        const stars = g.querySelector("[data-stars]");
        stars.setAttribute("visibility", down ? "visible" : "hidden");
        if (down) {
          const r = (lie * Math.PI) / 180;
          stars.setAttribute(
            "transform",
            `translate(${(Math.sin(r) * 2.4).toFixed(2)} ${(-Math.cos(r) * 2.4).toFixed(2)}) rotate(${((now / 4) % 360).toFixed(0)})`
          );
        }
      });
      const puck = svg.querySelector("[data-puck]");
      puck.setAttribute("transform", `translate(${px.toFixed(2)} ${py.toFixed(2)})`);
      puck.dataset.depth = TILT.at(pk.x, pk.y)[1];
      svg.querySelector("[data-puck-ghost]").setAttribute("transform", `translate(${px.toFixed(2)} ${py.toFixed(2)})`);
      const arrow = svg.querySelector("[data-you-arrow]");
      const here = game.human && !game.controlled.off;
      arrow.style.display = here ? "" : "none";
      if (here) {
        const name = arrow.querySelector("[data-you-name]");
        if (name.textContent !== (game.controlled.name || "")) name.textContent = game.controlled.name || "";
        const [ax, ay] = TILT.at(game.controlled.x, game.controlled.y);
        const lift = 3.25 * TALL + 0.35 + Math.sin(now / 220) * 0.15;
        arrow.setAttribute("transform", `translate(${ax.toFixed(2)} ${(ay - lift).toFixed(2)})`);
      }
      // The camera pans after the puck, a little ahead of it, and stops at the
      // ends of the rink. Without `follow` (the home page) it shows the lot.
      // For a foul's replay it comes in closer (`zoom`) on a point of its own
      // (`focus`), following it up and down the screen as well.
      const box = svg.rinkBox,
        map = svg.querySelector("[data-map]"),
        z = fx.zoom || 1,
        [cx, cy] = fx.focus ? TILT.at(fx.focus[0], fx.focus[1]) : [px + pk.vx * 0.35, py];
      let vx = box.x0,
        vw = box.x1 - box.x0,
        vy = box.y0,
        vh = box.y1 - box.y0;
      if (fx.follow) {
        [vw, vh] = [VIEW * z, (box.y1 - box.y0) * z];
        const want = clamp(cx, box.x0 + vw / 2, box.x1 - vw / 2),
          wantY = clamp(cy - 1.5, box.y0 + vh / 2, box.y1 - vh / 2);
        // Eased, in the animation; a redraw without a time jumps straight there.
        const ease = svg.camAt === undefined || !fx.now || !svg.camT ? 1 : 1 - Math.exp(-clamp((now - svg.camT) / 1000, 0, 0.1) * 3.5);
        svg.camAt = svg.camAt === undefined ? want : svg.camAt + (want - svg.camAt) * ease;
        svg.camY = svg.camY === undefined ? wantY : svg.camY + (wantY - svg.camY) * ease;
        if (fx.now) svg.camT = now;
        vx = svg.camAt - vw / 2;
        if (z < 1) vy = svg.camY - vh / 2;
      }
      svg.setAttribute("viewBox", `${vx.toFixed(2)} ${vy.toFixed(1)} ${vw.toFixed(2)} ${vh.toFixed(1)}`);
      map.style.display = fx.follow && z === 1 ? "" : "none";
      if (fx.follow && z === 1) {
        map.setAttribute("transform", `translate(${(vx + vw - 0.115 * 31 - 0.6).toFixed(2)} ${(box.y0 + 0.115 * 16 + 0.5).toFixed(2)})`);
        const view = map.querySelector("[data-map-view]");
        view.setAttribute("x", (vx / Math.cos(YAW)).toFixed(1));
        view.setAttribute("width", (vw / Math.cos(YAW)).toFixed(1));
        game.players.forEach((p, i) => {
          const dot = map.querySelector(`[data-map-player="${i}"]`);
          dot.style.display = p.off ? "none" : "";
          dot.setAttribute("cx", p.x.toFixed(1));
          dot.setAttribute("cy", p.y.toFixed(1));
          dot.setAttribute("stroke", game.human && p === game.controlled ? "var(--global-text-color)" : "none");
          dot.setAttribute("stroke-width", "0.6");
        });
        const mp = map.querySelector("[data-map-puck]");
        mp.setAttribute("cx", pk.x.toFixed(1));
        mp.setAttribute("cy", pk.y.toFixed(1));
      }
      // Far to near, so whatever is nearer is drawn over what it stands in front of.
      const things = svg.querySelector("[data-things]");
      for (const n of things.querySelectorAll("[data-net]")) n.dataset.depth ??= TILT.at(+n.dataset.net * (GOAL_X + NET_DEPTH / 2), 0)[1];
      const order = [...things.children].sort((a, b) => a.dataset.depth - b.dataset.depth);
      if (order.some((e, i) => things.children[i] !== e)) order.forEach((e) => things.appendChild(e));
    }
    svg.querySelector("[data-trail]").setAttribute("points", pk.trail.map((t) => t.map((v) => v.toFixed(2)).join(",")).join(" "));
    const you = svg.querySelector("[data-you]");
    you.style.display = game.human && !game.controlled.off ? "" : "none";
    if (game.human) you.setAttribute("transform", `translate(${game.controlled.x.toFixed(2)} ${game.controlled.y.toFixed(2)})`);
    // A goal lights its lamp, flickering; the end of a period lights both, green.
    for (const lamp of svg.querySelectorAll("[data-lamp]")) {
      const l = fx.lamp,
        on = l && (!l.side || +lamp.dataset.lamp === l.side) && now < l.until;
      const fill = l && l.green ? "url(#rink-lamp-green)" : "url(#rink-lamp)";
      if (lamp.getAttribute("fill") !== fill) lamp.setAttribute("fill", fill);
      lamp.setAttribute("opacity", on ? (l.green ? 0.75 + 0.2 * Math.sin(now / 240) : 0.55 + 0.35 * Math.sin(now / 80)).toFixed(2) : "0");
    }
    // Hats fall onto the ice, spinning, stay a while and fade: from beyond the
    // far boards seen from above, from the sky when tilted.
    svg.querySelectorAll("[data-hat]").forEach((h) => {
      const age = (now - +h.dataset.t0) / 1000;
      if (age > 8) return h.remove();
      const k = clamp(age / 0.9, 0, 1),
        e = 1 - (1 - k) * (1 - k),
        spin = (+h.dataset.r + (1 - e) * 240).toFixed(0);
      if (view === "top") {
        const y = -19 + (+h.dataset.y + 19) * e;
        h.setAttribute("transform", `translate(${h.dataset.x} ${y.toFixed(2)}) rotate(${spin})`);
      } else {
        const [x, y] = TILT.at(+h.dataset.x, +h.dataset.y, 14 * (1 - e));
        h.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(1 ${SQUASH}) rotate(${spin})`);
      }
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
          // A hockey stop sprays snow as it starts, whenever that is.
          if (p.braking && !m.braking && sp > 3) spray(p, p.vx, p.vy);
          m.braking = p.braking;
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

  // The view the visitor last chose, tilted unless they chose the one from above.
  const chosenView = () => {
    try {
      return localStorage.getItem("hockey-view") === "top" ? "top" : "tilt";
    } catch (e) {
      return "tilt";
    }
  };

  // The home page's piece: the computer against itself, a few seconds in,
  // drawn once, from above whatever view the game was last played in.
  function still(rootEl) {
    const game = lineUp(new Game({ human: false }));
    for (let t = 0; t < 7; t += STEP) game.step(STEP);
    draw(rootEl.querySelector("svg"), game, { view: "top" });
  }

  // ——— Sound: made in the browser, no files ———
  // A puck off a stick, the post, a save, a check and the boards, the goal
  // horn and the crowd, the end-of-period buzzer, the Kamboni's horn. Off when
  // muted (remembered); browsers only start sound after a click or a key.
  function sounds() {
    let ctx = null,
      master = null,
      noiseBuf = null,
      on = true;
    try {
      on = localStorage.getItem("hockey-sound") !== "off";
    } catch (e) {
      // On, then.
    }
    function wake() {
      if (!on) return;
      if (!ctx) {
        const Ctx = root.AudioContext || root.webkitAudioContext;
        if (!Ctx) return;
        ctx = new Ctx();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === "suspended") ctx.resume();
    }
    const env = (t, peak, attack, dur) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(master);
      return g;
    };
    function noise(t, dur, freq, q, peak, type = "bandpass", attack = 0.003) {
      const src = ctx.createBufferSource(),
        f = ctx.createBiquadFilter();
      src.buffer = noiseBuf;
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      src.connect(f);
      f.connect(env(t, peak, attack, dur));
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.05);
    }
    function tone(t, dur, freq, type, peak, attack = 0.005, to = 0, out = null) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      o.connect(out || env(t, peak, attack, dur));
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    const SOUND = {
      stick: (t, hard) => noise(t, hard ? 0.08 : 0.05, hard ? 2600 : 1900, 1.4, hard ? 0.9 : 0.45),
      post: (t) => {
        tone(t, 0.7, 1320, "sine", 0.3);
        tone(t, 0.5, 2650, "sine", 0.12);
      },
      pad: (t) => noise(t, 0.1, 700, 0.7, 0.7, "lowpass"),
      thud: (t, hard) => {
        noise(t, 0.2, 260, 0.7, hard ? 1 : 0.6, "lowpass");
        tone(t, 0.18, 95, "sine", hard ? 0.55 : 0.35, 0.004, 50);
      },
      // The goal horn, an arena's air horn: three trumpets sounding a chord
      // (as the horns arenas buy do, a few hundred hertz each), brassy, for a
      // second and a half, sliding up to pitch as the air comes.
      horn: (t) => {
        const dur = 1.6,
          low = ctx.createBiquadFilter(),
          brass = ctx.createBiquadFilter(),
          g = ctx.createGain();
        low.type = "lowpass";
        low.frequency.value = 2600;
        brass.type = "peaking";
        brass.frequency.value = 1100;
        brass.Q.value = 1;
        brass.gain.value = 6;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.36, t + 0.06);
        g.gain.setValueAtTime(0.36, t + dur - 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        low.connect(brass);
        brass.connect(g);
        g.connect(master);
        for (const hz of [262, 263, 330, 392]) {
          const o = ctx.createOscillator(),
            v = ctx.createGain();
          o.type = "sawtooth";
          o.frequency.setValueAtTime(hz * 0.96, t);
          o.frequency.exponentialRampToValueAtTime(hz, t + 0.1);
          v.gain.value = 0.16;
          o.connect(v);
          v.connect(low);
          o.start(t);
          o.stop(t + dur + 0.05);
        }
      },
      cheer: (t) => noise(t, 2.4, 1100, 0.6, 0.3, "bandpass", 0.35),
      swish: (t) => noise(t, 0.16, 1800, 0.8, 0.22, "highpass", 0.03),
      // Hands clapping all round the arena, a few seconds of it, over a murmur.
      applause: (t) => {
        for (let i = 0; i < 110; i++)
          noise(t + 2.8 * Math.random() ** 1.4, 0.025, 1200 + Math.random() * 2000, 1.1, 0.05 + Math.random() * 0.09, "bandpass", 0.001);
        noise(t, 3, 900, 0.5, 0.07, "bandpass", 0.5);
      },
      // The arena's organ as the teams come out: the old bugle call to charge.
      organ: (t) => {
        for (const [hz, at, len] of [
          [392, 0, 0.13],
          [523, 0.15, 0.13],
          [659, 0.3, 0.13],
          [784, 0.45, 0.32],
          [659, 0.85, 0.13],
          [784, 1, 0.7],
        ])
          for (const [k, type, peak] of [
            [1, "sine", 0.11],
            [2, "sine", 0.045],
            [0.5, "triangle", 0.05],
          ])
            tone(t + at, len, hz * k, type, peak, 0.012);
      },
      click: (t) => noise(t, 0.03, 3200, 2, 0.5),
      // The referee's whistle: a pea whistle's trill, two short blasts.
      whistle: (t) => {
        for (const [at, len] of [
          [0, 0.16],
          [0.22, 0.42],
        ]) {
          const o = ctx.createOscillator(),
            lfo = ctx.createOscillator(),
            depth = ctx.createGain();
          o.type = "sine";
          o.frequency.value = 2950;
          lfo.frequency.value = 28;
          depth.gain.value = 180;
          lfo.connect(depth);
          depth.connect(o.frequency);
          o.connect(env(t + at, 0.16, 0.01, len));
          for (const n of [o, lfo]) {
            n.start(t + at);
            n.stop(t + at + len + 0.05);
          }
          noise(t + at, len, 3000, 2, 0.05, "bandpass", 0.01);
        }
      },
      buzzer: (t) => tone(t, 1.1, 196, "square", 0.12, 0.01),
      beep: (t) => {
        tone(t, 0.14, 440, "square", 0.12);
        tone(t + 0.2, 0.14, 440, "square", 0.12);
      },
    };
    return {
      get on() {
        return on;
      },
      wake,
      toggle() {
        on = !on;
        try {
          localStorage.setItem("hockey-sound", on ? "on" : "off");
        } catch (e) {
          // Not remembered, which is fine.
        }
        if (on) wake();
        else if (ctx) ctx.suspend();
      },
      play(name, arg) {
        if (!on || !ctx || ctx.state !== "running") return;
        try {
          SOUND[name](ctx.currentTime + 0.01, arg);
        } catch (e) {
          // No sound, then.
        }
      },
    };
  }

  function play(rootEl) {
    const svg = rootEl.querySelector("svg");
    const $ = (sel) => rootEl.querySelector(sel);
    const overlay = $("[data-overlay]"),
      title = $("[data-overlay-title]"),
      text = $("[data-overlay-text]"),
      button = $("[data-overlay-button]"),
      alt = $("[data-overlay-alt]");
    const toast = $("[data-toast]"),
      live = $("[data-live]");
    // Three on three or five on five, remembered in this browser.
    let size = 3;
    try {
      size = localStorage.getItem("hockey-size") === "5" ? 5 : 3;
    } catch (e) {
      // Three on three, then.
    }
    let game = lineUp(new Game({ size }));
    // ready, playing, paused, buzzer (a period has just ended), intermission
    // (the choice), resurfacing (the person drives the Kamboni), crew,
    // leaving (the Kamboni drives off), over
    let state = "ready"; // and replay, a goal shown again
    let view = chosenView();
    let lamp = null,
      buzzed = 0,
      period = 1;
    let rz = null, // the Kamboni, between periods
      rzView = "top", // seen from its cab, or from above
      cab; // the cab, made when first wanted; null without WebGL
    // After the Kamboni (state "leaving": it drives itself off through its
    // gate) the view goes dark behind this, and lights again on the teams
    // coming back out (the game's phase "return"); `back` is when they began.
    const curtain = document.createElement("div");
    curtain.className = "game-curtain";
    toast.before(curtain);
    let leaveAt = 0,
      darkAt = 0,
      back = 0,
      organ = false;
    // The running game and the Kamboni, for tests and the console.
    rootEl.hockey = { game: () => game, rz: () => rz, cab: () => cab, view: () => (rz ? rzView : view), state: () => state };
    draw(svg, game, { view, follow: true });
    const marks = skateMarks(svg);
    const sound = sounds();
    // The level, remembered in this browser; chosen on the start and final screens.
    let level = "normal";
    try {
      const v = localStorage.getItem("hockey-level");
      if (v in LEVELS) level = v;
    } catch (e) {
      // Normal, then.
    }
    game.level = level;
    const levels = $("[data-levels]"),
      sizes = $("[data-sizes]");
    function showLevels() {
      levels.hidden = sizes.hidden = false;
      for (const b of levels.querySelectorAll("[data-level]")) b.setAttribute("aria-pressed", b.dataset.level === level);
      for (const b of sizes.querySelectorAll("[data-size]")) b.setAttribute("aria-pressed", +b.dataset.size === size);
    }
    const intro = () => `You are blue: ${lineUpText(game, "a")}. You attack the goal on the right.`;
    const titled = () => (size === 5 ? "Five on five" : "Three on three");
    sizes.addEventListener("click", (e) => {
      const b = e.target.closest("[data-size]");
      if (!b || +b.dataset.size === size) return;
      size = +b.dataset.size;
      try {
        localStorage.setItem("hockey-size", String(size));
      } catch (err) {
        // Not remembered, which is fine.
      }
      // Before the first game, a new one at once, with its line-ups.
      if (state === "ready") {
        newGame();
        draw(svg, game, { view, follow: true });
        show(titled(), intro(), "play");
      }
      showLevels();
    });
    levels.addEventListener("click", (e) => {
      const b = e.target.closest("[data-level]");
      if (!b) return;
      level = b.dataset.level;
      try {
        localStorage.setItem("hockey-level", level);
      } catch (err) {
        // Not remembered, which is fine.
      }
      if (state === "ready") game.level = level;
      showLevels();
    });
    const ordinal = (n) => ["first", "second"][n - 1] || "last";
    const touchy = () => rootEl.classList.contains("is-touch") || matchMedia("(pointer: coarse)").matches;

    function show(t, body, label, other) {
      levels.hidden = sizes.hidden = true;
      title.textContent = t;
      text.textContent = body;
      button.textContent = label;
      alt.textContent = other || "";
      alt.hidden = !other;
      overlay.hidden = false;
    }
    let toastTimer = 0,
      toastSoft = false;
    // `soft`: a faceoff's words, which wait for anything else being said
    // ("Fresh ice", say), though not for each other.
    function say(msg, seconds = 1.6, soft = false) {
      if (soft && !toastSoft && toastTimer > 0.4) return;
      toastSoft = soft;
      toast.textContent = msg;
      toast.hidden = false;
      toastTimer = seconds;
      live.textContent = msg;
    }
    const minutes = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    const board = scoreboard($("[data-board]"));
    function hud() {
      const out = state === "resurfacing" || state === "crew" || state === "leaving",
        lit = lamp && !lamp.green && performance.now() < lamp.until;
      const clock = out
        ? { time: String(Math.floor(100 * rz.part)).padStart(4) }
        : game.overtime
          ? { time: "----", colon: true }
          : boardTime(game.clock);
      const pen = (t) => {
        const left = game.players.filter((p) => p.team === t && p.box > 0).map((p) => p.box);
        return left.length ? Math.ceil(Math.min(...left)) : 0;
      };
      board.set({
        penA: pen("a"),
        penB: pen("b"),
        a: game.score.a,
        b: game.score.b,
        shotsA: game.shots.a,
        shotsB: game.shots.b,
        ...clock,
        caption: out ? "ICE CLEAN %" : "TIME",
        period: game.overtime ? "ot" : ` ${game.period}`,
        blink: state === "buzzer",
        goal: lit ? (lamp.side === 1 ? "a" : "b") : null,
        label: `You ${game.score.a}, computer ${game.score.b}. ${game.overtime ? "Overtime" : `Period ${game.period}, ${minutes(Math.ceil(game.clock))}`}.`,
      });
      $("[data-sound]").textContent = sound.on ? "mute" : "unmute";
      const pauseButton = $("[data-pause]"),
        viewButton = $("[data-view]");
      pauseButton.textContent = { paused: "resume", resurfacing: "let the crew finish", crew: "skip", leaving: "skip" }[state] || "pause";
      viewButton.textContent = out ? (rzView === "cab" ? "view from above" : "from the cab") : view === "tilt" ? "view from above" : "TV camera";
      viewButton.disabled = out && (state === "crew" || state === "leaving" || !cab);
    }

    // The cab, made the first time it is wanted.
    function cabView() {
      if (cab === undefined) {
        try {
          cab =
            (root.KamboniCab &&
              root.KamboniCab($(".game-stage"), { RZ, outline, frost: frostSVG(), goal: { x: GOAL_X, depth: NET_DEPTH, half: NET_HALF } })) ||
            null;
        } catch (e) {
          cab = null;
        }
      }
      return cab;
    }
    // Between periods: the Kamboni from its cab, or the rink from above.
    function showKamboni(now) {
      const inCab = rzView === "cab" && !!cab;
      if (cab) cab.show(inCab);
      rootEl.classList.toggle("is-cab", inCab);
      if (!inCab) draw(svg, game, { view: "top", now, rz });
      fit();
    }
    // Driven as a vehicle in both views: from above too, ↑ is ahead of the
    // driver, not up the screen.
    const controls = () => (touchy() ? "Steer with the stick; push it up to go faster." : "← and → steer. ↑ goes faster, ↓ slower.");
    $("[data-view]").addEventListener("click", () => {
      if (state === "crew") return;
      if (state === "resurfacing") {
        if (!cab) return;
        rzView = rzView === "cab" ? "top" : "cab";
        showKamboni(performance.now());
        say(controls(), 2.6);
        return hud();
      }
      view = view === "tilt" ? "top" : "tilt";
      try {
        localStorage.setItem("hockey-view", view);
      } catch (e) {
        // Not remembered, which is fine.
      }
      draw(svg, game, { view, follow: true, lamp, now: performance.now() });
      fit();
      hud();
    });

    // A new game, with new line-ups (drawn afresh: their numbers are on them).
    function newGame() {
      game = lineUp(new Game({ level, size }));
      tape.length = 0;
      replayAt = 0;
      marks.clear();
      svg.dataset.view = "";
    }
    function start() {
      if (state === "over") newGame();
      if (state === "over" || state === "ready") draw(svg, game, { view, follow: true });
      state = "playing";
      overlay.hidden = true;
      last = null;
      sound.wake();
      fullScreen(true);
      if (cab === undefined) setTimeout(cabView, 300);
      svg.focus({ preventScroll: true });
    }

    // Full screen while it is played: the game fills the window, the rink as
    // big as fits with the scoreboard over it as wide; on a touch screen the
    // stick and buttons sit over the rink's lower corners (in the styles), and
    // the browser goes full screen where a page may ask. × or Esc leave.
    let full = false,
      wentFull = false;
    function fullScreen(on) {
      if (full !== on) {
        full = on;
        rootEl.classList.toggle("is-full", on);
        document.documentElement.classList.toggle("game-full", on);
        if (on && touchy() && document.fullscreenEnabled && !document.fullscreenElement && rootEl.requestFullscreen) {
          rootEl
            .requestFullscreen()
            .then(() => {
              wentFull = true;
              if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {});
            })
            .catch(() => {});
        }
        if (!on && document.fullscreenElement) {
          wentFull = false;
          document.exitFullscreen().catch(() => {});
        }
      }
      fit();
    }
    // The rink as big as the window lets it, the scoreboard still a share of
    // the rink's width (the buttons beside it may use the window's).
    function fit() {
      const stage = $(".game-stage"),
        hudEl = $(".game-hud"),
        boardEl = $("[data-board]");
      if (!full) {
        stage.style.maxWidth = boardEl.style.width = "";
        return;
      }
      const box = svg.viewBox.baseVal,
        aspect = box && box.height ? box.width / box.height : 2,
        keys = touchy() ? 0 : $(".game-keys").offsetHeight + 8;
      // Twice: the scoreboard's height follows its width.
      for (let i = 0; i < 2; i++) {
        const room = innerHeight - hudEl.offsetHeight - keys - 32,
          w = Math.max(240, Math.min(innerWidth - 24, room * aspect));
        stage.style.maxWidth = `${Math.floor(w)}px`;
        boardEl.style.width = `${Math.max(144, Math.floor(w * 0.37))}px`;
      }
    }
    window.addEventListener("resize", fit);
    document.addEventListener("fullscreenchange", () => {
      // Left by the browser (the back button, say): leave it here too.
      if (!document.fullscreenElement && wentFull && full) {
        wentFull = false;
        if (state === "playing") pause();
        fullScreen(false);
      } else fit();
    });
    $("[data-exit]").addEventListener("click", () => {
      if (state === "playing") pause();
      fullScreen(false);
    });
    $("[data-sound]").addEventListener("click", () => {
      sound.toggle();
      hud();
    });

    // The replay: the last seconds of play, kept frame by frame, shown again
    // after a goal (once the lamp has had a moment) in slow motion, then the
    // game carries on. A key or a tap skips it. Where there is WebGL it is
    // seen from the scorer's eyes (kamboni.js draws it), the drawings and the
    // ice made ready just after the goal; otherwise as the game is seen.
    const tape = [],
      badge = $("[data-replay]");
    let replayAt = 0,
      goalAt = 0,
      replay = null,
      replayOf = null; // the scorer and the net, for the eyes
    function record(now) {
      tape.push({
        now,
        players: game.players.map((p) => ({ ...p })),
        puck: { ...game.puck, trail: game.puck.trail.slice(), carrier: game.players.indexOf(game.puck.carrier) },
        controlled: game.players.indexOf(game.controlled),
        ref: { ...game.ref },
      });
      // Twelve seconds: a delayed penalty's foul can be a while before its whistle.
      while (tape.length && now - tape[0].now > 12000) tape.shift();
    }
    function prepareReplay(ev) {
      replayOf = { by: ev.by, goalX: (Math.sign(game.puck.x) || 1) * (GOAL_X + NET_DEPTH / 2) };
      // A moment later, so the goal itself is not held up.
      setTimeout(() => {
        try {
          if (cabView()) {
            const { cells, pose } = replaySprites(game);
            cab.prepareReplay(cells, svg.querySelector("[data-marks]"), pose);
          } else replayOf = null;
        } catch (e) {
          replayOf = null;
        }
      }, 150);
    }
    function startReplay(now) {
      replayAt = 0;
      if (tape.length < 10) return;
      state = "replay";
      const from = Math.max(tape[0].now, goalAt - 2200);
      replay = { from, to: goalAt + 350, t: from, last: now, i: 0, eyes: !!(replayOf && cab && cab.replayReady) };
      badge.hidden = false;
      if (replay.eyes) {
        cab.mode("replay");
        cab.show(true);
      }
    }
    function endReplay() {
      if (replay && replay.eyes && cab) {
        cab.show(false);
        cab.mode("cab");
      }
      const after = replay && replay.call;
      state = "playing";
      replay = null;
      badge.hidden = true;
      svg.camAt = svg.camY = undefined;
      last = null;
      if (after) showCall(after);
    }
    // A penalty's whistle: first the foul again, slowed down, the camera on
    // whoever took it (ringed in red); then the call. Mertcan found penalties
    // went by too fast to tell what had happened.
    let foulSeen = null;
    function startFoulReplay(now, call) {
      const f = foulSeen;
      foulSeen = null;
      if (!f || f.by !== call.by || tape.length < 10 || f.at - 1400 < tape[0].now) return false;
      state = "replay";
      replay = { foul: f, call, to: f.at + 700, t: f.at - 1400, last: now, i: 0, eyes: false };
      svg.camAt = svg.camY = undefined;
      badge.hidden = false;
      return true;
    }
    // The call, on a card over the rink while play is stopped: the referee's
    // signal, what it was, who, why, and what comes of it.
    const card = $("[data-call]");
    function showCall(ev) {
      const p = game.players[ev.by],
        yours = ev.team === "a",
        who = p ? `${p.number ? `#${p.number} ` : ""}${p.name || ""}, ${yours ? "your team" : "the computer"}` : yours ? "Your team" : "The computer";
      if (ev.why === "fight") {
        const q = game.players[ev.b],
          w = game.players[ev.winner];
        card.querySelector("[data-call-sign]").innerHTML = signalSVG("fighting");
        card.querySelector("[data-call-what]").textContent = "Fighting";
        card.querySelector("[data-call-who]").textContent = `${p.name} and ${q.name}${w ? `: ${w.name} won it` : ""}`;
        card.querySelector("[data-call-why]").textContent =
          "15 s each in the box (five minutes in the NHL; under the IIHF's rules both would be out of the game).";
        card.querySelector("[data-call-then]").textContent = "Both teams a skater short.";
        card.hidden = false;
        live.textContent = `Fighting: ${p.name} and ${q.name}. 15 s each in the box.`;
        return;
      }
      const [kind, what, why, then] =
        ev.why === "offside"
          ? ["offside", "Offside", "Went into the zone ahead of the puck.", "Faceoff outside the blue line."]
          : ev.why === "icing"
            ? [
                "icing",
                "Icing",
                "Sent the puck from behind the centre line over the far goal line, and nobody touched it.",
                "Faceoff in their own end.",
              ]
            : [
                ev.foul,
                `Penalty: ${ev.foul}`,
                ev.foul === "boarding" ? "Checked a player from behind into the boards." : "Checked a player who did not have the puck.",
                yours ? "10 s in the box: you are a skater short." : "10 s in the box: a power play for you.",
              ];
      card.querySelector("[data-call-sign]").innerHTML = signalSVG(kind);
      card.querySelector("[data-call-what]").textContent = what;
      card.querySelector("[data-call-who]").textContent = who;
      card.querySelector("[data-call-why]").textContent = why;
      card.querySelector("[data-call-then]").textContent = then;
      card.hidden = false;
      live.textContent = `${what}. ${who}. ${why} ${then}`;
    }
    // Between two frames of the tape, for a smooth slow motion; whatever
    // jumped (to a faceoff) is not slid across.
    function between(a, b, u) {
      if (u <= 0 || a === b) return a;
      const mix = (p, q) => {
        if (!q || Math.abs(q.x - p.x) + Math.abs(q.y - p.y) > 4) return p;
        const o = { ...p, x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u };
        if ("fx" in p) {
          const fx = p.fx + (q.fx - p.fx) * u,
            fy = p.fy + (q.fy - p.fy) * u,
            l = hypot(fx, fy) || 1;
          [o.fx, o.fy] = [fx / l, fy / l];
        }
        if ("h" in p) o.h = p.h + (q.h - p.h) * u;
        return o;
      };
      return { ...a, players: a.players.map((p, i) => mix(p, b.players[i])), puck: mix(a.puck, b.puck), ref: mix(a.ref, b.ref) };
    }
    function showReplay(now) {
      // Half speed, slowing to under a third for the shot and the goal (for a
      // foul, a little under half, and a third at the hit).
      const k = replay.foul ? Math.max(0, 1 - Math.abs(replay.t - replay.foul.at) / 500) : Math.min(1, Math.max(0, (replay.t - goalAt + 1500) / 600));
      replay.t += Math.min(50, now - replay.last) * ((replay.foul ? 0.45 : 0.5) - (replay.foul ? 0.13 : 0.22) * k * k * (3 - 2 * k));
      replay.last = now;
      if (replay.t >= replay.to) return endReplay();
      while (replay.i < tape.length - 1 && tape[replay.i + 1].now <= replay.t) replay.i++;
      const a = tape[replay.i],
        b = tape[replay.i + 1] || a,
        snap = between(a, b, b.now > a.now ? Math.min(1, (replay.t - a.now) / (b.now - a.now)) : 0);
      if (replay.eyes) return cab.replayFrame(snap, replayOf.by, replayOf.goalX, now, replay.t >= goalAt);
      const players = snap.players;
      if (replay.foul) {
        const by = players[replay.foul.by];
        return draw(
          svg,
          { players, puck: { ...snap.puck, carrier: players[snap.puck.carrier] || null }, human: false, controlled: by, ref: snap.ref },
          { view, now: replay.t, follow: true, zoom: 0.62, focus: by ? [by.x, by.y] : null, mark: replay.foul.by }
        );
      }
      draw(
        svg,
        {
          players,
          puck: { ...snap.puck, carrier: players[snap.puck.carrier] || null },
          human: game.human,
          controlled: players[snap.controlled] || players[0],
          ref: snap.ref,
        },
        { view, now, follow: true }
      );
    }
    function pause() {
      if (state !== "playing") return;
      state = "paused";
      show("Paused", "The computer is waiting. Patiently, for now.", "resume");
      hud();
    }
    // Buttons give focus back, so Space shoots instead of pressing them again.
    rootEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => b.blur()));
    button.addEventListener("click", () => (state === "intermission" ? resurface() : start()));
    alt.addEventListener("click", () => state === "intermission" && crew());

    // The end of a period: the green lights behind the nets (time is up, as in
    // a real arena), and the players skate off to their benches; then the choice.
    function buzzer(ev, now) {
      state = "buzzer";
      buzzed = now;
      period = ev.period;
      lamp = { green: true, until: now + 3400 };
      say(`End of the ${ordinal(ev.period)} period.`, 3);
    }
    function intermission() {
      state = "intermission";
      rz = null;
      show(
        `End of the ${ordinal(period)} period`,
        `The crew has taken the nets off. Drive the Kamboni until ${Math.round(RZ.done * 100)}% of the ice is clean, or let the crew do it.`,
        "drive the Kamboni",
        "let the crew do it"
      );
      hud();
    }
    // The person drives: from the cab, whichever view the game was in (from
    // above if there is no WebGL, or the cab fails). It waits for them.
    function resurface() {
      overlay.hidden = true;
      rz = new Resurfacer();
      rz.started = false;
      rzView = cabView() ? "cab" : "top";
      try {
        if (cab) cab.start(rz, svg.querySelector("[data-marks]"));
      } catch (e) {
        if (cab) cab.show(false);
        cab = null;
        rzView = "top";
      }
      state = "resurfacing";
      last = null;
      showKamboni(performance.now());
      svg.focus({ preventScroll: true });
      say(controls(), 3.2);
      hud();
    }
    // The crew drives the rows they always drive, from above and ten times as
    // fast as life; any key or a tap skips to the end.
    function crew() {
      overlay.hidden = true;
      const took = state === "resurfacing";
      if (!rz) rz = new Resurfacer();
      state = "crew";
      rzView = "top";
      showKamboni(performance.now());
      say(took ? "The crew takes over." : "The crew is on it.", 2.2);
      hud();
    }
    function endResurfacing(byCrew) {
      let msg = rz && rz.started ? "The crew finished it. Fresh ice." : "The crew did it. Fresh ice.";
      if (!byCrew && rz) {
        // The time it took, against the best in this browser.
        const t = Math.round(rz.time);
        let best = 0;
        try {
          best = +localStorage.getItem("kamboni-best") || 0;
          if (!best || t < best) localStorage.setItem("kamboni-best", t);
        } catch (e) {
          // Not remembered, which is fine.
        }
        msg = `Fresh ice, in ${minutes(t)}.` + (best && t < best ? " Your best yet." : best ? ` Best: ${minutes(best)}.` : "");
      }
      // Off the ice by itself, twice as fast as life, out through its gate
      // to applause (the crew's from above); then the dark, and the teams.
      state = "leaving";
      leaveAt = performance.now();
      darkAt = 0;
      if (!cab) rzView = "top";
      if (cab) cab.gate(true);
      overlay.hidden = true;
      showKamboni(leaveAt);
      say(msg, 3);
      sound.play("applause");
      hud();
    }
    function leavingStep(dt, now) {
      // Twice as fast as life to the gate, then in at its own pace.
      for (let i = 0; i < (rz.through ? 1 : 2); i++) if (rz.driveOff(dt)) break;
      // Dark as it drives in at the gate (or anyhow after a while).
      if (!darkAt && ((rz.lined && rz.x < -20) || rz.through || now - leaveAt > 6000)) {
        darkAt = now;
        curtain.classList.add("is-down");
      }
      if (darkAt && now - darkAt > 1100) return teamsBack(now);
      // From the cab, nothing past the gate (inside the stands) is drawn.
      if (rzView === "cab" && cab) {
        if (rz.x > -28.8) cab.frame(now);
      } else draw(svg, game, { view: "top", now, rz, gate: true });
    }
    // In the dark: the Kamboni put away, the ice fresh; then the light comes
    // up on the teams coming back out (see draw() for the nets and the shine).
    function teamsBack(now) {
      if (cab) {
        cab.show(false);
        cab.gate(false);
      }
      rootEl.classList.remove("is-cab");
      rz = null;
      darkAt = 0;
      marks.clear();
      game.nextPeriod();
      state = "playing";
      back = now;
      organ = false;
      last = null;
      draw(svg, game, { view, follow: true, now, fresh: 0 });
      fit();
      curtain.classList.remove("is-down");
      say(`The teams come back out for the ${ordinal(game.period)} period.`, 3);
      hud();
    }
    // A key or a tap, while the Kamboni leaves or the teams come back: on to
    // the faceoff. The press is not taken for the faceoff as well.
    function skipToFaceoff() {
      if (state === "leaving") teamsBack(performance.now());
      if (game.phase === "return") game.faceoff();
      back = performance.now() - 1e4;
      organ = true;
      presses.shoot = presses.pass = presses.check = false;
    }
    function resurfaceStep(dt) {
      if (state === "crew") {
        for (let i = 0; i < 10 && !rz.done; i++) rz.step(dt, rz.autopilot());
        if (rz.done) endResurfacing(true);
        return;
      }
      // Space (or shoot) is the horn.
      const inp = input(false);
      if (inp.shoot) {
        say("Beep beep.", 0.7);
        sound.play("beep");
      }
      if (!rz.started && !inp.x && !inp.y) return;
      rz.started = true;
      rz.step(dt, { drive: true, steer: inp.x, throttle: -inp.y });
      if (rz.bonk) {
        say("Bonk.", 0.7);
        sound.play("thud", true);
      }
      if (rz.done) endResurfacing(false);
    }
    $("[data-pause]").addEventListener("click", () =>
      state === "playing"
        ? pause()
        : state === "paused"
          ? start()
          : state === "resurfacing"
            ? crew()
            : state === "crew"
              ? endResurfacing(true)
              : state === "leaving"
                ? skipToFaceoff()
                : null
    );
    $("[data-restart]").addEventListener("click", () => {
      if (state === "replay") endReplay();
      newGame();
      rz = null;
      lamp = null;
      if (cab) {
        cab.show(false);
        cab.gate(false);
      }
      rootEl.classList.remove("is-cab");
      curtain.classList.remove("is-down");
      back = darkAt = 0;
      draw(svg, game, { view, follow: true });
      state = "playing";
      overlay.hidden = true;
      toast.hidden = true;
      last = null;
      hud();
    });
    document.addEventListener("visibilitychange", () => document.hidden && pause());
    $(".game-stage").addEventListener("pointerdown", () =>
      state === "crew"
        ? endResurfacing(true)
        : state === "replay"
          ? endReplay()
          : state === "leaving" || (state === "playing" && game.phase === "return")
            ? skipToFaceoff()
            : state === "playing" && game.phase === "stop"
              ? (game.skipStop(), (card.hidden = true))
              : null
    );

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
      sound.wake();
      const busy =
        state === "playing" || state === "buzzer" || state === "resurfacing" || state === "crew" || state === "replay" || state === "leaving";
      if (busy && GAME_KEYS.includes(e.code)) e.preventDefault();
      // The crew at work: any key skips to the end.
      if (state === "crew" && !e.repeat && (GAME_KEYS.includes(e.code) || e.code === "Enter" || e.code === "Escape")) return endResurfacing(true);
      // Play stopped for a call: C close to an opponent drops the gloves; any
      // other key goes on to the faceoff.
      if (state === "playing" && game.phase === "stop" && !e.repeat && (GAME_KEYS.includes(e.code) || e.code === "Enter")) {
        e.preventDefault();
        if ((e.code === "KeyC" || e.code === "KeyL") && game.challenge()) return (card.hidden = true);
        game.skipStop();
        card.hidden = true;
        presses.shoot = presses.pass = presses.check = false;
        return;
      }
      // The Kamboni leaving, or the teams coming back: any key goes on to the faceoff.
      if (
        (state === "leaving" || (state === "playing" && game.phase === "return")) &&
        !e.repeat &&
        (GAME_KEYS.includes(e.code) || e.code === "Enter")
      ) {
        e.preventDefault();
        return skipToFaceoff();
      }
      // A goal shown again: any key skips it.
      if (state === "replay" && !e.repeat && (GAME_KEYS.includes(e.code) || e.code === "Enter" || e.code === "Escape")) {
        e.preventDefault();
        return endReplay();
      }
      if (e.code === "Escape" && full) {
        if (state === "playing") pause();
        return fullScreen(false);
      }
      if (e.code === "KeyP" || e.code === "Escape") return state === "playing" ? pause() : state === "paused" ? start() : null;
      // Enter or Space take the overlay's first button, unless a button has
      // the focus (it then takes the key itself).
      const go = (e.code === "Enter" || e.code === "Space") && !(e.target.closest && e.target.closest("button"));
      if (go && state === "intermission") {
        e.preventDefault();
        return resurface();
      }
      if (go && (state === "ready" || state === "over" || state === "paused")) {
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

    // Not just [data-stick]: the players in the rink hold sticks too.
    const stickPad = $(".game-touch [data-stick]"),
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
        sound.wake();
        if (state === "leaving" || (state === "playing" && game.phase === "return")) skipToFaceoff();
        else if (state === "playing" || state === "resurfacing") presses[name] = true;
        else if (state === "crew") endResurfacing(true);
        else if (state === "replay") endReplay();
        else if (state === "intermission") resurface();
        else if (state !== "buzzer") start();
      });
    }

    // The keys and the stick, as directions on the screen; `onIce`, as
    // directions on the ice (in the TV camera's view those are not the same).
    function input(onIce) {
      let x = touch.x,
        y = touch.y;
      if (keys.has("ArrowLeft") || keys.has("KeyA")) x -= 1;
      if (keys.has("ArrowRight") || keys.has("KeyD")) x += 1;
      if (keys.has("ArrowUp") || keys.has("KeyW")) y -= 1;
      if (keys.has("ArrowDown") || keys.has("KeyS")) y += 1;
      let l = hypot(x, y);
      if (l > 1) [x, y, l] = [x / l, y / l, 1];
      if (onIce && view === "tilt" && l > 0) {
        const [ix, iy] = TILT.back(x, y),
          il = hypot(ix, iy);
        [x, y] = [(ix / il) * l, (iy / il) * l];
      }
      const out = {
        x,
        y,
        shoot: presses.shoot,
        pass: presses.pass,
        check: presses.check,
        duck: keys.has("ArrowDown") || keys.has("KeyS") || touch.y > 0.5,
      };
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
      if (state === "resurfacing" || state === "crew") {
        resurfaceStep(dt);
        if (state === "resurfacing" || state === "crew") {
          if (rzView === "cab" && cab) cab.frame(now);
          else draw(svg, game, { view: "top", now, rz });
          hud();
          return;
        }
      }
      if (state === "leaving") {
        leavingStep(dt, now);
        hud();
        return;
      }
      if (state === "replay") return showReplay(now);
      if (state === "playing" && replayAt && now >= replayAt) {
        startReplay(now);
        if (state === "replay") return showReplay(now);
      }
      // Once the players are off and the lights have had their moment, the choice.
      if (state === "buzzer" && game.benched && now - buzzed > 2600) intermission();
      if (state !== "playing" && state !== "buzzer") return;
      spare += dt;
      // Presses count once, in the first step of the frame.
      const held = input(true);
      let first = true;
      while (spare >= STEP) {
        game.step(STEP, first ? held : { x: held.x, y: held.y });
        first = false;
        spare -= STEP;
      }
      // No step this frame (on a fast screen that happens): keep the presses.
      if (first) for (const k of ["shoot", "pass", "check"]) presses[k] = presses[k] || held[k];
      if (state === "playing") record(now);
      if (!card.hidden && (state !== "playing" || game.phase !== "stop")) card.hidden = true;
      const you = game.players.indexOf(game.controlled);
      for (const ev of game.events.splice(0)) {
        sfx(ev);
        if (ev.type === "goal") {
          lamp = { side: ev.team === "a" ? 1 : -1, until: now + 2400 };
          [goalAt, replayAt] = [now, now + 1500];
          prepareReplay(ev);
          const name = (game.players[ev.by] || {}).name;
          let msg = name ? pick(QUIPS[ev.team]).replace("%", name) : ev.team === "a" ? "Goal!" : "The computer scores.";
          if (ev.hatTrick && ev.team === "a") {
            msg = `Hat trick for ${name}! Hats on the ice.`;
            throwHats(svg, now);
          } else if (ev.hatTrick) msg = `Hat trick for ${name}. Nobody throws a hat.`;
          else if (ev.own && name) msg = ev.team === "a" ? `Goal! Off ${name}'s skate.` : `Own goal by ${name}. It happens.`;
          else if (ev.own) msg = ev.team === "a" ? "Goal! Off a computer skate." : "Own goal. It happens.";
          else if (ev.oneTimer && ev.team === "a") msg = `One-timer goal! ${name}.`;
          say(ev.overtime ? (ev.team === "a" ? "Overtime winner! " : "Overtime goal. ") + msg : msg, 2.3);
        } else if (ev.type === "hit") {
          const by = game.players[ev.by].name,
            on = game.players[ev.on].name;
          if (ev.by === you) say(ev.boards ? `${on} into the boards!` : `Checked ${on}!`, 1.2);
          else if (ev.on === you) say(ev.boards ? `${by} puts you into the boards. Ouch.` : `Ouch. ${by} got you.`, 1.2);
        } else if (ev.type === "fight") {
          const [a, b] = [game.players[ev.a], game.players[ev.b]];
          say(`The gloves are off: ${a.name} and ${b.name}.`, 2.4);
          sound.play("cheer");
        } else if (ev.type === "punch") sound.play(ev.landed ? "thud" : "swish", ev.landed);
        else if (ev.type === "pull") {
          sound.play("swish");
          if (ev.blind) say(ev.team === "a" ? "Jersey over the head!" : "Your jersey is over your head!", 1);
        } else if (ev.type === "fight-end") {
          const w = game.players[ev.winner];
          say(w ? `${w.name} wins the fight.` : "The linesmen step in: nobody won.", 2.2);
          sound.play("cheer");
        } else if (ev.type === "whistle") {
          sound.play("whistle");
          toast.hidden = true;
          if (!(ev.why === "penalty" && startFoulReplay(now, ev))) showCall(ev);
        } else if (ev.type === "delayed" || ev.type === "back") {
          if (ev.type === "delayed" && ev.why === "penalty") foulSeen = { at: now, by: ev.by, on: ev.on };
          const said = ruled(ev, (game.players[ev.by] || {}).name || "");
          if (said) say(said, 2.4, true);
        } else if (ev.type === "shot" && ev.oneTimer && ev.you) say("One-timer!", 0.8);
        else if (ev.type === "post") say("Off the post!", 1);
        else if (ev.type === "overtime") say("Tied. Next goal wins.", 2.5);
        else if (ev.type === "faceoff" && ev.n <= 2)
          say(touchy() ? "Faceoff: tap pass as the ring closes." : "Faceoff: press X as the ring closes.", 2.4, true);
        else if (ev.type === "draw")
          say(
            ev.team === "a" ? "You win the draw." : ev.why === "early" ? "Too early: wait for the drop." : "Too slow: the computer wins the draw.",
            1.4,
            true
          );
        else if (ev.type === "intermission") buzzer(ev, now);
        else if (ev.type === "final") {
          state = "over";
          const { a, b } = ev.score;
          const star = game.players.reduce((best, p) => (p.goals > (best ? best.goals : 0) ? p : best), null);
          const verdict = a > b ? "You win. The computer would like a rematch." : "The computer wins. It says good game, and means it.";
          show(
            `You ${a}, computer ${b}`,
            verdict + (star ? ` Star of the game: ${star.name}, ${star.goals} goal${star.goals > 1 ? "s" : ""}.` : ""),
            "play again"
          );
          showLevels();
        }
      }
      marks.update(game, now);
      // The teams back out: the organ plays them on, and the crowd.
      if (back && !organ && now - back > 900) {
        organ = true;
        sound.play("organ");
        sound.play("cheer");
      }
      if (back && now - back > 8000) back = 0;
      draw(svg, game, {
        now,
        lamp,
        view,
        follow: true,
        fresh: back ? now - back : null,
        ...(game.fight ? { zoom: 0.55, focus: game.fight.at } : {}),
      });
      showFight();
      hud();
    }
    // A fight: each fighter's balance, and the keys.
    const fightBox = $("[data-fight]");
    function showFight() {
      const F = game.fight;
      if (!F) {
        if (!fightBox.hidden) fightBox.hidden = true;
        return;
      }
      if (fightBox.hidden) {
        for (const k of ["a", "b"]) {
          const p = F[k];
          fightBox.querySelector(`[data-fight-name="${k}"]`).textContent = `${p.number ? `#${p.number} ` : ""}${p.name || ""}`;
        }
        fightBox.querySelector("[data-fight-keys]").textContent = touchy()
          ? "Shoot punches · pull the stick down to duck · Pass pulls the jersey"
          : "Space punches · ↓ ducks · X pulls the jersey";
        fightBox.hidden = false;
      }
      for (const k of ["a", "b"]) fightBox.querySelector(`[data-fight-bar="${k}"]`).style.width = `${Math.max(0, F.bal[k])}%`;
    }
    // The rules, in a few words. `ev.team` is the team that broke one.
    function ruled(ev, name) {
      const yours = ev.team === "a";
      if (ev.type === "back") return `${name} is back from the box.`;
      if (ev.type === "delayed")
        return ev.why === "offside"
          ? yours
            ? "Delayed offside: everyone out of the zone to tag up."
            : ""
          : yours
            ? `Delayed penalty on ${name}.`
            : "Delayed penalty on the computer: keep the puck.";
      if (ev.why === "offside")
        return yours ? `Offside: ${name} went into the zone ahead of the puck.` : `Offside against the computer: ${name} was in ahead of the puck.`;
      if (ev.why === "icing")
        return yours ? "Icing: from your own half over their goal line. Faceoff in your end." : "Icing by the computer. Faceoff in its end.";
      const what = ev.foul === "boarding" ? "boarding: a check from behind into the boards" : "interference: a check on someone without the puck";
      return yours ? `${name}, ${what}. 10 s in the box: a skater short.` : `${name}, ${what}. 10 s in the box: a power play for you.`;
    }
    // What each event sounds like.
    function sfx(ev) {
      if (ev.type === "pass" || ev.type === "draw") sound.play("stick", false);
      else if (ev.type === "release") sound.play("click");
      else if (ev.type === "shot") sound.play("stick", true);
      else if (ev.type === "post") sound.play("post");
      else if (ev.type === "save" || ev.type === "block") sound.play("pad");
      else if (ev.type === "hit") sound.play("thud", ev.boards);
      else if (ev.type === "goal") {
        sound.play("horn");
        if (ev.team === "a") sound.play("cheer");
      } else if (ev.type === "intermission" || ev.type === "final") sound.play("buzzer");
    }

    hud();
    show(titled(), intro(), "play");
    showLevels();
    requestAnimationFrame(frame);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-game]").forEach((e) => (e.dataset.game === "still" ? still(e) : play(e)));
  });
})(typeof window !== "undefined" ? window : globalThis);
