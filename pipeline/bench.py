"""書き出した索引（data/index.bin、rerank-*.bin）で、全部と比べた本物の上位 10 語をどれだけ当てられるか（再現率）を測る。
アプリの検索（src/lib/ivfpq.ts）と同じ手順を numpy でなぞる。npm run data:bench から compose 経由で呼ぶ。"""

import numpy as np

import ngcrypt
import sources
from vocab import kept_ids

K, NPROBE, RERANK, QUERIES = 10, 32, 100, 200


def load_index(out="/out"):
    buf = open(f"{out}/index.bin", "rb").read()
    _, n, dim, nlist, m, ks, _, _ = np.frombuffer(buf, np.uint32, 8)
    off = 32

    def take(dtype, count):
        nonlocal off
        arr = np.frombuffer(buf, dtype, count, off)
        off += arr.nbytes
        return arr

    coarse = take(np.float32, nlist * dim).reshape(nlist, dim)
    books = take(np.float32, m * ks * (dim // m)).reshape(m, ks, dim // m)
    start, order = take(np.uint32, nlist + 1), take(np.uint32, n)
    codes = take(np.uint8, n * m).reshape(n, m)
    rows = np.frombuffer(b"".join(open(f"{out}/rerank-{f}.bin", "rb").read() for f in range(2)), np.uint8).reshape(n, 4 + dim)
    scale = rows[:, :4].copy().view("<f4").ravel()
    q8 = rows[:, 4:].view(np.int8).astype(np.float32) * scale[:, None]
    return coarse, books, start, order, codes, q8


def search(q, coarse, books, start, order, codes, q8, rerank):
    cs = coarse @ q
    lists = np.argsort(-cs)[:NPROBE]
    lut = np.einsum("msd,md->ms", books, q.reshape(books.shape[0], -1))
    js = np.concatenate([np.arange(start[c], start[c + 1]) for c in lists])
    est = np.repeat(cs[lists], np.diff(start)[lists]) + lut[np.arange(lut.shape[0]), codes[js]].sum(axis=1)
    top = order[js[np.argsort(-est)[: max(rerank, K + 1)]]]
    if rerank:
        top = top[np.argsort(-(q8[top] @ q))]
    return top


def main():
    words, vecs = sources.chive()
    vecs = vecs[kept_ids(words, ngcrypt.words())]
    idx = load_index()
    rng = np.random.default_rng(1)
    queries = rng.choice(100_000, QUERIES, replace=False)
    for name, rerank in (("IVF-PQ", 0), (f"IVF-PQ ＋ 上位 {RERANK} 件を並べ直し", RERANK)):
        hit = 0
        for i in queries:
            truth = set(np.argsort(-(vecs @ vecs[i]))[1 : K + 1])
            got = [j for j in search(vecs[i], *idx, rerank) if j != i][:K]
            hit += len(truth & set(got))
        print(f"{name}: 本物の上位 {K} 語を当てた割合 {hit / (K * QUERIES):.0%}")


if __name__ == "__main__":
    main()
