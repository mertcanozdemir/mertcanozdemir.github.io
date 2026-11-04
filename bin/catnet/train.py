# Teaches a small U-Net to clean up a quick scan of a cat: every fourth or
# every eighth line, measured by eight coils (with the scanner's noise) and
# unfolded with them as far as they go (SENSE, as kspace.js does it), and the
# network takes it from there to the whole cat. Saves the weights for
# kspace.js (export.py).
import glob, json, pickle, sys, time
import numpy as np
import jax
import jax.numpy as jnp

N = 128
CH = [16, 32, 48, 64, 64]  # channels at 128, 64, 32, 16 and 8 pixels
SIGMA = 0.12  # each coil's noise per k-space component, as COIL_NOISE in kspace.js
COILS = 8
REG = 1e-4  # the regularisation of the unfolding, of the trace, as in kspace.js
STEPS = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
BATCH = 16
OUT = sys.argv[1]

files = sorted(glob.glob(OUT + "/cats-*.npy"))
data = np.concatenate([np.load(f) for f in files]).astype(np.float32)
test, data = data[:256], data[256:]
print("cats:", data.shape[0], "to learn from,", test.shape[0], "to test on", flush=True)


# The coils, as coilMaps() in kspace.js: round the head, falling off with
# distance, each with a phase of its own.
y, x = np.mgrid[0:N, 0:N]
MAPS = []
for c in range(COILS):
    a = 2 * np.pi * c / COILS
    u = (x + 0.5) / N - 0.5 - 0.62 * np.cos(a)
    v = (y + 0.5) / N - 0.5 - 0.62 * np.sin(a)
    MAPS.append(1 / (1 + (u * u + v * v) / 0.09) * np.exp(1j * (a + 2 * (u * np.cos(a) + v * np.sin(a)))))
MAPS = np.array(MAPS)


# The unfolding for R: for each pixel of the folded image (its first N/R
# rows), the R places that folded onto it from the eight coils' views, as a
# fixed R × 8 matrix, since it depends on the coils only.
def unfolding(R):
    M = N // R
    U = np.zeros((M, N, R, COILS), complex)
    for yy in range(M):
        B = MAPS[:, yy + M * np.arange(R), :].transpose(2, 0, 1) / R  # x, coil, j
        Bh = np.conj(B.transpose(0, 2, 1))
        G = Bh @ B
        G = G + REG * np.trace(G, axis1=1, axis2=2).real[:, None, None] * np.eye(R)[None]
        U[yy] = np.linalg.solve(G, Bh)
    return jnp.asarray(U.astype(np.complex64))


UNFOLD = {4: unfolding(4), 8: unfolding(8)}
JMAPS = jnp.asarray(MAPS.astype(np.complex64))


def conv_init(key, k, cin, cout):
    return {"w": jax.random.normal(key, (k, k, cin, cout)) * np.sqrt(2 / (k * k * cin)), "b": jnp.zeros(cout)}


def init(key):
    ks = iter(jax.random.split(key, 64))
    p, cin = {}, 2
    for i, c in enumerate(CH):
        p[f"e{i}a"] = conv_init(next(ks), 3, cin, c)
        p[f"e{i}b"] = conv_init(next(ks), 3, c, c)
        cin = c
    for i in reversed(range(len(CH) - 1)):
        c = CH[i]
        p[f"u{i}"] = conv_init(next(ks), 1, cin, c)
        p[f"d{i}a"] = conv_init(next(ks), 3, 2 * c, c)
        if i > 0:
            p[f"d{i}b"] = conv_init(next(ks), 3, c, c)
        cin = c
    p["out"] = conv_init(next(ks), 1, CH[0], 1)
    return p


def conv(x, q):
    return jax.lax.conv_general_dilated(x, q["w"], (1, 1), "SAME", dimension_numbers=("NHWC", "HWIO", "NHWC")) + q["b"]


def pool(x):
    return jax.lax.reduce_window(x, -jnp.inf, jax.lax.max, (1, 2, 2, 1), (1, 2, 2, 1), "VALID")


def up(x):
    return jnp.repeat(jnp.repeat(x, 2, axis=1), 2, axis=2)


relu = jax.nn.relu


def net(p, x):
    skips, h = [], x
    for i in range(len(CH)):
        h = relu(conv(h, p[f"e{i}a"]))
        h = relu(conv(h, p[f"e{i}b"]))
        if i < len(CH) - 1:
            skips.append(h)
            h = pool(h)
    for i in reversed(range(len(CH) - 1)):
        h = up(relu(conv(h, p[f"u{i}"])))  # a 1×1 conv commutes with nearest upsampling
        h = jnp.concatenate([h, skips[i]], axis=-1)
        h = relu(conv(h, p[f"d{i}a"]))
        if i > 0:
            h = relu(conv(h, p[f"d{i}b"]))
    return x[..., 0] + conv(h, p["out"])[..., 0]  # a correction to the folded image


def scan(x, key, R):
    """The quick scan of cats x by the eight coils, every R-th row, unfolded."""
    B, M = x.shape[0], N // R
    k1, k2 = jax.random.split(key)
    K = jnp.fft.fft2(x[:, None] * JMAPS[None])  # cat, coil, ky, kx
    K = K + (jax.random.normal(k1, K.shape) + 1j * jax.random.normal(k2, K.shape)) * SIGMA
    mask = (jnp.arange(N) % R) == 0
    folded = jnp.fft.ifft2(K * mask[None, None, :, None])[:, :, :M, :]  # cat, coil, y, x
    out = jnp.einsum("yxjc,bcyx->bjyx", UNFOLD[R], folded).reshape(B, N, N)
    sense = jnp.real(out)
    inp = jnp.stack([sense, jnp.full(sense.shape, R / 8.0)], -1)
    return inp


def loss(p, x, key):
    k4, k8 = jax.random.split(key)
    h = x.shape[0] // 2
    a, b = net(p, scan(x[:h], k4, 4)), net(p, scan(x[h:], k8, 8))
    return (jnp.mean(jnp.abs(a - x[:h])) + jnp.mean(jnp.abs(b - x[h:]))) / 2


@jax.jit
def train_step(p, m, v, t, x, key, lr):
    l, g = jax.value_and_grad(loss)(p, x, key)
    b1, b2 = 0.9, 0.999
    m = jax.tree.map(lambda m, g: b1 * m + (1 - b1) * g, m, g)
    v = jax.tree.map(lambda v, g: b2 * v + (1 - b2) * g * g, v, g)
    mh = jax.tree.map(lambda m: m / (1 - b1**t), m)
    vh = jax.tree.map(lambda v: v / (1 - b2**t), v)
    p = jax.tree.map(lambda p, a, b: p - lr * a / (jnp.sqrt(b) + 1e-8), p, mh, vh)
    return p, m, v, l


def evaluate(p, x, key, R):
    inp = scan(x, key, R)
    out = net(p, inp)
    psnr = lambda y: jnp.mean(10 * jnp.log10(1 / jnp.mean((y - x) ** 2, axis=(1, 2))))
    return psnr(inp[..., 0]), psnr(out)


evaluate = jax.jit(evaluate, static_argnums=3)


key = jax.random.PRNGKey(0)
p = init(key)
m = jax.tree.map(jnp.zeros_like, p)
v = jax.tree.map(jnp.zeros_like, p)
params = sum(int(np.prod(q.shape)) for q in jax.tree.leaves(p))
print("parameters:", params, flush=True)
rng = np.random.default_rng(1)
t0 = time.time()
avg = None
for step in range(1, STEPS + 1):
    lr = 1e-3 if step < STEPS * 0.6 else 3e-4 if step < STEPS * 0.85 else 1e-4
    x = jnp.asarray(data[rng.integers(0, data.shape[0], BATCH)])
    # Now and then mirrored, which a cat may as well be.
    if rng.random() < 0.5:
        x = x[:, :, ::-1]
    key, sub = jax.random.split(key)
    p, m, v, l = train_step(p, m, v, step, x, sub, lr)
    avg = float(l) if avg is None else 0.98 * avg + 0.02 * float(l)
    if step % 100 == 0 or step == 1:
        line = f"step {step} loss {avg:.4f} ({time.time() - t0:.0f} s)"
        if step % 500 == 0 or step == STEPS:
            for R in (4, 8):
                a, b = evaluate(p, jnp.asarray(test[:64]), jax.random.PRNGKey(7), R)
                line += f" | R={R}: coils {float(a):.1f} dB, coils and network {float(b):.1f}"
            with open(OUT + "/params.pkl", "wb") as f:
                pickle.dump(jax.tree.map(np.asarray, p), f)
        print(line, flush=True)
print("done", flush=True)
