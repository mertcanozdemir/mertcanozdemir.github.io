// Drill diagrams: draws an IIHF rink and animates each drill from _data/drills.yml.
// Rink coordinates: centre ice (0,0), x ±30 m, y ±15 m.

(function () {
  const PASS_SPEED = 16; // m/s; a pass takes distance / speed, within the limits below
  const PASS_SECONDS = [0.45, 1.4];
  const SHOT_SECONDS = 0.35;

  function rinkSVG() {
    const L = 30,
      W = 15,
      R = 8.5;
    const blue = 7.5,
      goal = L - 4;
    const p = [];
    p.push(`<rect x="${-L}" y="${-W}" width="${L * 2}" height="${W * 2}" rx="${R}" ry="${R}"
      fill="var(--rink-ice)" stroke="var(--rink-board)" stroke-width="0.3"/>`);

    // Outside the boards, as on the IIHF coaching pad: penalty boxes either
    // side of the scorer on the far side, team benches on the near side.
    const box = (x, y, w, h) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="var(--rink-bench)" stroke="var(--rink-board)" stroke-width="0.1"/>`;
    p.push(box(-8.2, -W - 1.4, 4.2, 1.2), box(-4, -W - 1.4, 8, 1.2), box(4, -W - 1.4, 4.2, 1.2));
    p.push(box(-12.5, W + 0.25, 10.5, 1.5), box(2, W + 0.25, 10.5, 1.5));
    p.push(`<path d="M -3 ${-W} A 3 3 0 0 0 3 ${-W}" fill="none" stroke="var(--rink-red)" stroke-width="0.08"/>`);
    [-1, 1].forEach((s) => {
      const dy = Math.sqrt(Math.max(0, R * R - Math.pow(R - (L - goal), 2)));
      const y = W - R + dy;
      p.push(`<line x1="${s * goal}" y1="${-y}" x2="${s * goal}" y2="${y}"
        stroke="var(--rink-red)" stroke-width="0.12"/>`);
    });
    [-1, 1].forEach((s) =>
      p.push(`<line x1="${s * blue}" y1="${-W}" x2="${s * blue}" y2="${W}"
        stroke="var(--rink-blue)" stroke-width="0.3"/>`)
    );
    p.push(`<line x1="0" y1="${-W}" x2="0" y2="${W}" stroke="var(--rink-red)" stroke-width="0.3"/>`);
    p.push(`<circle cx="0" cy="0" r="4.5" fill="none" stroke="var(--rink-blue)" stroke-width="0.12"/>`);
    p.push(`<circle cx="0" cy="0" r="0.3" fill="var(--rink-blue)"/>`);
    [
      [-20, -7],
      [-20, 7],
      [20, -7],
      [20, 7],
    ].forEach(([x, y]) => {
      p.push(`<circle cx="${x}" cy="${y}" r="4.5" fill="none" stroke="var(--rink-red)" stroke-width="0.12"/>`);
      p.push(`<circle cx="${x}" cy="${y}" r="0.3" fill="var(--rink-red)"/>`);
      // Hash marks on the circle, and the L-shaped marks around the spot.
      const marks = [];
      [-1, 1].forEach((sx) =>
        [-1, 1].forEach((sy) => {
          const hx = x + sx * 0.9,
            hy = y + sy * Math.sqrt(4.5 * 4.5 - 0.9 * 0.9);
          marks.push(`M ${hx} ${hy} V ${hy + sy * 0.6}`);
          marks.push(`M ${x + sx * 0.6} ${y + sy * 1.1} V ${y + sy * 0.45} H ${x + sx * 1.8}`);
        })
      );
      p.push(`<path d="${marks.join(" ")}" fill="none" stroke="var(--rink-red)" stroke-width="0.08"/>`);
    });
    [
      [-5, -7],
      [-5, 7],
      [5, -7],
      [5, 7],
    ].forEach(([x, y]) => p.push(`<circle cx="${x}" cy="${y}" r="0.3" fill="var(--rink-red)"/>`));
    p.push(netSVG(-goal, 0, 0), netSVG(goal, 0, 180));
    return p.join("");
  }

  // Nets and creases are drawn half as big again as regulation (1.83 m): the
  // players are drawn several times life size, and beside them a true-scale net
  // looked too small. game.js plays with nets of the same size.
  const NET = { half: 1.35, depth: 1.6, crease: 2.7 };

  // A net with its crease; angle 0 has the mouth facing +x, like the left-hand goal.
  function netSVG(x, y, angle) {
    const { half, depth, crease } = NET;
    return `<g transform="translate(${x} ${y}) rotate(${angle || 0})">
      <path d="M 0 ${-crease} A ${crease} ${crease} 0 0 1 0 ${crease}" fill="var(--rink-crease)" stroke="var(--rink-red)" stroke-width="0.1"/>
      <rect x="${-depth}" y="${-half}" width="${depth}" height="${2 * half}" rx="0.45"
        fill="var(--rink-net)" stroke="var(--rink-red)" stroke-width="0.16"/></g>`;
  }

  // Skin tones, one per player in turn: light ones only, on request.
  const SKINS = ["#f1c8a6", "#e8b896", "#e2ad86"];

  // A hockey player seen from above, facing +x: shoulder pads in the team's
  // jersey, the helmet on top, open at the front where the face and eyes are,
  // gloves on the stick. A goalie is wider, with big pads, a blocker and a
  // catching glove, a painted mask with a cage and a paddle stick.
  // helmetLook() turns it and moves the eyes; `out` crosses them, for a player
  // knocked down.
  function helmetSVG(team, goalie, skin = SKINS[0]) {
    const jersey = `var(--rink-team-${team})`;
    const edge = `stroke="var(--rink-helmet-edge)" stroke-width="0.07"`;
    const eye = (x, y) =>
      `<circle cx="${x}" cy="${y}" r="0.14" fill="#fff"/>
      <circle data-pupil data-cx="${x}" data-cy="${y}" cx="${x}" cy="${y}" r="0.075" fill="#111"/>
      <path data-out d="M ${x - 0.08} ${y - 0.08} l 0.16 0.16 m 0 -0.16 l -0.16 0.16" stroke="#111" stroke-width="0.06" stroke-linecap="round" visibility="hidden"/>`;
    if (goalie) {
      return `<g data-helmet>
      <path d="M 0.1 1.05 L 1.3 0.55 L 1.42 -0.3" stroke="var(--rink-stick)" stroke-width="0.34" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <rect x="0.3" y="-0.98" width="0.7" height="0.86" rx="0.26" fill="var(--rink-mask)" ${edge}/>
      <rect x="0.3" y="0.12" width="0.7" height="0.86" rx="0.26" fill="var(--rink-mask)" ${edge}/>
      <path d="M 0.62 -0.98 V -0.12 M 0.62 0.12 V 0.98" stroke="${jersey}" stroke-width="0.12"/>
      <ellipse cx="-0.1" rx="0.78" ry="1.32" fill="${jersey}" ${edge}/>
      <rect x="0.1" y="0.88" width="0.6" height="0.44" rx="0.1" fill="var(--rink-mask)" ${edge}/>
      <circle cx="0.3" cy="-1.12" r="0.42" fill="var(--rink-mask)" ${edge}/>
      <circle cx="0.3" cy="-1.12" r="0.2" fill="${jersey}" opacity="0.85"/>
      <circle cx="0.05" r="0.56" fill="var(--rink-mask)" ${edge}/>
      <rect x="-0.5" y="-0.1" width="0.62" height="0.2" rx="0.1" fill="${jersey}"/>
      <path d="M 0.28 -0.4 A 0.56 0.56 0 0 1 0.28 0.4 Z" fill="${skin}"/>
      ${eye(0.4, -0.15)}${eye(0.4, 0.15)}
      <path d="M 0.3 -0.44 Q 0.72 0 0.3 0.44 M 0.4 -0.46 V 0.46 M 0.52 -0.38 V 0.38" fill="none" stroke="var(--rink-cage)" stroke-width="0.05"/></g>`;
    }
    return `<g data-helmet>
      <path d="M 0.42 0.66 L 1.45 0.3 L 1.52 -0.12" stroke="var(--rink-stick)" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <ellipse cx="-0.12" rx="0.66" ry="1.12" fill="${jersey}" ${edge}/>
      <path d="M -0.6 -0.78 Q -0.12 -1 0.3 -0.78 M -0.6 0.78 Q -0.12 1 0.3 0.78" fill="none" stroke="#fff" stroke-width="0.1" opacity="0.6"/>
      <circle cx="0.42" cy="0.62" r="0.17" fill="var(--rink-glove)" ${edge}/>
      <circle cx="0.5" cy="0.12" r="0.17" fill="var(--rink-glove)" ${edge}/>
      <circle cx="0.02" r="0.5" fill="${jersey}" ${edge}/>
      <path d="M -0.44 0 H -0.06" stroke="#fff" stroke-width="0.14" stroke-linecap="round" opacity="0.5"/>
      <circle cx="0.04" cy="-0.47" r="0.12" fill="${jersey}" ${edge}/>
      <circle cx="0.04" cy="0.47" r="0.12" fill="${jersey}" ${edge}/>
      <path d="M 0.24 -0.44 A 0.5 0.5 0 0 1 0.24 0.44 Z" fill="${skin}"/>
      ${eye(0.36, -0.15)}${eye(0.36, 0.15)}
      <path d="M 0.3 -0.42 A 0.48 0.48 0 0 1 0.3 0.42" fill="none" stroke="var(--rink-visor-clear)" stroke-width="0.1"/></g>`;
  }

  // Turns a player to `angle` (radians, 0 = +x) and points its eyes along
  // (lx, ly), in rink coordinates.
  function helmetLook(g, angle, lx, ly, out) {
    const h = g.querySelector("[data-helmet]");
    h.setAttribute("transform", `rotate(${((angle * 180) / Math.PI).toFixed(1)})`);
    const c = Math.cos(angle),
      s = Math.sin(angle);
    let x = lx * c + ly * s,
      y = ly * c - lx * s;
    const l = Math.hypot(x, y) || 1;
    [x, y] = [(x / l) * 0.06, (y / l) * 0.06];
    h.querySelectorAll("[data-pupil]").forEach((p) => {
      p.setAttribute("cx", (+p.dataset.cx + x).toFixed(3));
      p.setAttribute("cy", (+p.dataset.cy + y).toFixed(3));
      p.setAttribute("visibility", out ? "hidden" : "inherit");
    });
    h.querySelectorAll("[data-out]").forEach((p) => p.setAttribute("visibility", out ? "inherit" : "hidden"));
  }

  // The game (game.js) plays on the same rink, with the same players.
  window.rinkSVG = rinkSVG;
  window.helmetSVG = (...a) => helmetSVG(...a);
  window.helmetLook = (...a) => helmetLook(...a);
  window.RINK_SKINS = SKINS;
  window.RINK_NET = NET;

  // A point on the Catmull-Rom curve through k, between k[i] and k[i + 1].
  function curvePoint(k, i, u) {
    const p1 = k[i],
      p2 = k[i + 1],
      p0 = k[i - 1] || p1,
      p3 = k[i + 2] || p2;
    const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
    return [cr(p0.x, p1.x, p2.x, p3.x), cr(p0.y, p1.y, p2.y, p3.y)];
  }

  // Cumulative length along each curve segment, sampled, so a position can be
  // found by distance rather than by the curve's own uneven parameter.
  const SAMPLES = 24;
  function segmentLengths(k, i) {
    if (k[i].x === k[i + 1].x && k[i].y === k[i + 1].y) return null; // a wait
    const lut = [0];
    let prev = curvePoint(k, i, 0);
    for (let s = 1; s <= SAMPLES; s++) {
      const p = curvePoint(k, i, s / SAMPLES);
      lut.push(lut[s - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
      prev = p;
    }
    return lut;
  }

  // Keyframes for an actor's path. A point is [x, y] or [x, y, t]; the first
  // and last default to t = 0 and t = 1, and untimed points in between are
  // spread by distance along the curve, so a player skates at an even speed
  // between the moments that are pinned down.
  function keyframes(actor) {
    if (actor._k) return actor._k;
    const k = actor.path.map(([x, y, t]) => ({ x, y, t }));
    if (k[0].t === undefined) k[0].t = 0;
    if (k[k.length - 1].t === undefined) k[k.length - 1].t = 1;
    k.forEach((p, i) => i < k.length - 1 && (p.lut = segmentLengths(k, i)));
    const len = (m) => (k[m].lut ? k[m].lut[SAMPLES] : 0);
    let i = 0;
    while (i < k.length - 1) {
      let j = i + 1;
      while (k[j].t === undefined) j++;
      const d = [0];
      for (let m = i; m < j; m++) d.push(d[d.length - 1] + len(m));
      const total = d[d.length - 1];
      for (let m = i + 1; m < j; m++) k[m].t = k[i].t + (k[j].t - k[i].t) * (total ? d[m - i] / total : (m - i) / (j - i));
      i = j;
    }
    return (actor._k = k);
  }

  // Position of an actor at t ∈ [0,1]: on a Catmull-Rom curve through its
  // points, so skating lines bend instead of turning on a corner, at an even
  // speed within each stretch. A repeated point is a wait, and holds still.
  function along(actor, t) {
    const k = keyframes(actor);
    if (k.length === 1 || t <= k[0].t) return [k[0].x, k[0].y];
    const last = k[k.length - 1];
    if (t >= last.t) return [last.x, last.y];
    let i = 0;
    while (t > k[i + 1].t) i++;
    const lut = k[i].lut;
    if (!lut) return [k[i].x, k[i].y];
    const want = ((t - k[i].t) / (k[i + 1].t - k[i].t)) * lut[SAMPLES];
    let s = 0;
    while (s < SAMPLES - 1 && lut[s + 1] < want) s++;
    const span = lut[s + 1] - lut[s];
    return curvePoint(k, i, (s + (span ? (want - lut[s]) / span : 0)) / SAMPLES);
  }

  const actorById = (drill, id) => drill.actors.find((a) => a.id === id);
  const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

  // How long a puck travelling `dist` metres is in the air, as a fraction of
  // the drill.
  function flight(drill, type, dist) {
    const s = type === "shot" ? SHOT_SECONDS : Math.min(PASS_SECONDS[1], Math.max(PASS_SECONDS[0], dist / PASS_SPEED));
    return s / drill.duration;
  }

  // Follows every puck through the drill's events, once. Each actor marked
  // `puck: true` starts with one, and each point in `pucks` is a loose one.
  //
  // An event moves the puck carried by its `by` actor (in a one-puck drill
  // `by` can be left out). A pass to `to_actor` is aimed at where they will be
  // when it lands, so the puck meets them; a pass with a point `to` leaves it
  // loose there, as does a shot. `pickup` gives `by` the nearest loose puck.
  //
  // Returns each puck's segments (carried, in the air, or lying still) and the
  // pass and shot lines to draw. Mistakes in the data go to `warnings`.
  function simulate(drill) {
    if (drill._sim) return drill._sim;
    const warnings = [];
    const pucks = [
      ...drill.actors.filter((a) => a.puck).map((a) => ({ holder: a, free: 0, segs: [{ t0: 0, actor: a }] })),
      ...(drill.pucks || []).map((at) => ({ holder: null, at, free: 0, segs: [{ t0: 0, at }] })),
    ];
    const lines = [];
    const events = (drill.events || []).slice().sort((a, b) => a.t - b.t);
    for (const ev of events) {
      const who = ev.by ? actorById(drill, ev.by) : null;
      if (ev.by && !who) {
        warnings.push(`t=${ev.t}: no actor ${ev.by}`);
        continue;
      }
      const close = (p) => (p.segs[p.segs.length - 1].t1 = ev.t);

      if (ev.type === "pickup") {
        const here = along(who, ev.t);
        const loose = pucks.filter((p) => !p.holder && p.free <= ev.t);
        if (!loose.length) {
          warnings.push(`t=${ev.t}: ${ev.by} picks up, but no puck is loose`);
          continue;
        }
        const dist = (p) => Math.hypot(p.at[0] - here[0], p.at[1] - here[1]);
        const puck = loose.sort((a, b) => dist(a) - dist(b))[0];
        if (dist(puck) > 2.5) warnings.push(`t=${ev.t}: ${ev.by} picks up a puck ${dist(puck).toFixed(1)} m away`);
        close(puck);
        puck.segs.push({ t0: ev.t, actor: who });
        puck.holder = who;
        continue;
      }

      const puck = who ? pucks.find((p) => p.holder === who) : pucks.length === 1 ? pucks[0] : null;
      if (!puck || !puck.holder) {
        warnings.push(`t=${ev.t}: ${ev.by || "nobody"} has no puck to ${ev.type}`);
        continue;
      }
      if (puck.free > ev.t + 1e-9) warnings.push(`t=${ev.t}: ${ev.type} before the previous pass has landed (${puck.free.toFixed(3)})`);
      const from = along(puck.holder, ev.t);
      const rec = ev.type === "pass" && ev.to_actor ? actorById(drill, ev.to_actor) : null;
      let f, to;
      if (rec) {
        // Aim, measure, and aim again with the flight time that distance gives.
        to = along(rec, ev.t + flight(drill, "pass", 10));
        f = flight(drill, "pass", Math.hypot(to[0] - from[0], to[1] - from[1]));
        to = along(rec, ev.t + f);
      } else {
        to = ev.to;
        f = flight(drill, ev.type, Math.hypot(to[0] - from[0], to[1] - from[1]));
      }
      close(puck);
      puck.segs.push({ t0: ev.t, t1: ev.t + f, from, to });
      puck.segs.push(rec ? { t0: ev.t + f, actor: rec } : { t0: ev.t + f, at: to });
      puck.holder = rec;
      puck.at = rec ? null : to;
      puck.free = ev.t + f;
      lines.push({ t: ev.t, f, from, to, shot: ev.type === "shot" });
    }
    return (drill._sim = { pucks, lines, warnings });
  }

  // Where each puck is at time t, and who is carrying it.
  function pucksAt(drill, t) {
    return simulate(drill).pucks.map((p) => {
      const seg = p.segs.find((g) => t >= g.t0 && (g.t1 === undefined || t < g.t1)) || p.segs[0];
      if (seg.actor) return { pos: along(seg.actor, t), carrier: seg.actor };
      if (seg.from) return { pos: lerp(seg.from, seg.to, (t - seg.t0) / (seg.t1 - seg.t0)), carrier: null };
      return { pos: seg.at, carrier: null };
    });
  }

  function build(card, drill) {
    const svg = card.querySelector("svg");
    const gT = svg.querySelector(".trails"),
      gE = svg.querySelector(".events"),
      gA = svg.querySelector(".actors");
    const range = card.querySelector("input[type=range]");
    const play = card.querySelector(".drill-play");
    const steps = [...card.querySelectorAll(".drill-steps [data-t]")];

    svg.insertAdjacentHTML("afterbegin", rinkSVG());

    // Extra nets some drills use, as [x, y, angle]: angle 0 has the mouth
    // facing +x, like the left-hand goal.
    (drill.nets || []).forEach(([x, y, angle]) => gT.insertAdjacentHTML("beforeend", netSVG(x, y, angle)));

    (drill.cones || []).forEach(([x, y]) =>
      gT.insertAdjacentHTML(
        "beforeend",
        `<polygon points="${x},${y - 0.8} ${x - 0.7},${y + 0.6} ${x + 0.7},${y + 0.6}"
          fill="var(--rink-cone)" stroke="var(--rink-cone-edge)" stroke-width="0.08"/>`
      )
    );

    drill.actors.forEach((a) =>
      gT.insertAdjacentHTML(
        "beforeend",
        `<polyline data-trail="${a.id}" points="" fill="none"
          stroke="var(--rink-team-${a.team})" stroke-width="0.18"
          stroke-dasharray="0.9 0.6" opacity=".55" stroke-linecap="round"/>`
      )
    );

    // The puck sits beneath the players so it never hides a label; whoever is
    // carrying it gets a puck-coloured ring instead.
    const sim = simulate(drill);
    sim.warnings.forEach((w) => console.warn(`drill ${drill.id}: ${w}`));
    sim.pucks.forEach(() =>
      gA.insertAdjacentHTML(
        "beforeend",
        `<circle data-puck r="0.42" fill="var(--rink-puck)"
          stroke="var(--rink-puck-edge)" stroke-width="0.1"/>`
      )
    );
    const puckEls = [...gA.querySelectorAll("[data-puck]")];

    // A preview (the home page) draws its players as helmets instead of
    // numbered discs, as the game does: they face where they skate (goalies
    // and anyone standing face the puck) and watch the puck. The first circle
    // is the ring a carrier gets either way.
    const faces = card.hasAttribute("data-preview");
    drill.actors.forEach((a) =>
      gA.insertAdjacentHTML(
        "beforeend",
        faces
          ? `<g data-actor="${a.id}"><circle r="1.4" fill="none" stroke="var(--rink-puck)" stroke-width="0"/>${helmetSVG(a.team, a.label === "G", SKINS[drill.actors.indexOf(a) % SKINS.length])}</g>`
          : `<g data-actor="${a.id}">
          <circle r="1.25" fill="var(--rink-team-${a.team})" stroke="var(--rink-puck)" stroke-width="0"/>
          <text y="0.42" text-anchor="middle" font-size="1.1" fill="#fff"
            font-weight="600">${a.label}</text></g>`
      )
    );

    function look(a, t, pucks) {
      const [x, y] = along(a, t),
        [x1, y1] = along(a, Math.min(1, t + 0.03)),
        [x0, y0] = along(a, Math.max(0, t - 0.03));
      let dx = x1 - x0,
        dy = y1 - y0;
      const toPuck = pucks.length ? [pucks[0].pos[0] - x, pucks[0].pos[1] - y] : [dx, dy];
      if (a.label === "G" || Math.hypot(dx, dy) < 0.2) [dx, dy] = toPuck;
      const angle = Math.hypot(dx, dy) > 1e-6 ? Math.atan2(dy, dx) : a._angle || 0;
      a._angle = angle;
      const [lx, ly] = pucks.some((p) => p.carrier === a) ? [Math.cos(angle), Math.sin(angle)] : toPuck;
      helmetLook(gA.querySelector(`[data-actor="${a.id}"]`), angle, lx, ly, false);
    }

    function frame(t) {
      drill.actors.forEach((a) => {
        const [x, y] = along(a, t);
        gA.querySelector(`[data-actor="${a.id}"]`).setAttribute("transform", `translate(${x} ${y})`);
        const pts = [];
        for (let s = 0; s <= t; s += 0.01) pts.push(along(a, s).join(","));
        gT.querySelector(`[data-trail="${a.id}"]`).setAttribute("points", pts.join(" "));
      });

      gE.innerHTML = "";
      sim.lines.forEach((l) => {
        if (t < l.t) return;
        const [x, y] = lerp(l.from, l.to, Math.min(1, (t - l.t) / l.f));
        gE.insertAdjacentHTML(
          "beforeend",
          `<line x1="${l.from[0]}" y1="${l.from[1]}" x2="${x}" y2="${y}"
            stroke="var(--rink-${l.shot ? "shot" : "pass"})" stroke-width="0.2"
            stroke-dasharray="${l.shot ? "0" : "0.8 0.5"}" opacity=".85"/>`
        );
      });

      const pucks = pucksAt(drill, t);
      pucks.forEach((p, i) => puckEls[i].setAttribute("transform", `translate(${p.pos[0]} ${p.pos[1]})`));
      drill.actors.forEach((a) =>
        gA.querySelector(`[data-actor="${a.id}"] circle`).setAttribute("stroke-width", pucks.some((p) => p.carrier === a) ? "0.35" : "0")
      );
      if (faces) drill.actors.forEach((a) => look(a, t, pucks));

      // The current step is the last one that has started.
      let current = -1;
      steps.forEach((s, i) => {
        if (t >= +s.dataset.t) current = i;
      });
      steps.forEach((s, i) => (i === current ? s.setAttribute("aria-current", "step") : s.removeAttribute("aria-current")));
    }

    let raf = null,
      t = 0;
    // A preview (the home page) has no controls: it loops on its own, only
    // while on screen, and holds a still frame for reduced motion.
    if (card.hasAttribute("data-preview")) {
      preview(card, drill, frame);
      return;
    }

    const stop = () => {
      cancelAnimationFrame(raf);
      raf = null;
      play.textContent = "▶ Play";
      play.setAttribute("aria-label", "Play drill");
    };
    play.addEventListener("click", () => {
      if (raf) return stop();
      if (t >= 1) t = 0;
      play.textContent = "❚❚ Pause";
      play.setAttribute("aria-label", "Pause drill");
      let last = performance.now();
      (function loop(now) {
        t += (now - last) / (drill.duration * 1000);
        last = now;
        if (t >= 1) {
          t = 1;
          frame(1);
          range.value = 1000;
          stop();
          return;
        }
        frame(t);
        range.value = t * 1000;
        raf = requestAnimationFrame(loop);
      })(last);
    });
    range.addEventListener("input", () => {
      stop();
      t = range.value / 1000;
      frame(t);
    });
    card.querySelector(".drill-reset").addEventListener("click", () => {
      stop();
      t = 0;
      range.value = 0;
      frame(0);
    });
    steps.forEach((s) =>
      s.querySelector("button").addEventListener("click", () => {
        stop();
        t = +s.dataset.t;
        range.value = t * 1000;
        frame(t);
      })
    );

    frame(0);
  }

  function preview(card, drill, frame) {
    const still = 0.6;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return frame(still);
    const hold = 1.2; // seconds on the last frame before starting over
    const cycle = drill.duration + hold;
    let raf = null,
      start = null;
    function loop(now) {
      if (start === null) start = now;
      const s = ((now - start) / 1000) % cycle;
      frame(Math.min(s / drill.duration, 1));
      raf = requestAnimationFrame(loop);
    }
    frame(0);
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !raf) raf = requestAnimationFrame(loop);
      if (!e.isIntersecting && raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }).observe(card);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const data = window.DRILLS || [];
    document.querySelectorAll("[data-drill]").forEach((card) => {
      const drill = data.find((d) => d.id === card.dataset.drill);
      if (drill) build(card, drill);
    });
  });
})();
