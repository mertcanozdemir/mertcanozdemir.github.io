# Cats for the network to learn from: the home page's cat (kspace.js,
# drawCat) with everything about it varied a little (size, ears, eyes,
# brightness, whiskers) and turned and moved about, drawn at 512 and scaled
# down to 128 as the page does.
import sys
import numpy as np
from PIL import Image, ImageDraw

N = 128
S = 512


def cat(rng, pose=None):
    """One cat, as an N×N float image in 0..1."""
    u = lambda a, b: rng.uniform(a, b)
    j = lambda a: rng.uniform(-a, a)
    img = Image.new("L", (S, S), 0)
    g = ImageDraw.Draw(img)
    grey = lambda v: int(round(255 * min(1, max(0, v))))
    cx = 256 + j(10)
    head_y = 292 + j(14)
    head = u(0.32, 0.48)
    ear = head + j(0.05)
    # Ears.
    for side in (-1, 1):
        tip = (cx + side * (106 + j(22)), 78 + j(24))
        out = (cx + side * (138 + j(16)), 236 + j(14))
        inn = (cx + side * (20 + j(12)), 170 + j(16))
        g.polygon([out, tip, inn], fill=grey(ear))
        k = u(0.55, 0.8)
        mid = ((out[0] + tip[0] + inn[0]) / 3, (out[1] + tip[1] + inn[1]) / 3)
        shrink = lambda p: (mid[0] + (p[0] - mid[0]) * k, mid[1] + (p[1] - mid[1]) * k + 8)
        g.polygon([shrink(out), shrink(tip), shrink(inn)], fill=grey(u(0.1, 0.26)))
    # The head, with its bright rim.
    rx, ry = 156 * u(0.86, 1.14), 132 * u(0.86, 1.14)
    rim = int(round(u(6, 12)))
    g.ellipse([cx - rx, head_y - ry, cx + rx, head_y + ry], fill=grey(head), outline=grey(u(0.65, 0.95)), width=rim)
    # The brain.
    by, brx, bry = head_y - 60 + j(14), 92 * u(0.78, 1.18), 50 * u(0.75, 1.2)
    g.ellipse([cx - brx, by - bry, cx + brx, by + bry], fill=grey(u(0.16, 0.3)))
    # Eyes and pupils.
    gap, ey = 66 + j(14), head_y + 8 + j(12)
    erx, ery = 36 * u(0.75, 1.2), 32 * u(0.75, 1.2)
    prx, pry = 9 * u(0.6, 1.5), 23 * u(0.55, 1.2)
    look = j(6)
    for side in (-1, 1):
        ex = cx + side * gap
        g.ellipse([ex - erx, ey - ery, ex + erx, ey + ery], fill=grey(u(0.75, 0.95)))
        px = ex - side * 4 + look
        g.ellipse([px - prx, ey + 3 - pry, px + prx, ey + 3 + pry], fill=grey(u(0.03, 0.12)))
    # Nose and mouth.
    ny, nw = head_y + 58 + j(8), 18 * u(0.75, 1.3)
    nose = u(0.55, 0.85)
    g.polygon([(cx - nw, ny), (cx + nw, ny), (cx, ny + 20 * u(0.8, 1.2))], fill=grey(nose))
    mw = 30 * u(0.75, 1.3)
    tip_y = ny + 20
    for side in (-1, 1):
        pts = [(1 - t) ** 2 * np.array([cx, tip_y]) + 2 * (1 - t) * t * np.array([cx + side * 9, tip_y + 22]) + t * t * np.array([cx + side * mw, tip_y + 16]) for t in np.linspace(0, 1, 12)]
        g.line([tuple(p) for p in pts], fill=grey(nose), width=5)
    # Whiskers.
    white = u(0.65, 0.95)
    width = int(round(u(2, 4)))
    count = int(rng.integers(2, 5))
    for side in (-1, 1):
        for i in range(count):
            k = (i - (count - 1) / 2) if count > 1 else 0
            x0, y0 = cx + side * (58 + j(8)), ny + 12 + k * 10 + j(3)
            x1, y1 = cx + side * (205 * u(0.8, 1.15)), ny - 8 + k * 32 * u(0.7, 1.3) + j(10)
            g.line([(x0, y0), (x1, y1)], fill=grey(white), width=width)
    # Turned and moved about, then scaled down.
    if pose is None:
        pose = (rng.uniform(-0.09, 0.09), rng.uniform(-0.09, 0.09), rng.uniform(-0.5, 0.5), rng.uniform(0.78, 1.12))
    dx, dy, angle, scale = pose
    if scale != 1:
        big = img.resize((int(S * scale), int(S * scale)), Image.BICUBIC)
        canvas = Image.new("L", (S, S), 0)
        canvas.paste(big, ((S - big.width) // 2, (S - big.height) // 2))
        img = canvas
    img = img.rotate(-np.degrees(angle), resample=Image.BICUBIC, center=(256, 256), translate=(dx * S, dy * S))
    small = img.resize((N, N), Image.BOX)
    return np.asarray(small, dtype=np.float32) / 255


if __name__ == "__main__":
    out = sys.argv[1]
    count = int(sys.argv[2])
    rng = np.random.default_rng(int(sys.argv[3]) if len(sys.argv) > 3 else 1)
    data = np.empty((count, N, N), dtype=np.float16)
    for i in range(count):
        data[i] = cat(rng)
    np.save(out, data)
    print("saved", data.shape, "to", out)
