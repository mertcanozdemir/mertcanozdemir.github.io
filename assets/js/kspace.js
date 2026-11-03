// The k-space demo on the home page. The patient (a cat) is taken to k-space
// with an FFT; the scan starts with every fourth line measured, the visitor
// measures more by moving over the k-space panel, and the image is rebuilt from
// the measured lines alone (zero-filled inverse FFT), so the aliasing of an
// undersampled scan shows and then clears.
//
// The catch: the cat moves once enough lines have been measured. Lines measured
// after that come from the cat in its new pose, so a full scan ends up with
// motion ghosts, which is the case for scanning fast.
//
// `data-image` on the piece (any picture, such as a real MR slice) replaces the
// cat; it moves the same way.
(function () {
  "use strict";

  const N = 128; // lines of k-space, and pixels a side
  const R = 4; // the scan starts with every R-th line measured
  const BRUSH = 1; // lines measured on either side of the pointer
  const RESTLESS = 60; // lines measured when the cat starts to fidget
  const MOVES = 84; // lines measured when it moves
  const MOVED = { dx: 0.06, dy: -0.035, angle: 0.3 }; // the new pose, in fields of view and radians

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

  function build(root, patient) {
    const kCanvas = root.querySelector("[data-k]"),
      iCanvas = root.querySelector("[data-img]");
    const status = root.querySelector("[data-status]"),
      reset = root.querySelector("[data-reset]");
    const kCtx = kCanvas.getContext("2d"),
      iCtx = iCanvas.getContext("2d");
    kCanvas.width = kCanvas.height = iCanvas.width = iCanvas.height = N;
    const kPix = kCtx.createImageData(N, N),
      iPix = iCtx.createImageData(N, N);

    const still = render(patient),
      poses = [kspaceOf(still), kspaceOf(render(patient, MOVED))];
    let peak = 0;
    for (let i = 0; i < N * N; i++) peak = Math.max(peak, still[i]);

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
    let count = 0,
      moved = false;
    const start = () => {
      for (let k = 0; k < N; k++) source[k] = k % R === 0 ? 1 : 0;
      count = N / R;
      moved = false;
    };
    const take = (k) => {
      if (source[k]) return;
      if (count >= MOVES) moved = true;
      source[k] = moved ? 2 : 1;
      count++;
    };

    const re = new Float64Array(N * N),
      im = new Float64Array(N * N);

    function redraw() {
      for (let r = 0; r < N; r++) {
        const k = ky(r),
          s = shown[source[k] === 2 ? 1 : 0],
          dim = source[k] ? 1 : 0.1;
        for (let c = 0; c < N; c++) {
          const v = Math.round(255 * dim * Math.pow(s[k * N + ((c + N / 2) % N)] / top, 1.15));
          const p = 4 * (r * N + c);
          kPix.data[p] = kPix.data[p + 1] = kPix.data[p + 2] = v;
          kPix.data[p + 3] = 255;
        }
      }
      kCtx.putImageData(kPix, 0, 0);

      // The image from the measured lines alone, each line from the pose it was
      // measured in. Each line is weighted by how sparsely its neighbourhood
      // was measured (density compensation, over windows of 2R lines), so the
      // brightness holds both where every fourth line is missing and where
      // the centre is complete.
      re.fill(0);
      im.fill(0);
      for (let r = 0; r < N; r++) {
        const k = ky(r);
        if (!source[k]) continue;
        let near = 0;
        for (let q = r - R; q < r + R; q++) if (source[ky((q + N) % N)]) near++;
        const w = (2 * R) / near,
          from = poses[source[k] - 1];
        for (let c = k * N; c < (k + 1) * N; c++) {
          re[c] = w * from.re[c];
          im[c] = w * from.im[c];
        }
      }
      fft2(re, im, true, source);
      // Where folded copies overlap they add up, so the display is windowed
      // to the brightest pixel, as a scanner's viewer would.
      let brightest = 0;
      for (let i = 0; i < N * N; i++) {
        re[i] = Math.hypot(re[i], im[i]) / (N * N) / peak;
        brightest = Math.max(brightest, re[i]);
      }
      const gain = 1 / Math.max(1, 0.92 * brightest);
      for (let i = 0; i < N * N; i++) {
        const v = Math.round(255 * Math.min(1, gain * re[i]));
        iPix.data[4 * i] = iPix.data[4 * i + 1] = iPix.data[4 * i + 2] = v;
        iPix.data[4 * i + 3] = 255;
      }
      iCtx.putImageData(iPix, 0, 0);

      const speed = count === N ? "full scan" : `${Math.round((N / count) * 10) / 10}× faster`;
      const mood = moved
        ? count === N
          ? "the cat moved halfway through"
          : "the cat moved"
        : count >= RESTLESS
          ? "the cat is getting restless"
          : "the cat is calm";
      status.textContent = `${count} of ${N} lines · ${speed} · ${mood}`;
      root.classList.toggle("is-restless", !moved && count >= RESTLESS);
      root.classList.toggle("is-moved", moved);
    }

    let queued = 0;
    const schedule = () => {
      if (!queued) queued = requestAnimationFrame(() => ((queued = 0), redraw()));
    };

    // Moving over the panel measures the lines under the pointer, and every line
    // between it and where the pointer last was, so a quick sweep leaves no gaps.
    // Lines are taken in the order the pointer crosses them.
    let last = null;
    const rowAt = (e) => {
      const box = kCanvas.getBoundingClientRect();
      return Math.min(N - 1, Math.max(0, Math.floor(((e.clientY - box.top) / box.height) * N)));
    };
    const measure = (e) => {
      const r = rowAt(e),
        from = last === null ? r : last,
        dir = r >= from ? 1 : -1;
      for (let q = from - dir * BRUSH; q !== r + dir * (BRUSH + 1); q += dir) {
        if (q >= 0 && q < N) take(ky(q));
      }
      last = r;
      schedule();
    };
    kCanvas.addEventListener("pointerdown", measure);
    kCanvas.addEventListener("pointermove", measure);
    kCanvas.addEventListener("pointerleave", () => (last = null));
    kCanvas.addEventListener("pointerup", (e) => {
      if (e.pointerType !== "mouse") last = null;
    });

    reset.addEventListener("click", () => {
      start();
      last = null;
      redraw();
    });

    start();
    redraw();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-kspace]").forEach((root) => {
      const src = root.dataset.image;
      (src ? loadPicture(src) : Promise.resolve(drawCat)).catch(() => drawCat).then((patient) => build(root, patient));
    });
  });
})();
