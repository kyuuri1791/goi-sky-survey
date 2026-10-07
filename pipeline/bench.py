"""書き出した索引（data/index.bin）で、全部と比べた本物の上位 10 語をどれだけ当てられるか（再現率）を測る。
アプリの複合語の検索（src/lib/ivfpq.ts）と同じ手順を numpy でなぞる。npm run data:bench から compose 経由で呼ぶ。"""

import numpy as np

import ngcrypt
import sources
from vocab import kept_ids

K, NPROBE, QUERIES = 10, 64, 200


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
    return coarse, books, start, order, codes


def search(q, coarse, books, start, order, codes):
    cs = coarse @ q
    lists = np.argsort(-cs)[:NPROBE]
    lut = np.einsum("msd,md->ms", books, q.reshape(books.shape[0], -1))
    js = np.concatenate([np.arange(start[c], start[c + 1]) for c in lists])
    est = np.repeat(cs[lists], np.diff(start)[lists]) + lut[np.arange(lut.shape[0]), codes[js]].sum(axis=1)
    return order[js[np.argsort(-est)[: K + 1]]]


def main():
    words, vecs = sources.chive()
    vecs = vecs[kept_ids(words, ngcrypt.words())]
    idx = load_index()
    rng = np.random.default_rng(1)
    hit = 0
    for i in rng.choice(100_000, QUERIES, replace=False):
        truth = set(np.argsort(-(vecs @ vecs[i]))[1 : K + 1])
        hit += len(truth & set([j for j in search(vecs[i], *idx) if j != i][:K]))
    print(f"IVF-PQ: 本物の上位 {K} 語を当てた割合 {hit / (K * QUERIES):.0%}")


if __name__ == "__main__":
    main()
