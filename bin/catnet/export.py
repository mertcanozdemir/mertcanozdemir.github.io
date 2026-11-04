# Writes the trained weights for kspace.js: half floats, layer after layer in
# the order the page reads them, each layer's weights as [out][in][ky][kx]
# and then its biases.
import pickle, sys
import numpy as np

CH = [16, 32, 48, 64, 64]
p = pickle.load(open(sys.argv[1], "rb"))
order = []
for i in range(len(CH)):
    order += [f"e{i}a", f"e{i}b"]
for i in reversed(range(len(CH) - 1)):
    order += [f"u{i}", f"d{i}a"] + ([f"d{i}b"] if i > 0 else [])
order.append("out")
parts = []
for name in order:
    w = np.asarray(p[name]["w"])  # kh, kw, in, out
    parts.append(np.transpose(w, (3, 2, 0, 1)).ravel())
    parts.append(np.asarray(p[name]["b"]).ravel())
flat = np.concatenate(parts).astype(np.float16)
assert np.isfinite(flat).all()
flat.tofile(sys.argv[2])
print(len(order), "layers,", flat.size, "numbers,", flat.nbytes, "bytes")
