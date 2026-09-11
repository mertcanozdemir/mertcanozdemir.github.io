// Drill diagrams: draws an IIHF rink and animates each drill from _data/drills.yml.
// Rink coordinates: centre ice (0,0), x ±30 m, y ±15 m.

(function () {
  const PASS_FLIGHT = 0.15; // fraction of the drill a pass spends in the air

  function rinkSVG() {
    const L = 30,
      W = 15,
      R = 8.5;
    const blue = 7.5,
      goal = L - 4;
    const p = [];
    p.push(`<rect x="${-L}" y="${-W}" width="${L * 2}" height="${W * 2}" rx="${R}" ry="${R}"
      fill="var(--rink-ice)" stroke="var(--rink-board)" stroke-width="0.45"/>`);
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
    });
    [
      [-5, -7],
      [-5, 7],
      [5, -7],
      [5, 7],
    ].forEach(([x, y]) => p.push(`<circle cx="${x}" cy="${y}" r="0.3" fill="var(--rink-red)"/>`));
    [-1, 1].forEach((s) => {
      p.push(`<path d="M ${s * goal} -1.8 A 1.8 1.8 0 0 ${s > 0 ? 0 : 1} ${s * goal} 1.8"
        fill="var(--rink-crease)" stroke="var(--rink-red)" stroke-width="0.1"/>`);
      p.push(`<rect x="${s > 0 ? goal : goal - 1.1}" y="-0.9" width="1.1" height="1.8"
        fill="none" stroke="var(--rink-red)" stroke-width="0.12"/>`);
    });
    return p.join("");
  }

  // Position along a path at t ∈ [0,1], eased between points.
  function along(path, t) {
    if (path.length === 1) return path[0];
    const n = path.length - 1;
    const ft = Math.min(0.9999, Math.max(0, t)) * n;
    const i = Math.floor(ft);
    const f = ft - i;
    const a = path[i],
      b = path[i + 1];
    const s = f * f * (3 - 2 * f);
    return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  }

  // Who holds the puck just before an event: the last pass receiver, else the
  // actor that started with it.
  function holderAt(drill, t) {
    const passes = (drill.events || []).filter((e) => e.type === "pass" && e.t < t).sort((a, b) => a.t - b.t);
    const last = passes[passes.length - 1];
    if (last) return drill.actors.find((a) => a.id === last.to_actor);
    return drill.actors.find((a) => a.puck);
  }

  // Where an event starts: the holder's position at that moment, so passes and
  // shots leave the stick rather than a fixed point the player has skated past.
  function eventFrom(drill, ev) {
    if (ev.from) return ev.from;
    const h = holderAt(drill, ev.t);
    return h ? along(h.path, ev.t) : [0, 0];
  }

  // Where a pass should land: the receiver's position when it arrives, so the
  // puck meets the player instead of jumping to a point they have left.
  function passTarget(drill, ev) {
    if (ev.to_actor) {
      const rec = drill.actors.find((a) => a.id === ev.to_actor);
      if (rec) return along(rec.path, ev.t + PASS_FLIGHT);
    }
    return ev.to;
  }

  // Who has the puck at time t, and where is it?
  function puckAt(drill, t) {
    const passes = (drill.events || []).filter((e) => e.type === "pass").sort((a, b) => a.t - b.t);

    // Most recent pass that has already started.
    let last = null;
    for (const e of passes) if (t >= e.t) last = e;

    if (last) {
      const src = eventFrom(drill, last);
      const dest = passTarget(drill, last);
      const flown = (t - last.t) / PASS_FLIGHT;
      if (flown < 1) {
        // In flight: fly towards where the receiver will be when it lands.
        return [src[0] + (dest[0] - src[0]) * flown, src[1] + (dest[1] - src[1]) * flown];
      }
      // Received: stay with the receiver.
      const rec = drill.actors.find((a) => a.id === last.to_actor);
      if (rec) return along(rec.path, t);
      return dest;
    }

    const carrier = drill.actors.find((a) => a.puck);
    return carrier ? along(carrier.path, t) : null;
  }

  function build(card, drill) {
    const svg = card.querySelector("svg");
    const gT = svg.querySelector(".trails"),
      gE = svg.querySelector(".events"),
      gA = svg.querySelector(".actors");
    const range = card.querySelector("input[type=range]");
    const play = card.querySelector(".drill-play");

    svg.insertAdjacentHTML("afterbegin", rinkSVG());

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

    drill.actors.forEach((a) =>
      gA.insertAdjacentHTML(
        "beforeend",
        `<g data-actor="${a.id}">
          <circle r="1.25" fill="var(--rink-team-${a.team})"/>
          <text y="0.42" text-anchor="middle" font-size="1.1" fill="#fff"
            font-weight="600">${a.label}</text></g>`
      )
    );

    gA.insertAdjacentHTML(
      "beforeend",
      `<circle data-puck r="0.42" fill="var(--rink-puck)"
        stroke="var(--rink-puck-edge)" stroke-width="0.1"/>`
    );
    const puckEl = gA.querySelector("[data-puck]");

    function frame(t) {
      drill.actors.forEach((a) => {
        const [x, y] = along(a.path, t);
        gA.querySelector(`[data-actor="${a.id}"]`).setAttribute("transform", `translate(${x} ${y})`);
        const pts = [];
        for (let s = 0; s <= t; s += 0.02) pts.push(along(a.path, s).join(","));
        gT.querySelector(`[data-trail="${a.id}"]`).setAttribute("points", pts.join(" "));
      });

      gE.innerHTML = "";
      (drill.events || []).forEach((ev) => {
        if (t < ev.t) return;
        const done = Math.min(1, (t - ev.t) / PASS_FLIGHT);
        const shot = ev.type === "shot";
        const src = eventFrom(drill, ev);
        const dest = shot ? ev.to : passTarget(drill, ev);
        const x = src[0] + (dest[0] - src[0]) * done;
        const y = src[1] + (dest[1] - src[1]) * done;
        gE.insertAdjacentHTML(
          "beforeend",
          `<line x1="${src[0]}" y1="${src[1]}" x2="${x}" y2="${y}"
            stroke="var(--rink-${shot ? "shot" : "pass"})" stroke-width="0.2"
            stroke-dasharray="${shot ? "0" : "0.8 0.5"}" opacity=".85"/>`
        );
      });

      const shot = (drill.events || []).filter((e) => e.type === "shot" && t >= e.t).sort((a, b) => b.t - a.t)[0];
      let pos;
      if (shot) {
        const src = eventFrom(drill, shot);
        const done = Math.min(1, (t - shot.t) / PASS_FLIGHT);
        pos = [src[0] + (shot.to[0] - src[0]) * done, src[1] + (shot.to[1] - src[1]) * done];
      } else {
        pos = puckAt(drill, t);
      }
      if (pos) {
        puckEl.setAttribute("transform", `translate(${pos[0]} ${pos[1]})`);
        puckEl.style.display = "";
      } else {
        puckEl.style.display = "none";
      }
    }

    let raf = null,
      t = 0;
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
        t += (now - last) / (drill.duration * 450);
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

    frame(0);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const data = window.DRILLS || [];
    document.querySelectorAll("[data-drill]").forEach((card) => {
      const drill = data.find((d) => d.id === card.dataset.drill);
      if (drill) build(card, drill);
    });
  });
})();
