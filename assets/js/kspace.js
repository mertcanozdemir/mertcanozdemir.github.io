// The k-space demo on the home page. An image is taken to k-space with an FFT;
// the scan starts with every fourth line measured, the visitor measures more
// by moving over the k-space panel, and the image is rebuilt from the measured
// lines alone (zero-filled inverse FFT), so the aliasing of an undersampled
// scan shows and then clears.
//
// The image is a head phantom drawn here, unless the element gives `data-image`
// (any square-ish greyscale picture, such as a real MR slice), which replaces it.
(function () {
  "use strict";

  const N = 128; // lines of k-space, and pixels a side
  const R = 4; // the scan starts with every R-th line measured
  const BRUSH = 1; // lines measured on either side of the pointer

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

  // The modified Shepp–Logan head phantom (Toft): [value, a, b, x0, y0, angle°]
  // on a field of view of [-1, 1]², drawn at 80% so the head clears the edges,
  // averaged over 3×3 points a pixel for smooth edges.
  const ELLIPSES = [
    [1, 0.69, 0.92, 0, 0, 0],
    [-0.8, 0.6624, 0.874, 0, -0.0184, 0],
    [-0.2, 0.11, 0.31, 0.22, 0, -18],
    [-0.2, 0.16, 0.41, -0.22, 0, 18],
    [0.1, 0.21, 0.25, 0, 0.35, 0],
    [0.1, 0.046, 0.046, 0, 0.1, 0],
    [0.1, 0.046, 0.046, 0, -0.1, 0],
    [0.1, 0.046, 0.023, -0.08, -0.605, 0],
    [0.1, 0.023, 0.023, 0, -0.606, 0],
    [0.1, 0.023, 0.046, 0.06, -0.605, 0],
  ].map(([v, a, b, x0, y0, deg]) => {
    const t = (deg * Math.PI) / 180;
    return { v, a, b, x0, y0, c: Math.cos(t), s: Math.sin(t) };
  });

  function phantom() {
    const SS = 3,
      scale = 0.8;
    const img = new Float64Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let sum = 0;
        for (let sy = 0; sy < SS; sy++) {
          const Y = -(((y * SS + sy + 0.5) / (N * SS)) * 2 - 1) / scale;
          for (let sx = 0; sx < SS; sx++) {
            const X = (((x * SS + sx + 0.5) / (N * SS)) * 2 - 1) / scale;
            for (const e of ELLIPSES) {
              const dx = X - e.x0,
                dy = Y - e.y0;
              const u = (dx * e.c + dy * e.s) / e.a,
                w = (dy * e.c - dx * e.s) / e.b;
              if (u * u + w * w <= 1) sum += e.v;
            }
          }
        }
        img[y * N + x] = sum / (SS * SS);
      }
    }
    return img;
  }

  // A picture scaled to N×N and read as greyscale.
  function picture(src) {
    return new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = N;
        const ctx = c.getContext("2d");
        ctx.drawImage(el, 0, 0, N, N);
        const d = ctx.getImageData(0, 0, N, N).data;
        const img = new Float64Array(N * N);
        for (let i = 0; i < N * N; i++) img[i] = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) / 255;
        resolve(img);
      };
      el.onerror = reject;
      el.src = src;
    });
  }

  function build(root, img) {
    const kCanvas = root.querySelector("[data-k]"),
      iCanvas = root.querySelector("[data-img]");
    const status = root.querySelector("[data-status]"),
      reset = root.querySelector("[data-reset]");
    const kCtx = kCanvas.getContext("2d"),
      iCtx = iCanvas.getContext("2d");
    kCanvas.width = kCanvas.height = iCanvas.width = iCanvas.height = N;
    const kPix = kCtx.createImageData(N, N),
      iPix = iCtx.createImageData(N, N);

    let peak = 0;
    for (let i = 0; i < N * N; i++) peak = Math.max(peak, img[i]);

    // k-space, kept unshifted: row index = ky, column index = kx.
    const kRe = Float64Array.from(img),
      kIm = new Float64Array(N * N);
    fft2(kRe, kIm, false);

    // Log magnitude for display, normalised, with the centre (DC) shifted to
    // the middle of the panel.
    const shown = new Float64Array(N * N);
    let top = 0;
    for (let i = 0; i < N * N; i++) {
      shown[i] = Math.log1p(Math.hypot(kRe[i], kIm[i]));
      top = Math.max(top, shown[i]);
    }
    const ky = (r) => (r + N / 2) % N; // panel row → ky

    const mask = new Uint8Array(N);
    const start = () => {
      for (let k = 0; k < N; k++) mask[k] = k % R === 0 ? 1 : 0;
    };

    const re = new Float64Array(N * N),
      im = new Float64Array(N * N);

    function draw() {
      // The k-space panel: measured lines bright, the rest faint.
      for (let r = 0; r < N; r++) {
        const k = ky(r),
          dim = mask[k] ? 1 : 0.1;
        for (let c = 0; c < N; c++) {
          const v = Math.round(255 * dim * Math.pow(shown[k * N + ((c + N / 2) % N)] / top, 1.15));
          const p = 4 * (r * N + c);
          kPix.data[p] = kPix.data[p + 1] = kPix.data[p + 2] = v;
          kPix.data[p + 3] = 255;
        }
      }
      kCtx.putImageData(kPix, 0, 0);

      // The image from the measured lines alone. Scaling by N/count keeps its
      // brightness while lines are missing.
      re.fill(0);
      im.fill(0);
      let count = 0;
      for (let k = 0; k < N; k++) {
        if (!mask[k]) continue;
        count++;
        re.set(kRe.subarray(k * N, (k + 1) * N), k * N);
        im.set(kIm.subarray(k * N, (k + 1) * N), k * N);
      }
      fft2(re, im, true, mask);
      const gain = N / count / (N * N) / peak;
      for (let i = 0; i < N * N; i++) {
        const v = Math.round(255 * Math.min(1, gain * Math.hypot(re[i], im[i])));
        iPix.data[4 * i] = iPix.data[4 * i + 1] = iPix.data[4 * i + 2] = v;
        iPix.data[4 * i + 3] = 255;
      }
      iCtx.putImageData(iPix, 0, 0);

      const speed = count === N ? "full scan" : `${Math.round((N / count) * 10) / 10}× faster`;
      status.textContent = `${count} of ${N} lines measured · ${speed}`;
    }

    let queued = 0;
    const schedule = () => {
      if (!queued) queued = requestAnimationFrame(() => ((queued = 0), draw()));
    };

    // Moving over the panel measures the lines under the pointer, and every line
    // between it and where the pointer last was, so a quick sweep leaves no gaps.
    let last = null;
    const rowAt = (e) => {
      const box = kCanvas.getBoundingClientRect();
      return Math.min(N - 1, Math.max(0, Math.floor(((e.clientY - box.top) / box.height) * N)));
    };
    const measure = (e) => {
      const r = rowAt(e),
        from = last === null ? r : last;
      for (let q = Math.max(0, Math.min(from, r) - BRUSH); q <= Math.min(N - 1, Math.max(from, r) + BRUSH); q++) mask[ky(q)] = 1;
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
      draw();
    });

    start();
    draw();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-kspace]").forEach((root) => {
      const src = root.dataset.image;
      (src ? picture(src) : Promise.resolve(phantom())).catch(() => phantom()).then((img) => build(root, img));
    });
  });
})();
