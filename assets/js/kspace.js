// The k-space demo on the home page: why an MRI takes so long. The patient (a
// cat) is taken to k-space with an FFT, and the visitor chooses a scan: every
// line, top to bottom or from the centre out; every fourth line; or only the
// centre. The scanner then measures the lines itself, one a TR (shown SPEED
// times as fast), and the image is rebuilt from the lines measured so far
// (zero-filled inverse FFT).
//
// The catch: the cat keeps still for PATIENCE seconds of scanning, then moves.
// Lines measured after that come from the cat in its new pose (orange in
// k-space), so a full scan has motion ghosts. A quick scan is over before the
// cat moves, but skipping lines folds the cat over itself, and measuring only
// the centre loses the whiskers. After the every-fourth-line scan the image
// can be unfolded with eight receiver coils (simulated), as fast scans do
// (SENSE).
//
// `data-image` on the piece (any picture, such as a real MR slice) replaces the
// cat; it moves the same way.
(function () {
  "use strict";

  const N = 128; // lines of k-space, and pixels a side
  const TR = 0.5; // seconds a line takes, as in a T1-weighted spin echo
  const SPEED = 8; // the scan is shown this many times as fast
  const PATIENCE = 30; // seconds of scanning the cat keeps still for
  const RESTLESS = 22; // and when it starts to fidget
  const MOVED = { dx: 0.06, dy: -0.035, angle: 0.3 }; // the new pose, in fields of view and radians
  const R = 4; // the quick scan measures every R-th line
  const COILS = 8; // receiver coils round the patient, for the unfolding

  // The scans to choose from: the k-space rows each measures, in order (ky,
  // unshifted, so 0 is the centre), and how it went.
  const at = (s) => (s + N) % N; // ky from −N/2 … N/2 − 1 to its row
  const topDown = (keep) => {
    const rows = [];
    for (let s = -N / 2; s < N / 2; s++) if (keep(s)) rows.push(at(s));
    return rows;
  };
  const centreOut = () => {
    const rows = [0];
    for (let d = 1; d < N / 2; d++) rows.push(at(d), at(-d));
    return rows.concat(at(-N / 2));
  };
  const PLANS = {
    linear: {
      lines: topDown(() => true),
      said: "The cat moved at 0:30, and every line after that came from a moved cat: ghosts.",
    },
    centric: {
      lines: centreOut(),
      said: "The cat moved at 0:30 here too, but the centre of k-space was measured by then: the cat holds, its edges ghost.",
    },
    fourth: {
      lines: topDown((s) => s % R === 0),
      said: "Over before the cat moved, but with a quarter of the lines the cat folds over itself.",
    },
    centre: {
      lines: topDown((s) => s >= -16 && s < 16),
      said: "Over before the cat moved, but the fine detail is in the edges of k-space: no whiskers.",
    },
  };
  const UNFOLDED = "Fast scans do this: eight receiver coils see the copies in different places, which is enough to unfold them.";
  const clockOf = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  // Radix-2 FFT, in place, on N-point arrays.
  const BITS = Math.log2(N);
  const rev = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < BITS; b++) r |= ((i >> b) & 1) << (BITS - 1 - b);
    rev[i] = r;
  }
  const COS = new Float64Array(N / 2),
    SIN = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    COS[i] = Math.cos((2 * Math.PI * i) / N);
    SIN[i] = Math.sin((2 * Math.PI * i) / N);
  }

  function fft(re, im, inverse) {
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= N; size *= 2) {
      const half = size / 2,
        step = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = COS[k * step],
            wi = sign * SIN[k * step];
          const a = start + k,
            b = a + half;
          const tr = re[b] * wr - im[b] * wi,
            ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }

  // 2D FFT of N×N arrays, rows then columns. `rows` limits the first pass to
  // the rows that are not all zero.
  const rowRe = new Float64Array(N),
    rowIm = new Float64Array(N);
  function fft2(re, im, inverse, rows) {
    for (let y = 0; y < N; y++) {
      if (rows && !rows[y]) continue;
      const o = y * N;
      for (let x = 0; x < N; x++) {
        rowRe[x] = re[o + x];
        rowIm[x] = im[o + x];
      }
      fft(rowRe, rowIm, inverse);
      for (let x = 0; x < N; x++) {
        re[o + x] = rowRe[x];
        im[o + x] = rowIm[x];
      }
    }
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) {
        rowRe[y] = re[y * N + x];
        rowIm[y] = im[y * N + x];
      }
      fft(rowRe, rowIm, inverse);
      for (let y = 0; y < N; y++) {
        re[y * N + x] = rowRe[y];
        im[y * N + x] = rowIm[y];
      }
    }
  }

  const grey = (v) => {
    const c = Math.round(255 * v);
    return `rgb(${c},${c},${c})`;
  };

  // The patient: a cat's head as an MR scan might show it, drawn on a 512-unit
  // square. Fat under the skin and the fluid in the eyes are bright, the brain
  // is darker, and the whiskers are the finest detail, so they are the first
  // thing to go when the edges of k-space are missing.
  function drawCat(g) {
    const fill = (v) => (g.fillStyle = grey(v));
    const line = (v, w) => {
      g.strokeStyle = grey(v);
      g.lineWidth = w;
    };
    const tri = (a, b, c) => {
      g.beginPath();
      g.moveTo(...a);
      g.lineTo(...b);
      g.lineTo(...c);
      g.closePath();
      g.fill();
    };
    const oval = (x, y, rx, ry) => {
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI);
      g.fill();
    };
    g.lineCap = "round";

    fill(0.4);
    tri([118, 236], [150, 78], [236, 170]);
    tri([394, 236], [362, 78], [276, 170]);
    fill(0.18);
    tri([146, 214], [160, 118], [212, 178]);
    tri([366, 214], [352, 118], [300, 178]);

    fill(0.4);
    oval(256, 292, 156, 132);
    line(0.8, 9);
    g.stroke();

    fill(0.24);
    oval(256, 232, 92, 50);

    fill(0.85);
    oval(190, 300, 36, 32);
    oval(322, 300, 36, 32);
    fill(0.06);
    oval(194, 303, 9, 23);
    oval(318, 303, 9, 23);

    fill(0.7);
    tri([238, 350], [274, 350], [256, 370]);
    line(0.7, 5);
    g.beginPath();
    g.moveTo(256, 370);
    g.quadraticCurveTo(247, 392, 226, 386);
    g.moveTo(256, 370);
    g.quadraticCurveTo(265, 392, 286, 386);
    g.stroke();

    line(0.8, 3);
    for (const side of [-1, 1]) {
      for (const k of [-1, 0, 1]) {
        g.beginPath();
        g.moveTo(256 + side * 58, 362 + k * 10);
        g.lineTo(256 + side * 205, 342 + k * 32);
        g.stroke();
      }
    }
  }

  // The patient at N×N in greyscale: drawn at 4× in the given pose (or sitting
  // still), then scaled down, which smooths its edges.
  function render(patient, pose) {
    const S = 4 * N;
    const big = document.createElement("canvas");
    big.width = big.height = S;
    const g = big.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    if (pose) {
      g.translate(pose.dx * S, pose.dy * S);
      g.rotate(pose.angle);
    }
    g.scale(S / 512, S / 512);
    g.translate(-256, -256);
    patient(g);

    const small = document.createElement("canvas");
    small.width = small.height = N;
    const s = small.getContext("2d");
    s.imageSmoothingEnabled = true;
    s.imageSmoothingQuality = "high";
    s.drawImage(big, 0, 0, N, N);
    const d = s.getImageData(0, 0, N, N).data;
    const img = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) img[i] = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) / 255;
    return img;
  }

  const loadPicture = (src) =>
    new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve((g) => g.drawImage(el, 0, 0, 512, 512));
      el.onerror = reject;
      el.src = src;
    });

  function kspaceOf(img) {
    const re = Float64Array.from(img),
      im = new Float64Array(N * N);
    fft2(re, im, false);
    return { re, im };
  }

  // ——— The coils ———
  // A scanner listens with several receiver coils round the patient, each
  // hearing best the part nearest it. Their sensitivities: smooth, falling
  // off with distance, and with a phase of their own.
  function coilMaps() {
    const maps = [];
    for (let c = 0; c < COILS; c++) {
      const a = (2 * Math.PI * c) / COILS,
        cx = 0.62 * Math.cos(a),
        cy = 0.62 * Math.sin(a);
      const re = new Float64Array(N * N),
        im = new Float64Array(N * N);
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const u = (x + 0.5) / N - 0.5 - cx,
            v = (y + 0.5) / N - 0.5 - cy,
            mag = 1 / (1 + (u * u + v * v) / 0.09),
            phase = a + 2 * (u * Math.cos(a) + v * Math.sin(a));
          re[y * N + x] = mag * Math.cos(phase);
          im[y * N + x] = mag * Math.sin(phase);
        }
      maps.push([re, im]);
    }
    return maps;
  }

  // Solves G m = b for complex G (n × n, Hermitian and positive definite, so
  // no pivoting is needed) and b, stored as re, im pairs; b becomes m.
  function solve(G, b, n) {
    const at = (r, c) => 2 * (r * n + c);
    for (let i = 0; i < n; i++) {
      const pr = G[at(i, i)],
        pi = G[at(i, i) + 1],
        pd = pr * pr + pi * pi;
      for (let r = i + 1; r < n; r++) {
        const gr = G[at(r, i)],
          gi = G[at(r, i) + 1],
          fr = (gr * pr + gi * pi) / pd,
          fi = (gi * pr - gr * pi) / pd;
        for (let c = i; c < n; c++) {
          const ar = G[at(i, c)],
            ai = G[at(i, c) + 1];
          G[at(r, c)] -= fr * ar - fi * ai;
          G[at(r, c) + 1] -= fr * ai + fi * ar;
        }
        const br = b[2 * i],
          bi = b[2 * i + 1];
        b[2 * r] -= fr * br - fi * bi;
        b[2 * r + 1] -= fr * bi + fi * br;
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      let sr = b[2 * i],
        si = b[2 * i + 1];
      for (let c = i + 1; c < n; c++) {
        const gr = G[at(i, c)],
          gi = G[at(i, c) + 1],
          mr = b[2 * c],
          mi = b[2 * c + 1];
        sr -= gr * mr - gi * mi;
        si -= gr * mi + gi * mr;
      }
      const pr = G[at(i, i)],
        pi = G[at(i, i) + 1],
        pd = pr * pr + pi * pi;
      b[2 * i] = (sr * pr + si * pi) / pd;
      b[2 * i + 1] = (si * pr - sr * pi) / pd;
    }
  }

  function build(root, patient) {
    const $ = (s) => root.querySelector(s);
    const kCanvas = $("[data-k]"),
      iCanvas = $("[data-img]"),
      clock = $("[data-clock]"),
      status = $("[data-status]"),
      caption = $("[data-caption]"),
      unfoldButton = $("[data-unfold]"),
      planButtons = [...root.querySelectorAll("[data-plan]")];
    const kCtx = kCanvas.getContext("2d"),
      iCtx = iCanvas.getContext("2d");
    kCanvas.width = kCanvas.height = iCanvas.width = iCanvas.height = N;
    const kPix = kCtx.createImageData(N, N),
      iPix = iCtx.createImageData(N, N);

    const images = [render(patient), render(patient, MOVED)],
      poses = images.map(kspaceOf);
    let peak = 0;
    for (let i = 0; i < N * N; i++) peak = Math.max(peak, images[0][i]);

    // Log magnitude for display, normalised, with the centre (DC) shifted to
    // the middle of the panel. k-space is kept unshifted: row = ky, column = kx.
    const shown = poses.map(({ re, im }) => {
      const s = new Float64Array(N * N);
      for (let i = 0; i < N * N; i++) s[i] = Math.log1p(Math.hypot(re[i], im[i]));
      return s;
    });
    let top = 0;
    for (const s of shown) for (let i = 0; i < N * N; i++) top = Math.max(top, s[i]);
    const ky = (r) => (r + N / 2) % N; // panel row → ky

    // Which pose each line was measured in: 0 not yet, 1 still, 2 moved.
    const source = new Uint8Array(N);
    const A = () => new Float64Array(N * N);
    const zero = [A(), A()],
      mag = A();

    // The image from the measured lines alone, each line from the pose it was
    // measured in. Each line is weighted by how sparsely its neighbourhood
    // was measured (density compensation, over windows of 2R lines), so the
    // brightness holds both where every fourth line is missing and where
    // the centre is complete.
    function zeroFilled([re, im]) {
      re.fill(0);
      im.fill(0);
      for (let r = 0; r < N; r++) {
        const k = ky(r);
        if (!source[k]) continue;
        let near = 0;
        for (let q = r - R; q < r + R; q++) if (source[ky((q + N) % N)]) near++;
        const w = (2 * R) / near / (N * N),
          from = poses[source[k] - 1];
        for (let c = k * N; c < (k + 1) * N; c++) {
          re[c] = w * from.re[c];
          im[c] = w * from.im[c];
        }
      }
      fft2(re, im, true, source);
    }
    // Where folded copies overlap they add up, so the display is windowed
    // to the brightest pixel, as a scanner's viewer would.
    function show([re, im]) {
      let brightest = 0;
      for (let i = 0; i < N * N; i++) {
        mag[i] = Math.hypot(re[i], im[i]) / peak;
        brightest = Math.max(brightest, mag[i]);
      }
      const gain = 1 / Math.max(1, 0.92 * brightest);
      for (let i = 0; i < N * N; i++) {
        const v = Math.round(255 * Math.min(1, gain * mag[i]));
        iPix.data[4 * i] = iPix.data[4 * i + 1] = iPix.data[4 * i + 2] = v;
        iPix.data[4 * i + 3] = 255;
      }
      iCtx.putImageData(iPix, 0, 0);
    }

    // k-space as measured so far: what is still to come faintly, the lines
    // from the moved cat in orange, the line being measured in blue.
    let current = -1;
    function drawK() {
      const d = kPix.data;
      for (let r = 0; r < N; r++) {
        const k = ky(r),
          from = source[k],
          s = shown[from === 2 ? 1 : 0],
          dim = from ? 1 : 0.1,
          now = k === current;
        for (let c = 0; c < N; c++) {
          const v = 255 * dim * Math.pow(s[k * N + ((c + N / 2) % N)] / top, 1.15),
            p = 4 * (r * N + c);
          if (now) {
            d[p] = 120 + v * 0.5;
            d[p + 1] = 200 + v * 0.2;
            d[p + 2] = 255;
          } else if (from === 2) {
            d[p] = v + 45;
            d[p + 1] = v * 0.62 + 12;
            d[p + 2] = v * 0.4;
          } else d[p] = d[p + 1] = d[p + 2] = v;
          d[p + 3] = 255;
        }
      }
      kCtx.putImageData(kPix, 0, 0);
    }

    // ——— Unfolding with the coils (SENSE) ———
    // Every coil sees the cat folded into R copies, but each copy weighted by
    // that coil's sensitivity where it came from, so the copies fall
    // differently in every coil's view. For each pixel of the folded image,
    // the R places that folded onto it are then solved for from the eight
    // coils (least squares: eight equations, R unknowns). Made once, when
    // first wanted, from the cat as it sat for the quick scan.
    let unfolded = null,
      fading = 0;
    function unfoldImage() {
      if (unfolded) return unfolded;
      const maps = coilMaps(),
        M = N / R,
        rows = new Uint8Array(N);
      for (let k = 0; k < N; k += R) rows[k] = 1;
      const folded = maps.map(([sr, si]) => {
        const re = A(),
          im = A();
        for (let i = 0; i < N * N; i++) {
          re[i] = images[0][i] * sr[i];
          im[i] = images[0][i] * si[i];
        }
        fft2(re, im, false);
        for (let k = 0; k < N; k++)
          if (!rows[k]) {
            re.fill(0, k * N, k * N + N);
            im.fill(0, k * N, k * N + N);
          }
        fft2(re, im, true, rows);
        for (let i = 0; i < N * N; i++) {
          re[i] /= N * N;
          im[i] /= N * N;
        }
        return [re, im];
      });
      const out = [A(), A()],
        G = new Float64Array(2 * R * R),
        b = new Float64Array(2 * R);
      for (let y = 0; y < M; y++)
        for (let x = 0; x < N; x++) {
          // Coil c sees, at (x, y), the sum over j of S_c at (x, y + jM)
          // times the cat there, over R: G = BᴴB and b = Bᴴa for that B.
          G.fill(0);
          b.fill(0);
          for (let c = 0; c < COILS; c++) {
            const [sr, si] = maps[c],
              [ar, ai] = folded[c],
              here = y * N + x;
            for (let j = 0; j < R; j++) {
              const pj = (y + j * M) * N + x,
                jr = sr[pj] / R,
                ji = si[pj] / R;
              b[2 * j] += jr * ar[here] + ji * ai[here];
              b[2 * j + 1] += jr * ai[here] - ji * ar[here];
              for (let l = 0; l < R; l++) {
                const pl = (y + l * M) * N + x,
                  lr = sr[pl] / R,
                  li = si[pl] / R;
                G[2 * (j * R + l)] += jr * lr + ji * li;
                G[2 * (j * R + l) + 1] += jr * li - ji * lr;
              }
            }
          }
          let trace = 0;
          for (let j = 0; j < R; j++) trace += G[2 * (j * R + j)];
          for (let j = 0; j < R; j++) G[2 * (j * R + j)] += 1e-9 * trace;
          solve(G, b, R);
          for (let j = 0; j < R; j++) {
            const p = (y + j * M) * N + x;
            out[0][p] = b[2 * j];
            out[1][p] = b[2 * j + 1];
          }
        }
      return (unfolded = out);
    }
    // The folded cat fades into the unfolded one.
    const blend = [A(), A()];
    function unfold(on) {
      cancelAnimationFrame(fading);
      fading = 0;
      unfoldButton.setAttribute("aria-pressed", String(on));
      caption.textContent = "the cat";
      zeroFilled(zero);
      if (!on) return show(zero);
      const u = unfoldImage(),
        t0 = performance.now();
      caption.textContent = "the cat, unfolding…";
      const step = (now) => {
        const a = Math.min(1, (now - t0) / 700),
          e = a * a * (3 - 2 * a);
        for (let i = 0; i < N * N; i++) {
          blend[0][i] = (1 - e) * zero[0][i] + e * u[0][i];
          blend[1][i] = (1 - e) * zero[1][i] + e * u[1][i];
        }
        show(blend);
        if (a < 1) fading = requestAnimationFrame(step);
        else caption.textContent = `the cat, unfolded with ${COILS} coils`;
      };
      fading = requestAnimationFrame(step);
    }

    // ——— The scan ———
    // The scanner measures line i of the plan in the i-th TR, from the cat as
    // it is by then; the clock is the scan's own time.
    let plan = null,
      done = 0,
      began = 0,
      running = 0,
      mood = "";
    const length = () => PLANS[plan].lines.length * TR;
    const say = (text) => {
      if (text !== mood) status.textContent = mood = text;
    };
    function measureTo(t) {
      const lines = PLANS[plan].lines,
        due = Math.min(lines.length, Math.floor(t / TR));
      for (; done < due; done++) source[lines[done]] = done * TR >= PATIENCE ? 2 : 1;
      current = done && done < lines.length ? lines[done - 1] : -1;
    }
    function frame(t) {
      drawK();
      zeroFilled(zero);
      show(zero);
      const over = done === PLANS[plan].lines.length;
      clock.textContent = over ? clockOf(length()) : `${clockOf(t)} of ${clockOf(length())}`;
      say(over ? PLANS[plan].said : t >= PATIENCE ? "the cat moved" : t >= RESTLESS ? "the cat is getting restless" : "the cat is calm");
      root.classList.toggle("is-moved", t >= PATIENCE);
      unfoldButton.hidden = !(over && plan === "fourth");
    }
    function tick(now) {
      const t = Math.min(length(), ((now - began) / 1000) * SPEED);
      measureTo(t);
      frame(t);
      running = done < PLANS[plan].lines.length ? requestAnimationFrame(tick) : 0;
    }
    function scan(name, instantly) {
      cancelAnimationFrame(running);
      plan = name;
      done = 0;
      source.fill(0);
      unfold(false);
      planButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.plan === name)));
      if (instantly) {
        measureTo(length());
        frame(length());
      } else {
        measureTo(0);
        frame(0);
        began = performance.now();
        running = requestAnimationFrame(tick);
      }
    }

    for (const b of planButtons) {
      b.querySelector("[data-time]").textContent = clockOf(PLANS[b.dataset.plan].lines.length * TR);
      b.addEventListener("click", () => scan(b.dataset.plan));
    }
    unfoldButton.addEventListener("click", () => {
      const on = unfoldButton.getAttribute("aria-pressed") !== "true";
      unfold(on);
      say(on ? UNFOLDED : PLANS[plan].said);
    });

    // It opens on a quick scan, done: every fourth line, the cat folded.
    scan("fourth", true);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-kspace]").forEach((root) => {
      const src = root.dataset.image;
      (src ? loadPicture(src) : Promise.resolve(drawCat)).catch(() => drawCat).then((patient) => build(root, patient));
    });
  });
})();
