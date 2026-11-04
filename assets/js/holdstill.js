// Hold still (/hold-still/): the visitor is the patient. The camera's picture
// stands in for what a scanner sees, grey and fading to dark at the edges as
// an MR slice does, and its k-space is shown live. A scan takes one k-space
// line a TR, in real time (half a second a line), each line from the camera's
// picture at that moment, so moving during the scan makes ghosts, as in a real
// scanner. How far the visitor has moved is measured from the pictures (phase
// correlation against the first one); lines measured while moved show in
// orange. After a quick scan the lines skipped can be unfolded with eight
// coils, or by the coils and the network from the home page, which has only
// ever seen cats. The scan can be saved as a picture, with the corner notes a
// scanner's viewer puts on one. Nothing leaves the device.
//
// It uses kspace.js (window.kspace) for the FFT, the coils and the network.
// Without a camera, the home page's cat sits in.
(function () {
  "use strict";
  const K = window.kspace,
    root = document.querySelector("[data-hold]");
  if (!K || !root) return;
  const { N, TR, NOISE, fft2, coilMaps, coilScan, unfold, think, NET_URL, gauss, drawCat, render } = K;
  const MM = 2; // millimetres a pixel: the camera's square taken as about 25 cm across
  const STILL = 3; // mm: moved further than this from the start, a line counts as moved

  // The scans, every line, every fourth or every eighth, from the top down.
  const PLANS = { full: { R: 1 }, fourth: { R: 4 }, eighth: { R: 8 } };
  for (const plan of Object.values(PLANS)) {
    plan.lines = [];
    for (let s = -N / 2; s < N / 2; s++) if (s % plan.R === 0) plan.lines.push((s + N) % N);
  }
  const clockOf = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const SAID = {
    still: "You held still the whole time: no ghosts. A patient does that for every scan, often for half an hour.",
    moved: (mm) => `You moved about ${mm} mm while it scanned. The lines measured after that (in orange) came from you somewhere else, so you ghost.`,
    fourth: "Four times as fast, but from every fourth line alone you fold over yourself.",
    eighth: "Eight times as fast, but every eighth line folds you eight times over.",
    coils4: "The scanner listens with eight coils round you, each hearing best the part nearest it, which is enough to pull the copies apart.",
    coils8: "Eight coils, eight copies to pull apart: too many for them, and the copies do not quite come apart.",
    net: "The network cleans up what the coils leave with what it has learned. It has only ever seen cats, so what it does not know about you, it can only guess.",
    cat: "No camera, or it was not allowed: the cat from the home page sits in for you. It keeps still.",
    catStill: "The cat held still the whole time: no ghosts.",
    catFourth: "Four times as fast, but from every fourth line alone the cat folds over itself.",
    catEighth: "Eight times as fast, but every eighth line folds the cat eight times over.",
    catCoils4: "The scanner listens with eight coils round the cat, each hearing best the part nearest it, which is enough to pull the copies apart.",
    catNet: "The network cleans up what the coils leave with what it has learned, and it has seen many cats.",
  };

  const $ = (s) => root.querySelector(s);
  const kCanvas = $("[data-k]"),
    iCanvas = $("[data-img]"),
    clock = $("[data-clock]"),
    status = $("[data-status]"),
    caption = $("[data-caption]"),
    cameraButton = $("[data-camera]"),
    coilsButton = $("[data-coils]"),
    netButton = $("[data-net]"),
    saveButton = $("[data-save]"),
    planButtons = [...root.querySelectorAll("[data-plan]")];
  const kCtx = kCanvas.getContext("2d"),
    iCtx = iCanvas.getContext("2d");
  kCanvas.width = kCanvas.height = iCanvas.width = iCanvas.height = N;
  const kPix = kCtx.createImageData(N, N),
    iPix = iCtx.createImageData(N, N);
  const A = () => new Float64Array(N * N);
  const say = (text) => status.textContent !== text && (status.textContent = text);

  // ——— The picture: from the camera, or the cat ———
  // Grey, mirrored (as a mirror), and faded to dark towards the edges.
  const fade = A();
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const r = Math.hypot((x + 0.5) / N - 0.5, (y + 0.5) / N - 0.5);
      fade[y * N + x] = r < 0.36 ? 1 : r > 0.49 ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (r - 0.36)) / 0.13);
    }
  const grab = Object.assign(document.createElement("canvas"), { width: N, height: N }),
    gCtx = grab.getContext("2d", { willReadFrequently: true });
  let video = null,
    stream = null,
    cat = null;
  function picture() {
    if (!video) return (cat = cat || render(drawCat));
    const w = video.videoWidth,
      h = video.videoHeight,
      s = Math.min(w, h);
    if (!s) return null;
    gCtx.setTransform(-1, 0, 0, 1, N, 0);
    gCtx.drawImage(video, (w - s) / 2, (h - s) / 2, s, s, 0, 0, N, N);
    const d = gCtx.getImageData(0, 0, N, N).data,
      img = A();
    for (let i = 0; i < N * N; i++) img[i] = Math.pow((0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) / 255, 1.2) * fade[i];
    return img;
  }
  const kspaceOf = (img) => {
    const re = Float64Array.from(img),
      im = A();
    fft2(re, im, false);
    return [re, im];
  };

  // ——— Drawing ———
  const logOf = ([re, im]) => {
    const out = A();
    for (let i = 0; i < N * N; i++) out[i] = Math.log1p(Math.hypot(re[i], im[i]));
    return out;
  };
  const ky = (r) => (r + N / 2) % N; // panel row → ky
  // k-space: `rows` measured (1) or measured while moved (2), from `measured`;
  // the rest faintly from `behind` (the live picture's), or, once filled in,
  // from `filled` in blue; `current`, the line being measured, in white-blue.
  function drawK(measured, rows, behind, filled, current) {
    let top = 0;
    for (const s of [measured, behind, filled]) if (s) for (let i = 0; i < N * N; i++) top = Math.max(top, s[i]);
    const d = kPix.data;
    for (let r = 0; r < N; r++) {
      const k = ky(r),
        from = rows ? rows[k] : 0,
        s = from ? measured : filled || behind,
        dim = from || filled ? 1 : rows ? 0.12 : 1;
      for (let c = 0; c < N; c++) {
        const v = 255 * dim * Math.pow(s[k * N + ((c + N / 2) % N)] / top, 1.15),
          p = 4 * (r * N + c);
        if (k === current) [d[p], d[p + 1], d[p + 2]] = [120 + v * 0.5, 200 + v * 0.2, 255];
        else if (from === 2) [d[p], d[p + 1], d[p + 2]] = [v + 45, v * 0.62 + 12, v * 0.4];
        else if (!from && filled) [d[p], d[p + 1], d[p + 2]] = [v * 0.35, v * 0.75 + 10, v + 40];
        else d[p] = d[p + 1] = d[p + 2] = v;
        d[p + 3] = 255;
      }
    }
    kCtx.putImageData(kPix, 0, 0);
  }
  // The image, windowed to its brightest pixels, as a scanner's viewer would.
  const sorted = A();
  function show([re, im]) {
    const mag = A();
    for (let i = 0; i < N * N; i++) sorted[i] = mag[i] = Math.hypot(re[i], im[i]);
    sorted.sort();
    const gain = 1 / Math.max(1e-6, sorted[Math.floor(0.997 * (N * N - 1))]);
    for (let i = 0; i < N * N; i++) {
      const v = Math.round(255 * Math.min(1, gain * mag[i]));
      iPix.data[4 * i] = iPix.data[4 * i + 1] = iPix.data[4 * i + 2] = v;
      iPix.data[4 * i + 3] = 255;
    }
    iCtx.putImageData(iPix, 0, 0);
  }

  // ——— The scan ———
  let plan = "fourth",
    scanning = false,
    began = 0,
    done = 0,
    rows = new Uint8Array(N), // which lines are measured: 1, or 2 if moved
    frames = [], // the picture each line was measured from
    measured = [A(), A()], // single-coil k-space, the lines measured, with noise
    reference = null, // the k-space of the first picture, for how far you move
    moved = 0, // the furthest, in mm
    result = null, // what is shown once filled in
    mode = "measured",
    thinking = false;
  const length = () => PLANS[plan].lines.length * TR;

  // How far picture b has moved from a (their k-spaces), in pixels: phase
  // correlation, with a parabola through the peak for the fraction.
  function shiftOf([ar, ai], [br, bi]) {
    const re = A(),
      im = A();
    for (let i = 0; i < N * N; i++) {
      const cr = ar[i] * br[i] + ai[i] * bi[i],
        ci = ai[i] * br[i] - ar[i] * bi[i],
        m = Math.hypot(cr, ci) || 1;
      re[i] = cr / m;
      im[i] = ci / m;
    }
    fft2(re, im, true);
    let p = 0;
    for (let i = 1; i < N * N; i++) if (re[i] > re[p]) p = i;
    const py = Math.floor(p / N),
      px = p % N,
      at = (y, x) => re[((y + N) % N) * N + ((x + N) % N)],
      part = (a, b, c) => (a - c) / (2 * (a - 2 * b + c) || 1);
    const dx = (px > N / 2 ? px - N : px) + part(at(py, px - 1), at(py, px), at(py, px + 1)),
      dy = (py > N / 2 ? py - N : py) + part(at(py - 1, px), at(py, px), at(py + 1, px));
    return Math.hypot(dx, dy);
  }

  // The image from the lines measured, each weighted by how sparsely its
  // neighbourhood was measured, as on the home page.
  function zeroFilled() {
    const re = A(),
      im = A();
    for (let r = 0; r < N; r++) {
      const k = ky(r);
      if (!rows[k]) continue;
      let near = 0;
      for (let q = r - 4; q < r + 4; q++) if (rows[ky((q + N) % N)]) near++;
      const w = 8 / near / (N * N);
      for (let c = k * N; c < (k + 1) * N; c++) {
        re[c] = w * measured[0][c];
        im[c] = w * measured[1][c];
      }
    }
    fft2(re, im, true, rows);
    return [re, im];
  }

  function start(name) {
    if (thinking) return;
    plan = name;
    scanning = true;
    began = performance.now();
    done = 0;
    rows = new Uint8Array(N);
    frames = [];
    measured = [A(), A()];
    reference = null;
    moved = 0;
    result = null;
    mode = "measured";
    coilsButton.hidden = netButton.hidden = saveButton.hidden = true;
    coilsButton.setAttribute("aria-pressed", "false");
    netButton.setAttribute("aria-pressed", "false");
    caption.textContent = video ? "you" : "the cat";
    planButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.plan === name)));
    say(video ? "Hold still." : SAID.cat);
    clock.textContent = `0:00 of ${clockOf(length())}`;
  }
  function scanStep(now, img, F) {
    const lines = PLANS[plan].lines,
      t = Math.min(length(), (now - began) / 1000),
      due = Math.min(lines.length, Math.floor(t / TR) + 1);
    for (; done < due; done++) {
      const k = lines[done];
      reference = reference || F;
      const mm = video ? shiftOf(reference, F) * MM : 0;
      moved = Math.max(moved, mm);
      rows[k] = moved > STILL ? 2 : 1;
      frames[k] = img;
      for (let c = k * N; c < (k + 1) * N; c++) {
        measured[0][c] = F[0][c] + NOISE * gauss();
        measured[1][c] = F[1][c] + NOISE * gauss();
      }
      if (video) say(moved > STILL ? `You have moved about ${Math.round(moved)} mm.` : "Hold still.");
    }
    const over = done === lines.length;
    drawK(logOf(measured), rows, logOf(F), null, over ? -1 : lines[done - 1]);
    show(zeroFilled());
    clock.textContent = over ? clockOf(length()) : `${clockOf(t)} of ${clockOf(length())}`;
    if (over) finish();
  }
  function finish() {
    scanning = false;
    const R = PLANS[plan].R,
      still = moved <= STILL || !video;
    if (!video) say(R === 1 ? SAID.catStill : R === 4 ? SAID.catFourth : SAID.catEighth);
    else say(R === 1 ? (still ? SAID.still : SAID.moved(Math.round(moved))) : SAID[plan]);
    coilsButton.hidden = netButton.hidden = R === 1;
    saveButton.hidden = false;
  }

  // ——— Filling in ———
  // Whatever fills them in, the lines measured are put back as measured.
  function keepMeasured([re, im]) {
    const Kr = Float64Array.from(re),
      Ki = Float64Array.from(im);
    fft2(Kr, Ki, false);
    for (let k = 0; k < N; k++)
      if (rows[k])
        for (let c = k * N; c < (k + 1) * N; c++) {
          Kr[c] = measured[0][c];
          Ki[c] = measured[1][c];
        }
    const filled = logOf([Kr, Ki]);
    fft2(Kr, Ki, true);
    for (let i = 0; i < N * N; i++) {
      Kr[i] /= N * N;
      Ki[i] /= N * N;
    }
    return { image: [Kr, Ki], filled };
  }
  let maps = null,
    sense = null;
  function setMode(next) {
    if (thinking || scanning) return;
    mode = mode === next ? "measured" : next;
    coilsButton.setAttribute("aria-pressed", String(mode === "coils"));
    netButton.setAttribute("aria-pressed", String(mode === "net"));
    const R = PLANS[plan].R;
    if (mode === "measured") {
      result = null;
      caption.textContent = video ? "you" : "the cat";
      drawK(logOf(measured), rows, logOf(measured), null, -1);
      show(zeroFilled());
      return finish();
    }
    maps = maps || coilMaps();
    sense = unfold(
      maps,
      coilScan(maps, rows, (k) => frames[k]),
      rows,
      R
    );
    if (mode === "coils") {
      result = keepMeasured(sense);
      caption.textContent = `${video ? "you" : "the cat"}, unfolded with 8 coils`;
      say(R === 8 ? SAID.coils8 : video ? SAID.coils4 : SAID.catCoils4);
      drawK(logOf(measured), rows, null, result.filled, -1);
      return show(result.image);
    }
    thinking = true;
    caption.textContent = `${video ? "you" : "the cat"}, the network is thinking…`;
    coilsButton.disabled = netButton.disabled = true;
    think({ url: NET_URL, folded: Float32Array.from(sense[0]), R })
      .then((out) => {
        result = keepMeasured([Float64Array.from(out), A()]);
        caption.textContent = `${video ? "you" : "the cat"}, from the coils and a network`;
        say(video ? SAID.net : SAID.catNet);
        drawK(logOf(measured), rows, null, result.filled, -1);
        show(result.image);
      })
      .catch(() => {
        mode = "measured";
        netButton.setAttribute("aria-pressed", "false");
        caption.textContent = "you";
        say("The network could not be loaded just now.");
      })
      .finally(() => {
        thinking = false;
        coilsButton.disabled = netButton.disabled = false;
      });
  }

  // ——— Saving the scan, with a scanner viewer's corner notes ———
  function save() {
    const S = 512,
      c = Object.assign(document.createElement("canvas"), { width: S, height: S }),
      g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, S, S);
    g.imageSmoothingQuality = "high";
    g.drawImage(iCanvas, 0, 0, S, S);
    g.fillStyle = "#e8edf2";
    g.font = "16px ui-monospace, Menlo, Consolas, monospace";
    const day = new Date().toISOString().slice(0, 10),
      how = { measured: "AS MEASURED", coils: "UNFOLDED, 8 COILS", net: "COILS + NETWORK" }[mode],
      lines = { full: "EVERY LINE", fourth: "EVERY 4TH LINE", eighth: "EVERY 8TH LINE" }[plan];
    const note = (text, x, y, align) => {
      g.textAlign = align;
      g.fillText(text, x, y);
    };
    note("PATIENT: YOU", 14, 26, "left");
    note(day, 14, 46, "left");
    note("T1 SE  TR 500", S - 14, 26, "right");
    note(`${N} × ${N}`, S - 14, 46, "right");
    note(lines, 14, S - 34, "left");
    note(how, 14, S - 14, "left");
    note(`SCAN ${clockOf(length())}`, S - 14, S - 14, "right");
    c.toBlob((blob) => {
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "my-scan.png" });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    });
  }

  // ——— The camera ———
  async function camera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = video = null;
      cameraButton.textContent = "use the camera";
      say("The camera is off.");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, srcObject: stream });
      await video.play();
      done = 0;
      result = null;
      caption.textContent = "you";
      cameraButton.textContent = "stop the camera";
      say("This is you, as the scanner would see you, and your k-space. Choose a scan, and hold still.");
    } catch (e) {
      stream = video = null;
      caption.textContent = "the cat";
      say(SAID.cat);
    }
  }

  // Every frame: the live picture and its k-space, or the scan as it goes.
  let last = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    if (now - last < 45 || thinking) return; // about twenty pictures a second is plenty
    last = now;
    if (!scanning && (result || done)) return; // a scan on show: leave it
    const img = picture();
    if (!img) return;
    const F = kspaceOf(img);
    if (scanning) return scanStep(now, img, F);
    drawK(logOf(F), null, logOf(F), null, -1);
    show([img, A()]);
  }

  cameraButton.addEventListener("click", camera);
  for (const b of planButtons) {
    b.querySelector("[data-time]").textContent = clockOf(PLANS[b.dataset.plan].lines.length * TR);
    b.addEventListener("click", () => start(b.dataset.plan));
  }
  coilsButton.addEventListener("click", () => setMode("coils"));
  netButton.addEventListener("click", () => setMode("net"));
  saveButton.addEventListener("click", save);
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cameraButton.hidden = true;
    caption.textContent = "the cat";
    say(SAID.cat);
  }
  requestAnimationFrame(tick);
})();
