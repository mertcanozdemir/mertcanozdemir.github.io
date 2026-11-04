// The Kamboni's cab: driving the ice resurfacer from its seat, between periods
// of the hockey game (game.js starts it). In 3D, with WebGL: the ice is the
// game's own rink drawing, frosted and scratched up, turning to wet ice where
// the Kamboni has been; round it the boards, the glass and the stands. Over
// that what the driver sits in, open on top as on a real resurfacer: the
// snow tank beside the seat with a mirror on an arm looking back at the clean
// band, the white front deck with the wheel, a camera's screen showing the
// ice round the Kamboni from above, a gauge for how clean the ice is and a
// cat that sways along and nods or shakes its head at the driving; a lane
// laser on the ice ahead; and a map of the rink.
//
// Rink coordinates as in the game, in metres: x along the rink, y across it
// (+y the near side), h up. WebGL's X, Y and Z are x, h and y.
(function (root) {
  const PX = 32, // ice texture pixels a metre, over 64 × 32 m
    TW = 64 * PX,
    TH = 32 * PX;
  const EYE = { up: 2.5, ahead: 1, left: 0.45, pitch: -0.23 }; // the driver's, from the Kamboni's middle
  const ARENA = [0.11, 0.125, 0.15]; // the dark of the arena, and its haze

  // ——— Matrices: column-major 4 × 4, as WebGL takes them ———
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2),
      nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  // Straight on, without perspective: `hw` and `hh` metres either side.
  function ortho(hw, hh, near, far) {
    return [1 / hw, 0, 0, 0, 0, 1 / hh, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1];
  }
  function lookAt(e, c, u) {
    let zx = e[0] - c[0],
      zy = e[1] - c[1],
      zz = e[2] - c[2],
      l = Math.hypot(zx, zy, zz);
    [zx, zy, zz] = [zx / l, zy / l, zz / l];
    let xx = u[1] * zz - u[2] * zy,
      xy = u[2] * zx - u[0] * zz,
      xz = u[0] * zy - u[1] * zx;
    l = Math.hypot(xx, xy, xz);
    [xx, xy, xz] = [xx / l, xy / l, xz / l];
    const yx = zy * xz - zz * xy,
      yy = zz * xx - zx * xz,
      yz = zx * xy - zy * xx;
    const dot = (a, b, c) => a * e[0] + b * e[1] + c * e[2];
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -dot(xx, xy, xz), -dot(yx, yy, yz), -dot(zx, zy, zz), 1];
  }
  function mul(a, b) {
    const o = new Array(16);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        o[i * 4 + j] = s;
      }
    return o;
  }

  const VERT = `attribute vec3 p; attribute vec2 t; attribute vec4 c;
uniform mat4 m; uniform float flip; varying vec2 vt; varying vec4 vc; varying float vd;
void main() { vec4 q = m * vec4(p, 1.0); q.x *= flip; gl_Position = q; vt = t; vc = c; vd = q.w; }`;
  const FRAG = `precision mediump float;
uniform sampler2D tex; uniform float textured; uniform float cut; uniform vec3 haze;
varying vec2 vt; varying vec4 vc; varying float vd;
void main() {
  vec4 col = vc;
  if (textured > 0.5) col *= texture2D(tex, vt);
  if (col.a < cut) discard;
  gl_FragColor = vec4(mix(col.rgb, haze, clamp((vd - 25.0) / 110.0, 0.0, 0.5)), col.a);
}`;

  // Any CSS colour as [r, g, b, a], each 0 to 1.
  const probe = document.createElement("canvas").getContext("2d");
  function rgba(css) {
    probe.fillStyle = "#000";
    probe.fillStyle = css;
    const v = probe.fillStyle;
    if (v[0] === "#") return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).concat(1);
    const n = v.match(/[\d.]+/g).map(Number);
    return [n[0] / 255, n[1] / 255, n[2] / 255, n.length > 3 ? n[3] : 1];
  }
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // An SVG drawing in rink metres, onto a 64 × 32 m canvas; the page's CSS
  // variables are put in, since an image cannot see them.
  function rasterize(markup, canvas, done, box = "-32 -16 64 32") {
    const text = markup.replace(/var\((--[\w-]+)\)/g, (m, name) => cssVar(name) || "#888");
    const img = new Image();
    img.onload = () => {
      const ctx = ctx2d(canvas);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      done(true);
    };
    img.onerror = () => done(false);
    img.src =
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="${box}">${text}</svg>`);
  }
  const canvas2d = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
  // A 2D context that is read back often (for WebGL), so kept off the GPU.
  const ctx2d = (c) => c.getContext("2d", { willReadFrequently: true });

  // The boards' white face, 20 m of it: an advert for the Kamboni now and then.
  function boardsTexture() {
    const c = canvas2d(1024, 64),
      g = c.getContext("2d");
    g.fillStyle = "#f6f8fa";
    g.fillRect(0, 0, 1024, 64);
    g.fillStyle = cssVar("--rink-team-a") || "#1f6fd0";
    g.fillRect(0, 2, 1024, 4);
    g.font = "bold 36px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("KAMBONI", 512, 36);
    return c;
  }
  // The stands: 10 × 5 m of them, rows of seats 0.83 m apart, about half of
  // the seats taken (it is the intermission).
  function crowdTexture() {
    const c = canvas2d(512, 256),
      g = c.getContext("2d");
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const shirts = [cssVar("--rink-team-a"), cssVar("--rink-team-b"), "#e9edf1", "#59626c", "#b3261e", "#2b2f36", cssVar("--rink-team-a")];
    const skins = ["#f1c8a6", "#e8b896", "#e2ad86"];
    for (let row = 0; row < 6; row++) {
      const y0 = Math.round((row * 256) / 6),
        y1 = Math.round(((row + 1) * 256) / 6);
      g.fillStyle = row % 2 ? "#2e333a" : "#353b43";
      g.fillRect(0, y0, 512, y1 - y0);
      g.fillStyle = "#454c55";
      g.fillRect(0, y1 - 13, 512, 5); // the seats' backs
      for (let x = 12; x < 512; x += 25.6) {
        if (rnd() > 0.5) continue;
        const px = x + (rnd() - 0.5) * 4;
        g.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
        g.beginPath();
        if (g.roundRect) g.roundRect(px - 7, y1 - 26, 14, 18, 5);
        else g.rect(px - 7, y1 - 26, 14, 18);
        g.fill();
        g.fillStyle = skins[Math.floor(rnd() * skins.length)];
        g.beginPath();
        g.arc(px, y1 - 31, 5.5, 0, 2 * Math.PI);
        g.fill();
      }
    }
    return c;
  }
  // Two triangles a quad, nine numbers a corner: x, h, y, u, v, r, g, b, a.
  function quads() {
    const v = [];
    return {
      v,
      add(a, b, c, d, col, uv = [-1, -1, -1, -1]) {
        const [u0, v0, u1, v1] = uv,
          t = [
            [u0, v0],
            [u1, v0],
            [u1, v1],
            [u0, v1],
          ],
          p = [a, b, c, d];
        for (const i of [0, 1, 2, 0, 2, 3]) v.push(p[i][0], p[i][1], p[i][2], t[i][0], t[i][1], ...col);
      },
    };
  }

  // Round the driver, who sits up high in the open, on the left, as on a
  // real resurfacer (a cab is an extra): no roof and no windscreen. On the
  // right the side of the snow tank beside the seat, a mirror on an arm from
  // it (MIRROR, in hundredths of the view), and a grab rail on the left.
  const MIRROR = { x: 73, y: 7, w: 17, h: 22 };
  const FRAME_SVG = `<path d="M 88.5 50 L 91 22 Q 91.3 19.6 93.4 19 L 100 17 V 50 Z" fill="var(--rink-rz-tank)"/>
    <path d="M 88.5 50 L 91 22 Q 91.3 19.6 93.4 19 L 100 17" fill="none" stroke="var(--rink-rz-edge)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    <path d="M 89.9 34.5 L 100 31.6" stroke="var(--rink-team-a)" stroke-width="7" vector-effect="non-scaling-stroke"/>
    <path d="M 96.5 18.2 Q 95.6 13.5 ${MIRROR.x + MIRROR.w} ${(MIRROR.y + MIRROR.h * 0.75) / 2}" fill="none" stroke="#2b3036" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <rect x="${MIRROR.x}" y="${MIRROR.y / 2}" width="${MIRROR.w}" height="${MIRROR.h / 2}" rx="2.2" fill="none" stroke="#1b1f25" stroke-width="7" vector-effect="non-scaling-stroke"/>
    <path d="M 0.6 50 L 2.4 31 Q 2.8 28.2 5.6 27.6" fill="none" stroke="#c3cad1" stroke-width="7" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path d="M 0.6 50 L 2.4 31 Q 2.8 28.2 5.6 27.6" fill="none" stroke="#8d98a4" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  // Ahead of the driver, the Kamboni's white front deck with its rounded
  // edge, and on it the steering column with the wheel, and a panel with the
  // camera's screen (SCREEN: the ice round the Kamboni from above, as the
  // GL draws it through the hole) and the ICE gauge; the nodding cat.
  const SCREEN = { x: 182, y: 15, w: 64, h: 33 };
  const DASH_SVG = `<defs><mask id="cab-screen-hole" maskUnits="userSpaceOnUse" x="-300" y="-20" width="1000" height="90">
      <rect x="-300" y="-20" width="1000" height="90" fill="#fff"/>
      <rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="${SCREEN.h}" rx="2.5" fill="#000"/></mask></defs>
    <g mask="url(#cab-screen-hole)">
      <path d="M -300 60 V 25 Q 200 8 700 25 V 60 Z" fill="var(--rink-rz)"/>
      <path d="M -300 25 Q 200 8 700 25" fill="none" stroke="var(--rink-rz-edge)" stroke-width="0.9"/>
      <path d="M -300 29.5 Q 200 12.5 700 29.5" fill="none" stroke="var(--rink-team-a)" stroke-width="1.6"/>
      <path d="M 64 60 L 76 33 Q 120 27 164 33 L 176 60 Z" fill="#1b1f25"/>
      <path d="M 172 60 L 176 17 Q 177 11 183 11 H 298 Q 304 11 305 17 L 309 60 Z" fill="#1b1f25"/>
    </g>
    <rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="${SCREEN.h}" rx="2.5" fill="none" stroke="#3b424b" stroke-width="0.9"/>
    <text x="${SCREEN.x + 2.5}" y="${SCREEN.y + 4.4}" font-size="3" font-weight="700" fill="#e6ebf0" opacity="0.85" style="paint-order: stroke" stroke="#0f1215" stroke-width="0.8">ICE CAM</text>
    <g transform="translate(118 52)"><g data-wheel>
      <circle r="34" fill="none" stroke="#2b3036" stroke-width="7"/>
      <circle r="37.2" fill="none" stroke="#434a53" stroke-width="0.8"/>
      <path d="M -31 4 L -8 1 M 31 4 L 8 1 M 0 8 V 30" stroke="#2b3036" stroke-width="5" stroke-linecap="round"/>
      <circle r="9" fill="#2b3036"/><text y="2.6" font-size="7.5" font-weight="700" text-anchor="middle" fill="#8b949e">K</text>
      <ellipse cx="-29" cy="-17" rx="6" ry="8" transform="rotate(-30 -29 -17)" fill="var(--rink-team-a)"/>
      <ellipse cx="29" cy="-17" rx="6" ry="8" transform="rotate(30 29 -17)" fill="var(--rink-team-a)"/></g></g>
    <g transform="translate(275 31)">
      <circle r="13.5" fill="#0f1215" stroke="#3b424b" stroke-width="0.8"/>
      <path data-goal fill="none" stroke="#34c759" stroke-width="2.2"/>
      <line data-needle y2="-10.5" stroke="#ff6b4a" stroke-width="1.4" stroke-linecap="round"/>
      <circle r="1.6" fill="#3b424b"/>
      <text y="-4.2" font-size="3.4" text-anchor="middle" fill="#8b949e">ICE</text>
      <text data-ice y="8.5" font-size="4.6" font-weight="700" text-anchor="middle" fill="#e6ebf0">0%</text></g>
    <g transform="translate(338 27)">
      <rect x="-5" y="-1" width="10" height="9" rx="2" fill="#4a525c"/>
      <g data-cat><path d="M 0 -2 V -4" stroke="#8b949e" stroke-width="1"/>
        <path d="M -6.4 -11 L -5.4 -19 L -1.4 -14.6 Z M 6.4 -11 L 5.4 -19 L 1.4 -14.6 Z" fill="#a9b1ba"/>
        <circle cy="-10" r="7" fill="#a9b1ba"/>
        <circle cx="-2.6" cy="-11" r="1.2" fill="#1b1f25"/><circle cx="2.6" cy="-11" r="1.2" fill="#1b1f25"/>
        <path d="M -0.9 -8.6 H 0.9 L 0 -7.7 Z" fill="#e8919a"/>
        <path d="M -2 -8 L -7.5 -9 M -2 -7.4 L -7.5 -6.8 M 2 -8 L 7.5 -9 M 2 -7.4 L 7.5 -6.8" stroke="#6b737d" stroke-width="0.35"/></g></g>`;

  function KamboniCab(stage, deps) {
    const { RZ, outline } = deps;
    const el = document.createElement("div");
    el.className = "game-cab";
    el.hidden = true;
    const view = document.createElement("canvas");
    el.appendChild(view);
    const gl = view.getContext("webgl", { antialias: true, alpha: false });
    if (!gl) return null;
    el.insertAdjacentHTML(
      "beforeend",
      `<svg class="cab-frame" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true">${FRAME_SVG}</svg>
      <svg class="cab-dash" viewBox="0 0 400 50" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${DASH_SVG}</svg>
      <svg class="cab-map" viewBox="-31 -16 62 32" aria-hidden="true">
        <rect x="-30" y="-15" width="60" height="30" rx="8.5" fill="var(--rink-ice)" fill-opacity="0.92" stroke="var(--rink-board)" stroke-width="0.8"/>
        <path d="M 0 -15 V 15 M -26 -13 V 13 M 26 -13 V 13" stroke="var(--rink-red)" stroke-width="0.5"/>
        <path d="M -7.5 -15 V 15 M 7.5 -15 V 15" stroke="var(--rink-blue)" stroke-width="0.6"/>
        <polyline data-track fill="none" stroke="var(--rink-team-a)" stroke-opacity="0.45" stroke-width="${RZ.width}" stroke-linecap="round" stroke-linejoin="round"/>
        <path data-me d="M 3 0 L -2.2 -1.9 L -1.2 0 L -2.2 1.9 Z" fill="#ffd54a" stroke="#14171b" stroke-width="0.4" stroke-linejoin="round"/></svg>`
    );
    stage.querySelector("svg").after(el);
    const $ = (s) => el.querySelector(s);
    const parts = {
      wheel: $("[data-wheel]"),
      screen: $(".cab-dash"),
      needle: $("[data-needle]"),
      ice: $("[data-ice]"),
      cat: $("[data-cat]"),
      track: $("[data-track]"),
      me: $("[data-me]"),
    };
    // The gauge's green: from what is enough to all of it.
    const arc = (a) => [Math.sin(a) * 11, -Math.cos(a) * 11].map((v) => v.toFixed(2)).join(" ");
    const a0 = ((-120 + 240 * RZ.done) * Math.PI) / 180;
    $("[data-goal]").setAttribute("d", `M ${arc(a0)} A 11 11 0 0 1 ${arc((120 * Math.PI) / 180)}`);

    // ——— WebGL ———
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const at = { p: gl.getAttribLocation(prog, "p"), t: gl.getAttribLocation(prog, "t"), c: gl.getAttribLocation(prog, "c") };
    const un = {
      m: gl.getUniformLocation(prog, "m"),
      flip: gl.getUniformLocation(prog, "flip"),
      textured: gl.getUniformLocation(prog, "textured"),
      cut: gl.getUniformLocation(prog, "cut"),
      haze: gl.getUniformLocation(prog, "haze"),
    };
    gl.uniform3fv(un.haze, ARENA);
    gl.enable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    function texture(source, repeat) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (aniso)
        gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      gl.generateMipmap(gl.TEXTURE_2D);
      return t;
    }
    function mesh(q, tex, glass) {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(q.v), gl.STATIC_DRAW);
      return { buf, n: q.v.length / 9, tex, glass };
    }

    // The ice: the rink drawing as it is now (dirty), and as it will be (clean,
    // wet); the clean one is painted onto the dirty one along the track.
    const dirty = canvas2d(TW, TH),
      clean = canvas2d(TW, TH);
    const iceTex = texture(dirty, false);
    let meshes = [],
      boardTex = null,
      crowdTex = null,
      job = 0; // the latest drawing of the ice asked for: an older one finishing late is dropped
    let rz = null,
      ready = 0,
      painted = 0,
      pattern = null,
      mapPoints = "",
      mapped = 0;

    // The arena, built when the colours are known (they follow the theme).
    function build() {
      for (const m of meshes) gl.deleteBuffer(m.buf);
      const wall = rgba(cssVar("--rink-wall") || "#fdfefe"),
        trim = rgba(cssVar("--rink-board") || "#c8ced4");
      const ice = quads(),
        boards = quads(),
        plain = quads(),
        stands = quads(),
        glass = quads();
      ice.add([-32, 0, -16], [32, 0, -16], [32, 0, 16], [-32, 0, 16], [1, 1, 1, 1], [0, 0, 1, 1]);
      const pts = outline();
      let s = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i],
          b = pts[(i + 1) % pts.length],
          len = Math.hypot(b.x - a.x, b.y - a.y);
        const P = (o, h, q) => [q.x + q.nx * o, h, q.y + q.ny * o];
        const band = (h0, h1, col, o0 = 0, o1 = 0) => plain.add(P(o0, h0, a), P(o0, h0, b), P(o1, h1, b), P(o1, h1, a), col);
        band(0, 0.22, trim);
        boards.add(P(0, 0.22, a), P(0, 0.22, b), P(0, 1, b), P(0, 1, a), wall, [s / 20, 1, (s + len) / 20, 0]);
        band(1, 1.15, trim);
        band(1.15, 1.15, trim, 0, 0.2);
        glass.add(P(0.08, 1.15, a), P(0.08, 1.15, b), P(0.08, 2.9, b), P(0.08, 2.9, a), [0.8, 0.88, 0.95, 0.13]);
        glass.add(P(0.08, 2.84, a), P(0.08, 2.84, b), P(0.08, 2.9, b), P(0.08, 2.9, a), [0.9, 0.95, 1, 0.45]);
        stands.add(P(0.4, 1.2, a), P(0.4, 1.2, b), P(24, 16.5, b), P(24, 16.5, a), [1, 1, 1, 1], [s / 10, 5.6, (s + len) / 10, 0]);
        s += len;
      }
      // The nets, for the replay (the Kamboni's ice has none: the crew took
      // them off): red posts, crossbar and base, white mesh, as in the game.
      const frame = quads(),
        net = quads(),
        red = rgba(cssVar("--rink-red") || "#d33"),
        white = [0.95, 0.96, 0.98, 0.32];
      // A box between two corners (rink x, y and heights): its sides and top.
      const box = (x0, x1, y0, y1, h0, h1) => {
        frame.add([x0, h0, y0], [x1, h0, y0], [x1, h1, y0], [x0, h1, y0], red);
        frame.add([x0, h0, y1], [x1, h0, y1], [x1, h1, y1], [x0, h1, y1], red);
        frame.add([x0, h0, y0], [x0, h0, y1], [x0, h1, y1], [x0, h1, y0], red);
        frame.add([x1, h0, y0], [x1, h0, y1], [x1, h1, y1], [x1, h1, y0], red);
        frame.add([x0, h1, y0], [x1, h1, y0], [x1, h1, y1], [x0, h1, y1], red);
      };
      const w = 0.05;
      for (const side of [1, -1]) {
        const x0 = side * deps.goal.x,
          x1 = side * (deps.goal.x + deps.goal.depth),
          h = deps.goal.half,
          top = 1.8,
          low = 1.0;
        const [xa, xb] = [Math.min(x0, x1), Math.max(x0, x1)];
        box(x0 - w, x0 + w, -h - w, -h + w, 0, top);
        box(x0 - w, x0 + w, h - w, h + w, 0, top);
        box(x0 - w, x0 + w, -h - w, h + w, top - w, top + w);
        box(xa, xb, -h - w, -h + w, 0, 2 * w);
        box(xa, xb, h - w, h + w, 0, 2 * w);
        box(x1 - w, x1 + w, -h - w, h + w, 0, 2 * w);
        net.add([x1, 0, -h], [x1, 0, h], [x1, low, h], [x1, low, -h], white);
        net.add([x0, 0, -h], [x1, 0, -h], [x1, low, -h], [x0, top, -h], white);
        net.add([x0, 0, h], [x1, 0, h], [x1, low, h], [x0, top, h], white);
        net.add([x0, top, -h], [x0, top, h], [x1, low, h], [x1, low, -h], white);
      }
      for (const t of [boardTex, crowdTex]) if (t) gl.deleteTexture(t);
      boardTex = texture(boardsTexture(), true);
      crowdTex = texture(crowdTexture(), true);
      meshes = [
        mesh(ice, iceTex),
        mesh(plain, null),
        mesh(boards, boardTex),
        mesh(stands, crowdTex),
        Object.assign(mesh(frame, null), { replay: true }),
        mesh(glass, null, true),
        Object.assign(mesh(net, null, true), { replay: true }),
      ];
    }

    function scene(mvp, flip, replaying = false, extra = []) {
      gl.uniformMatrix4fv(un.m, false, mvp);
      gl.uniform1f(un.flip, flip);
      gl.uniform1f(un.cut, 0);
      for (const m of meshes.slice(0, 4).concat(extra, meshes.slice(4))) {
        if (m.replay && !replaying) continue;
        gl.uniform1f(un.cut, m.cut || 0);
        const blend = m.glass || m.flat;
        if (blend) {
          gl.enable(gl.BLEND);
          gl.depthMask(false);
        }
        if (m.flat) gl.disable(gl.DEPTH_TEST);
        gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
        gl.enableVertexAttribArray(at.p);
        gl.enableVertexAttribArray(at.t);
        gl.enableVertexAttribArray(at.c);
        gl.vertexAttribPointer(at.p, 3, gl.FLOAT, false, 36, 0);
        gl.vertexAttribPointer(at.t, 2, gl.FLOAT, false, 36, 12);
        gl.vertexAttribPointer(at.c, 4, gl.FLOAT, false, 36, 20);
        gl.uniform1f(un.textured, m.tex ? 1 : 0);
        if (m.tex) gl.bindTexture(gl.TEXTURE_2D, m.tex);
        gl.drawArrays(gl.TRIANGLES, 0, m.n);
        if (blend) {
          gl.disable(gl.BLEND);
          gl.depthMask(true);
        }
        if (m.flat) gl.enable(gl.DEPTH_TEST);
      }
    }

    // New track since the last frame: clean ice painted onto the dirty, and
    // only that patch sent to the texture.
    function paint() {
      if (ready < 2 || painted >= rz.track.length) return;
      const g = ctx2d(dirty),
        from = Math.max(0, painted - 1),
        pad = (RZ.width * PX) / 2 + 2;
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      g.save();
      g.strokeStyle = pattern;
      g.lineWidth = RZ.width * PX;
      g.lineCap = g.lineJoin = "round";
      g.beginPath();
      for (let i = from; i < rz.track.length; i++) {
        const px = (rz.track[i][0] + 32) * PX,
          py = (rz.track[i][1] + 16) * PX;
        if (i === from) g.moveTo(px, py);
        g.lineTo(px + (i === from ? 0.01 : 0), py);
        [x0, y0, x1, y1] = [Math.min(x0, px), Math.min(y0, py), Math.max(x1, px), Math.max(y1, py)];
      }
      g.stroke();
      g.restore();
      painted = rz.track.length;
      const rx = Math.max(0, Math.floor(x0 - pad)),
        ry = Math.max(0, Math.floor(y0 - pad)),
        rw = Math.min(TW, Math.ceil(x1 + pad)) - rx,
        rh = Math.min(TH, Math.ceil(y1 + pad)) - ry;
      if (rw <= 0 || rh <= 0) return;
      gl.bindTexture(gl.TEXTURE_2D, iceTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, rx, ry, gl.RGBA, gl.UNSIGNED_BYTE, g.getImageData(rx, ry, rw, rh));
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    // ——— The replay: a goal seen again from the scorer's eyes ———
    // The players and the referee as their drawings, standing up and turned
    // to the eye (front or back as they face it), life size, each with a
    // shadow; the puck, facing the eye, and its streak when it flies.
    const CELL = { w: 3.4, h: 4.2, foot: 3.6, cols: 8 }, // in drawing units (a goalie in the butterfly is 3 across)
      M = 0.686, // metres a drawing unit: 2.77 units of player are 1.9 m
      ATLAS = 2048, // the drawings' texture, pixels across
      atlas = canvas2d(1, 1),
      dyn = {
        sprites: gl.createBuffer(),
        shadows: gl.createBuffer(),
        puck: gl.createBuffer(),
        streak: gl.createBuffer(),
        machine: gl.createBuffer(),
        wet: gl.createBuffer(),
        laser: gl.createBuffer(),
      };
    let atlasTex = null,
      atlasV = 1, // the texture's height in drawing units
      sprites = 0,
      poses = {}, // where in the texture the referee and the goalies' other stances are
      replayReady = false,
      cam = null;
    function prepareReplay(markups, marks, pose = {}) {
      const mine = ++job;
      poses = pose;
      replayReady = false;
      cam = null;
      build(); // in the theme's colours of the moment
      const floor = `<rect x="-32" y="-16" width="64" height="32" fill="#2a2f36"/>`,
        rink = (root.rinkSVG ? root.rinkSVG() : "").replace(/<rect[^>]*data-rink-net[^>]*\/>/g, "");
      let waiting = 2;
      const done = () => --waiting || (replayReady = true);
      rasterize(`${floor}${rink}${marks ? marks.outerHTML.replace(/ mask="[^"]*"/, "") : ""}`, dirty, (ok) => {
        if (!ok || mine !== job) return;
        gl.bindTexture(gl.TEXTURE_2D, iceTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, dirty);
        gl.generateMipmap(gl.TEXTURE_2D);
        done();
      });
      // The drawings in a grid, on a texture a power of two in size (so it
      // can have mipmaps, and players far off do not shimmer).
      sprites = markups.length;
      const cols = CELL.cols,
        px = ATLAS / (cols * CELL.w);
      let h = 1;
      while (h < Math.ceil(sprites / cols) * CELL.h * px) h *= 2;
      [atlas.width, atlas.height] = [ATLAS, h];
      atlasV = h / px;
      const cells = markups
        .map((m, i) => `<g transform="translate(${(i % cols) * CELL.w + CELL.w / 2} ${Math.floor(i / cols) * CELL.h + CELL.foot})">${m}</g>`)
        .join("");
      rasterize(
        cells,
        atlas,
        (ok) => {
          if (!ok || mine !== job) return;
          if (atlasTex) gl.deleteTexture(atlasTex);
          atlasTex = texture(atlas, false);
          done();
        },
        `0 0 ${cols * CELL.w} ${atlasV}`
      );
    }
    // A drawing standing at (x, y) on the ice, cell `i` of the texture,
    // turned to the eye; or lying on the ice (`lie` 1 or -1: the head to the
    // eye's right or left), a player knocked down.
    function sprite(q, i, x, y, eye, lie = 0) {
      const cols = CELL.cols,
        u0 = (i % cols) / cols,
        u1 = u0 + 1 / cols,
        v0 = (Math.floor(i / cols) * CELL.h) / atlasV,
        v1 = v0 + CELL.h / atlasV;
      // The eye's right, so the drawing is not seen the wrong way round.
      let rx = eye[2] - y,
        ry = x - eye[0];
      const l = Math.hypot(rx, ry) || 1;
      [rx, ry] = [rx / l, ry / l];
      // A point of the drawing, `a` units across it and `b` up from its feet.
      const at = lie
        ? (a, b) => {
            const s = b * lie - 1.4 * lie; // along the ice: the body's middle where the player is
            return [x + rx * s * M, 0.55 - a * lie * M, y + ry * s * M];
          }
        : (a, b) => [x + rx * a * M, b * M, y + ry * a * M];
      const half = CELL.w / 2,
        foot = CELL.h - CELL.foot;
      q.add(at(-half, -foot), at(half, -foot), at(half, CELL.foot), at(-half, CELL.foot), [1, 1, 1, 1], [u0, v1, u1, v0]);
    }
    // A disc of radius `r` at `c`, either flat on the ice or facing the eye.
    function disc(q, c, r, col, eye) {
      let ax = [1, 0, 0],
        ay = [0, 0, 1];
      if (eye) {
        const f = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]],
          fl = Math.hypot(...f);
        const right = [-f[2], 0, f[0]].map((v) => v / (Math.hypot(f[0], f[2]) || 1));
        ax = right;
        ay = [(right[1] * f[2] - right[2] * f[1]) / fl, (right[2] * f[0] - right[0] * f[2]) / fl, (right[0] * f[1] - right[1] * f[0]) / fl];
      }
      const P = (a) => [0, 1, 2].map((k) => c[k] + (ax[k] * Math.cos(a) + ay[k] * Math.sin(a)) * r);
      for (let i = 0; i < 10; i++) q.add(c, P((i / 10) * 2 * Math.PI), P(((i + 1) / 10) * 2 * Math.PI), c, col);
    }
    function drawDynamic(buf, q, tex, more) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(q.v), gl.DYNAMIC_DRAW);
      return { buf, n: q.v.length / 9, tex, ...more };
    }
    // A stick, or any rod from `a` to `b`, `w` thick, facing the eye.
    function rod(q, a, b, w, col, eye) {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        m = [(a[0] + b[0]) / 2 - eye[0], (a[1] + b[1]) / 2 - eye[1], (a[2] + b[2]) / 2 - eye[2]];
      let c = [d[1] * m[2] - d[2] * m[1], d[2] * m[0] - d[0] * m[2], d[0] * m[1] - d[1] * m[0]];
      const l = Math.hypot(...c);
      if (l < 1e-9) return;
      c = c.map((v) => (v / l) * (w / 2));
      const off = (p, s) => p.map((v, i) => v + c[i] * s);
      q.add(off(a, -1), off(b, -1), off(b, 1), off(a, 1), col);
    }
    // One frame of a replay: `snap` holds the players, puck and referee as
    // they were; the eye is in the head of player `by`, watching the puck and
    // the net at `goalX` past it, and the goal light behind it is `lit` once
    // the puck is in. With no scorer, a camera behind the net.
    function replayFrame(snap, by, goalX, now, lit) {
      const dpr = Math.min(2, root.devicePixelRatio || 1),
        W = Math.round(view.clientWidth * dpr),
        H = Math.round(view.clientHeight * dpr);
      if (!W || !H) return;
      if (view.width !== W || view.height !== H) [view.width, view.height] = [W, H];
      const me = snap.players[by],
        pk = snap.puck,
        FOV = 1.1;
      const eye = me ? [me.x - me.fx * 0.3, 1.72, me.y - me.fy * 0.3] : [goalX + Math.sign(goalX) * 2.4, 2.3, 0];
      // Toward the puck and the net past it, and down far enough to keep the
      // puck in sight, low in the picture (on the stick, it is close below),
      // but not so far that the net goes out of it.
      const [tx, tz] = me ? [pk.x + (goalX - pk.x) * 0.35, pk.y * 0.65] : [pk.x, pk.y],
        below = Math.atan2(eye[1] - (pk.h || 0), Math.hypot(pk.x - eye[0], pk.y - eye[2]));
      const yaw = Math.atan2(tz - eye[2], tx - eye[0]),
        pitch = -Math.min(me ? 0.4 : 0.6, Math.max(0.06, below - FOV * 0.4));
      const dt = cam ? Math.min(0.1, (now - cam.now) / 1000) : 1,
        k = cam ? 1 - Math.exp(-dt * 7) : 1;
      cam = cam || { eye: eye.slice(), yaw, pitch, now };
      for (let i = 0; i < 3; i++) cam.eye[i] += (eye[i] - cam.eye[i]) * k;
      const turn = Math.atan2(Math.sin(yaw - cam.yaw), Math.cos(yaw - cam.yaw));
      cam.yaw = Math.atan2(Math.sin(cam.yaw + turn * k), Math.cos(cam.yaw + turn * k));
      cam.pitch += (pitch - cam.pitch) * k;
      cam.now = now;
      const at = [
        cam.eye[0] + Math.cos(cam.yaw) * Math.cos(cam.pitch),
        cam.eye[1] + Math.sin(cam.pitch),
        cam.eye[2] + Math.sin(cam.yaw) * Math.cos(cam.pitch),
      ];
      const people = quads(),
        shadows = quads(),
        shade = [0, 0, 0, 0.3];
      snap.players.forEach((p, i) => {
        if (i === by || p.off) return;
        disc(shadows, [p.x, 0, p.y], p.role === "goalie" ? 0.75 : 0.55, shade);
        // Facing away from the eye: its back.
        const away = p.fx * (cam.eye[0] - p.x) + p.fy * (cam.eye[2] - p.y) < 0,
          side = p.fx * (cam.eye[2] - p.y) - p.fy * (cam.eye[0] - p.x);
        // A goalie in its stance of the moment; on the post, the pad down on
        // the side the post is, to the eye.
        let cell = i * 2;
        const st = poses[i],
          stance = p.stance || "ready";
        if (st && stance === "butterfly") cell = st.butterfly;
        else if (st && stance === "post") {
          const post = [Math.sign(p.x) * deps.goal.x, (Math.sign(p.y) || 1) * deps.goal.half];
          cell = (post[0] - p.x) * (cam.eye[2] - p.y) + (post[1] - p.y) * (p.x - cam.eye[0]) > 0 ? st.postRight : st.postLeft;
        }
        sprite(people, cell + (away ? 1 : 0), p.x, p.y, cam.eye, p.down > 0 ? (side > 0 ? 1 : -1) : 0);
      });
      if (snap.ref) {
        disc(shadows, [snap.ref.x, 0, snap.ref.y], 0.5, shade);
        sprite(people, poses.ref ?? sprites - 1, snap.ref.x, snap.ref.y, cam.eye);
      }
      // The scorer's own stick, low in the picture: on the left or the right
      // as the drawings hold it (half shoot left, half right).
      const puck = quads(),
        streak = quads();
      if (me) {
        const hand = by % 2 ? 1 : -1,
          [fx, fz] = [me.fx, me.fy],
          [sx, sz] = [fz * hand, -fx * hand], // the stick's side
          P = (ahead, side, h) => [me.x + fx * ahead + sx * side, h, me.y + fz * ahead + sz * side];
        const stick = rgba(cssVar("--rink-stick") || "#3b3f44"),
          heel = P(1.12, 0.2, 0.03);
        rod(puck, P(0.12, 0.32, 0.95), heel, 0.045, stick, cam.eye);
        rod(puck, heel, P(1.36, -0.12, 0.03), 0.08, stick, cam.eye);
      }
      // The goal light on the glass behind the net: red once the puck is in.
      const lamp = [Math.sign(goalX) * 29.75, 3.15, 0];
      disc(puck, lamp, 0.24, lit ? [1, 0.2, 0.12, 1] : [0.32, 0.07, 0.06, 1], cam.eye);
      if (lit) disc(streak, lamp, 0.9, [1, 0.25, 0.15, 0.3], cam.eye);
      // The puck, bigger than a real one (which would be lost) and more so the
      // further off it is, and a streak behind it when it is shot.
      const R = Math.min(0.24, 0.05 + 0.014 * Math.hypot(pk.x - cam.eye[0], pk.y - cam.eye[2])),
        T = R * 0.6,
        h0 = pk.h || 0,
        body = rgba(cssVar("--rink-puck") || "#15171a"),
        ring = rgba(cssVar("--rink-puck-ring") || "#e8b93a");
      disc(shadows, [pk.x, 0, pk.y], R * 1.2, [0, 0, 0, 0.35]);
      // Black, with the gold ring round the edge of its top.
      const rim = (a, h, r = R) => [pk.x + Math.cos(a) * r, h, pk.y + Math.sin(a) * r];
      for (let i = 0; i < 12; i++) {
        const a0 = (i / 12) * 2 * Math.PI,
          a1 = ((i + 1) / 12) * 2 * Math.PI;
        puck.add([pk.x, h0 + T, pk.y], rim(a0, h0 + T, R * 0.72), rim(a1, h0 + T, R * 0.72), [pk.x, h0 + T, pk.y], body);
        puck.add(rim(a0, h0 + T, R * 0.72), rim(a1, h0 + T, R * 0.72), rim(a1, h0 + T), rim(a0, h0 + T), ring);
        puck.add(rim(a0, h0 + T * 0.78), rim(a1, h0 + T * 0.78), rim(a1, h0 + T), rim(a0, h0 + T), ring);
        puck.add(rim(a0, h0), rim(a1, h0), rim(a1, h0 + T * 0.78), rim(a0, h0 + T * 0.78), body);
      }
      const trail = (pk.trail || []).concat([[pk.x, pk.y]]),
        shot = rgba(cssVar("--rink-shot") || "#ffd54a"),
        hm = h0 + T / 2;
      for (let i = 1; i < trail.length; i++) {
        const [ax, az] = trail[i - 1],
          [bx, bz] = trail[i],
          // Across the streak as the eye sees it: square to its line and to the eye.
          dx = bx - ax,
          dz = bz - az,
          mx = (ax + bx) / 2 - cam.eye[0],
          my = hm - cam.eye[1],
          mz = (az + bz) / 2 - cam.eye[2];
        let [cx, cy, cz] = [-dz * my, dz * mx - dx * mz, dx * my];
        const cl = Math.hypot(cx, cy, cz);
        if (cl < 1e-6) continue;
        [cx, cy, cz] = [cx / cl, cy / cl, cz / cl];
        const w0 = (0.16 * (i - 1)) / trail.length,
          w1 = (0.16 * i) / trail.length,
          side = (x, z, w, s) => [x + cx * w * s, hm + cy * w * s, z + cz * w * s];
        streak.add(side(ax, az, w0, -1), side(bx, bz, w1, -1), side(bx, bz, w1, 1), side(ax, az, w0, 1), [
          shot[0],
          shot[1],
          shot[2],
          (0.6 * i) / trail.length,
        ]);
      }
      gl.viewport(0, 0, W, H);
      gl.clearColor(...ARENA, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const extra = [drawDynamic(dyn.shadows, shadows, null, { flat: true }), drawDynamic(dyn.puck, puck, null)];
      if (atlasTex) extra.push(drawDynamic(dyn.sprites, people, atlasTex, { cut: 0.45 }));
      extra.push(drawDynamic(dyn.streak, streak, null, { glass: true }));
      scene(mul(perspective(FOV, W / H, 0.3, 260), lookAt(cam.eye, at, [0, 1, 0])), 1, true, extra);
    }

    // The screen's hole in the dashboard, in the view's pixels (GL counts them
    // from the bottom). Measured again when the view changes size.
    let screenAt = null;
    function screenBox(W, H) {
      if (screenAt && screenAt.W === W && screenAt.H === H) return screenAt.box;
      const svg = parts.screen,
        v = view.getBoundingClientRect(),
        m = svg.getScreenCTM();
      if (!m || !v.width) return null;
      const pt = (x, y) => new DOMPoint(x, y).matrixTransform(m),
        a = pt(SCREEN.x + 0.6, SCREEN.y + 0.6),
        b = pt(SCREEN.x + SCREEN.w - 0.6, SCREEN.y + SCREEN.h - 0.6),
        kx = W / v.width,
        ky = H / v.height;
      const box = {
        x: Math.round((a.x - v.left) * kx),
        y: Math.round(H - (b.y - v.top) * ky),
        w: Math.round((b.x - a.x) * kx),
        h: Math.round((b.y - a.y) * ky),
      };
      screenAt = { W, H, box: box.w > 4 && box.h > 4 ? box : null };
      return screenAt.box;
    }
    // The Kamboni as the camera sees it, flat on the ice: its white body with
    // the stripe, the snow tank, the driver's seat at the front left, and the
    // conditioner and towel trailing behind.
    // The ice the game counts as clean, metre by metre, near (x, y): blue on
    // the screen, so the strips still to do stand out white.
    function wetCells(x, y, r) {
      const q = quads(),
        blue = [0.2, 0.55, 1, 0.42];
      for (const cell of rz.cells) {
        if (!cell.clean || Math.abs(cell.x - x) > r || Math.abs(cell.y - y) > r) continue;
        const [x0, x1, y0, y1] = [cell.x - 0.5, cell.x + 0.5, cell.y - 0.5, cell.y + 0.5];
        q.add([x0, 0.02, y0], [x1, 0.02, y0], [x1, 0.02, y1], [x0, 0.02, y1], blue);
      }
      return q;
    }

    // The lane laser (real resurfacers can have one): two lines on the ice
    // ahead, where the edges of the clean band will run. Each stretch shows
    // what is just outside it: green, the wet edge of an earlier pass or the
    // boards, which is how drivers line up their passes ("keep your tires
    // lined up with the line of the surfaced ice"); amber, a strip of cut-up
    // ice between it and the wet ice, which would be left; white, nothing
    // to line up with; dim blue, ice already clean. `mood` is for the cat.
    let grid = null;
    const cellAt = (x, y) => {
      const c = grid.get(Math.floor(x + 30) * 31 + Math.floor(y + 15));
      return c ? (c.clean ? "clean" : "dirty") : "off";
    };
    const LASER = {
      seam: [0.25, 1, 0.45, 0.95],
      gap: [1, 0.66, 0.12, 0.95],
      free: [1, 1, 1, 0.6],
      done: [0.45, 0.72, 1, 0.45],
    };
    function laser() {
      const q = quads(),
        c = Math.cos(rz.h),
        s = Math.sin(rz.h),
        half = RZ.width / 2,
        seen = { seam: 0, gap: 0 };
      for (const side of [-1, 1]) {
        // The driver's right is (-s, c).
        const rx = -s * side,
          ry = c * side,
          at = (d, o) => [rz.x + c * d + rx * o, rz.y + s * d + ry * o];
        for (let d = 3; d < 13; d += 1.6) {
          const [mx, my] = at(d + 0.8, half);
          if (cellAt(mx, my) === "off" && cellAt(...at(d + 0.8, half - 1)) === "off") break;
          const inside = cellAt(...at(d + 0.8, half - 0.6)),
            outside = cellAt(...at(d + 0.8, half + 0.5));
          let state = "free";
          if (inside === "clean" && outside !== "dirty") state = "done";
          else if (outside !== "dirty") state = "seam";
          else
            for (const o of [1.3, 2.1, 2.9])
              if (cellAt(...at(d + 0.8, half + o)) === "clean") {
                state = "gap";
                break;
              }
          if (d < 8 && state in seen) seen[state]++;
          const col = LASER[state],
            [ax, ay] = at(d, half),
            [bx, by] = at(d + 1.6, half),
            w = 0.05;
          q.add(
            [ax - rx * w, 0.03, ay - ry * w],
            [bx - rx * w, 0.03, by - ry * w],
            [bx + rx * w, 0.03, by + ry * w],
            [ax + rx * w, 0.03, ay + ry * w],
            col
          );
          const glow = [col[0], col[1], col[2], col[3] * 0.25],
            g = 0.2;
          q.add(
            [ax - rx * g, 0.025, ay - ry * g],
            [bx - rx * g, 0.025, by - ry * g],
            [bx + rx * g, 0.025, by + ry * g],
            [ax + rx * g, 0.025, ay + ry * g],
            glow
          );
        }
      }
      return { q, mood: seen.seam ? "yes" : seen.gap ? "no" : null };
    }

    let rzColours = null; // read again for each intermission, in the theme of the moment
    function machine() {
      const q = quads(),
        c = Math.cos(rz.h),
        s = Math.sin(rz.h);
      const at = (a, b, h) => [rz.x + c * a - s * b, h, rz.y + s * a + c * b],
        rect = (a0, a1, b0, b1, h, col) => q.add(at(a0, b0, h), at(a1, b0, h), at(a1, b1, h), at(a0, b1, h), col);
      rzColours = rzColours || {
        body: rgba(cssVar("--rink-rz") || "#fbfcfd"),
        tank: rgba(cssVar("--rink-rz-tank") || "#dce3ea"),
        dark: rgba(cssVar("--rink-rz-dark") || "#56606b"),
        towel: rgba(cssVar("--rink-towel") || "#cfd9e3"),
        stripe: rgba(cssVar("--rink-team-a") || "#2f6fd6"),
      };
      const { body, tank, dark, towel, stripe } = rzColours;
      rect(-3.75, -2.95, -1.35, 1.35, 0.05, towel);
      rect(-3.05, -2.55, -1.5, 1.5, 0.1, dark);
      rect(-2.6, 2.6, -1.3, 1.3, 0.3, dark);
      rect(-2.52, 2.52, -1.22, 1.22, 0.32, body);
      rect(-2.35, 2.35, -1.2, -1.08, 0.34, stripe);
      rect(-2.35, 2.35, 1.08, 1.2, 0.34, stripe);
      rect(-2.35, 0.95, -1.02, 1.02, 0.36, tank);
      rect(1.15, 1.95, -1.08, -0.16, 0.36, dark);
      rect(1.2, 2.25, 0.05, 1.0, 0.38, tank);
      return q;
    }

    const cat = { a: 0, w: 0, t: 0, yes: 0, no: 0 };
    let last = null,
      shake = 0;
    return {
      el,
      prepareReplay,
      get replayReady() {
        return replayReady && !!atlasTex;
      },
      replayFrame,
      // The cab's dashboard and frame, or nothing over the view (a replay).
      mode(m) {
        el.classList.toggle("is-replay", m === "replay");
      },
      // A new intermission: the ice as the period left it (`marks`, the
      // game's skate marks), and the colours of the current theme.
      start(r, marks) {
        const mine = ++job;
        el.classList.remove("is-replay");
        rz = r;
        rzColours = null;
        grid = new Map(r.cells.map((cell) => [Math.floor(cell.x + 30) * 31 + Math.floor(cell.y + 15), cell]));
        ready = painted = mapped = 0;
        mapPoints = "";
        last = null;
        build();
        const floor = `<rect x="-32" y="-16" width="64" height="32" fill="#2a2f36"/>`;
        const rink = (root.rinkSVG ? root.rinkSVG() : "").replace(/<rect[^>]*data-rink-net[^>]*\/>/g, "");
        const shape = `x="-30" y="-15" width="60" height="30" rx="8.5"`;
        rasterize(`${floor}${rink}<rect ${shape} fill="var(--rink-wet)"/>`, clean, (ok) => {
          if (!ok || mine !== job) return;
          pattern = ctx2d(dirty).createPattern(clean, "no-repeat");
          ready++;
        });
        const frost = `<defs>${deps.frost}</defs><rect ${shape} fill="url(#rink-frost)"/>`;
        rasterize(`${floor}${rink}${marks ? marks.outerHTML.replace(/ mask="[^"]*"/, "") : ""}${frost}`, dirty, (ok) => {
          if (!ok || mine !== job) return;
          gl.bindTexture(gl.TEXTURE_2D, iceTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, dirty);
          gl.generateMipmap(gl.TEXTURE_2D);
          ready++;
        });
      },
      show(on) {
        el.hidden = !on;
      },
      frame(now) {
        const dt = last === null ? 0 : Math.min(0.05, (now - last) / 1000);
        last = now;
        const dpr = Math.min(2, root.devicePixelRatio || 1),
          W = Math.round(view.clientWidth * dpr),
          H = Math.round(view.clientHeight * dpr);
        if (!W || !H) return;
        if (view.width !== W || view.height !== H) [view.width, view.height] = [W, H];
        paint();
        // The driver's eye: on the left, toward the front, swaying a little
        // into turns and shaken by the boards.
        if (rz.bonk) shake = 0.35;
        shake = Math.max(0, shake - dt);
        const c = Math.cos(rz.h),
          s = Math.sin(rz.h),
          jolt = shake * 0.25 * Math.sin(now / 22);
        const eye = [rz.x + c * EYE.ahead + s * EYE.left, EYE.up + jolt, rz.y + s * EYE.ahead - c * EYE.left];
        const roll = -rz.wheel * Math.min(1, Math.abs(rz.v) / 12) * 0.035,
          up = [-s * Math.sin(roll), Math.cos(roll), c * Math.sin(roll)];
        const look = (h, pitch) => [eye[0] + Math.cos(h) * Math.cos(pitch), eye[1] + Math.sin(pitch), eye[2] + Math.sin(h) * Math.cos(pitch)];
        gl.viewport(0, 0, W, H);
        gl.clearColor(...ARENA, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const lane = laser();
        scene(mul(perspective(0.95, W / H, 0.1, 260), lookAt(eye, look(rz.h, EYE.pitch), up)), 1, false, [
          drawDynamic(dyn.laser, lane.q, null, { glass: true }),
        ]);
        // The mirror, on its arm at the top right: behind, and the wrong way round.
        const mx = Math.round((W * MIRROR.x) / 100),
          mw = Math.round((W * MIRROR.w) / 100),
          my = Math.round(H * (1 - (MIRROR.y + MIRROR.h) / 100)),
          mh = Math.round((H * MIRROR.h) / 100);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(mx, my, mw, mh);
        gl.viewport(mx, my, mw, mh);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        scene(mul(perspective(0.6, mw / mh, 0.1, 260), lookAt(eye, look(rz.h + Math.PI, -0.32), [0, 1, 0])), -1);
        // The camera's screen: the ice round the Kamboni from straight above,
        // the way it goes up the screen and more of what is ahead than behind,
        // so the cut-up ice shows where it is to steer for.
        const sc = screenBox(W, H);
        if (sc) {
          gl.scissor(sc.x, sc.y, sc.w, sc.h);
          gl.viewport(sc.x, sc.y, sc.w, sc.h);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          const hh = 9,
            hw = (hh * sc.w) / sc.h,
            cx = rz.x + c * 4,
            cy = rz.y + s * 4;
          scene(mul(ortho(hw, hh, 1, 60), lookAt([cx, 30, cy], [cx, 0, cy], [c, 0, s])), 1, false, [
            drawDynamic(dyn.wet, wetCells(cx, cy, Math.hypot(hw, hh) + 1), null, { flat: true }),
            drawDynamic(dyn.machine, machine(), null),
          ]);
        }
        gl.disable(gl.SCISSOR_TEST);

        // The dashboard.
        parts.wheel.setAttribute("transform", `rotate(${(rz.wheel * 100).toFixed(1)})`);
        parts.needle.setAttribute("transform", `rotate(${(-120 + 240 * rz.part).toFixed(1)})`);
        parts.ice.textContent = `${Math.floor(100 * rz.part)}%`;
        // The cat sways: a spring, pushed by turns and bumps. And it is the
        // driver's trainer: it nods while the laser is on the wet edge, and
        // shakes its head at a strip about to be left.
        const yaw = rz.wheel * RZ.lock * Math.min(1, Math.max(0.3, Math.abs(rz.v) / 3)) * Math.sign(rz.v || 1);
        cat.w += (-70 * cat.a - 4 * cat.w - rz.v * yaw * 0.08) * dt;
        if (rz.bonk) cat.w += 7;
        cat.a = Math.max(-0.6, Math.min(0.6, cat.a + cat.w * dt));
        const moving = Math.abs(rz.v) > 1,
          mood = moving ? lane.mood : null;
        cat.t += dt;
        cat.yes += ((mood === "yes" ? 1 : 0) - cat.yes) * Math.min(1, dt * 6);
        cat.no += ((mood === "no" ? 1 : 0) - cat.no) * Math.min(1, dt * 6);
        const nod = Math.max(0, Math.sin(cat.t * 9)) * 1.4 * cat.yes,
          no = Math.sin(cat.t * 16) * 0.3 * cat.no;
        parts.cat.setAttribute("transform", `translate(0 ${nod.toFixed(2)}) rotate(${(((cat.a + no) * 180) / Math.PI).toFixed(1)} 0 -2)`);
        // The map.
        for (; mapped < rz.track.length; mapped++)
          mapPoints += `${mapPoints ? " " : ""}${rz.track[mapped][0].toFixed(1)},${rz.track[mapped][1].toFixed(1)}`;
        if (parts.track.getAttribute("points") !== mapPoints) parts.track.setAttribute("points", mapPoints);
        parts.me.setAttribute("transform", `translate(${rz.x.toFixed(1)} ${rz.y.toFixed(1)}) rotate(${((rz.h * 180) / Math.PI).toFixed(0)})`);
      },
    };
  }

  root.KamboniCab = KamboniCab;
})(typeof window !== "undefined" ? window : globalThis);
