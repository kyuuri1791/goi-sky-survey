"""複合語の検索で、全部と比べた本物の上位 10 語をどれだけ当てられるか（再現率）を測る。npm run data:bench から compose 経由で呼ぶ。
アプリ（src/lib/words.ts、src/lib/ivfpq.ts）と同じ手順を numpy でなぞる: 分けた語の 1 バイトに丸めたベクトル（data/vectors-*.bin）を足し、
索引（data/index.bin）で候補を CANDIDATES 件に絞り、そのベクトルで近さを計算し直す。"""

import numpy as np

import ngcrypt
import sources
import store
from vocab import kept_ids

K, NPROBE, QUERIES, CANDIDATES = 10, 64, 200, 200


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


def load_vectors(out="/out"):
    """1 バイトに丸めたベクトルを戻す（形式は store.py）"""
    rows = np.concatenate([np.frombuffer(open(f"{out}/vectors-{i}.bin", "rb").read(), np.uint8) for i in range(store.VECTOR_FILES)])
    rows = rows.reshape(-1, 304)
    return rows[:, 4:].view(np.int8).astype(np.float32) * rows[:, :4].copy().view("<f4")


def search(q, coarse, books, start, order, codes, k=K + 1):
    cs = coarse @ q
    lists = np.argsort(-cs)[:NPROBE]
    lut = np.einsum("msd,md->ms", books, q.reshape(books.shape[0], -1))
    js = np.concatenate([np.arange(start[c], start[c + 1]) for c in lists])
    est = np.repeat(cs[lists], np.diff(start)[lists]) + lut[np.arange(lut.shape[0]), codes[js]].sum(axis=1)
    return order[js[np.argsort(-est)[:k]]]


def main():
    words, vecs = sources.chive()
    vecs = vecs[kept_ids(words, ngcrypt.words())]
    idx, q8 = load_index(), load_vectors()
    # よく使われる 3 万語から 2 語ずつ選んで足したものを問い合わせにする
    rng = np.random.default_rng(5)
    pairs = [p for p in rng.choice(30_000, (QUERIES, 2)) if p[0] != p[1]]
    hit_pq = hit = 0
    for p in pairs:
        exact = vecs[p].sum(0)
        s = vecs @ (exact / np.linalg.norm(exact))
        s[p] = -9
        truth = set(np.argsort(-s)[:K])
        q = q8[p].sum(0)
        q /= np.linalg.norm(q)
        cand = np.array([j for j in search(q, *idx, CANDIDATES) if j not in p])
        hit_pq += len(truth & set(cand[:K]))
        hit += len(truth & set(cand[np.argsort(-(q8[cand] @ q))[:K]]))
    n = K * len(pairs)
    print(f"索引の見積もりだけ: 本物の上位 {K} 語を当てた割合 {hit_pq / n:.0%}")
    print(f"上位 {CANDIDATES} 件を計算し直す（アプリ）: {hit / n:.0%}")


if __name__ == "__main__":
    main()
