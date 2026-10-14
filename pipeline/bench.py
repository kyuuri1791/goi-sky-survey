"""複合語の検索で、全部と比べた本物の上位 10 語をどれだけ当てられるか(再現率)を測る。npm run data:bench から compose 経由で呼ぶ。
アプリ(src/lib/words.ts)と同じ手順をなぞる: 分けた語の 1 バイトに丸めたベクトル(data/vectors-*.bin)を長さ 1 にそろえて足し、
1 バイトに丸め直して、全部の語と cos で比べる。"""

from pathlib import Path

import numpy as np

import ngcrypt
import sources
import vectors
from vocab import kept_ids

K, QUERIES = 10, 200


def unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def main():
    words, vecs = sources.chive()
    vecs = vecs[kept_ids(words, ngcrypt.words())]
    q8 = vectors.read(Path("/out")).astype(np.float32)
    q8n = unit(q8)
    # よく使われる 3 万語から 2 語ずつ選んで足したものを問い合わせにする
    rng = np.random.default_rng(5)
    pairs = [p for p in rng.choice(30_000, (QUERIES, 2)) if p[0] != p[1]]
    hit = 0
    for p in pairs:
        s = vecs @ unit(vecs[p].sum(0))
        s[p] = -9
        truth = set(np.argsort(-s)[:K])
        q = q8n[p].sum(0)
        q = np.round(q / np.abs(q).max() * 127)
        s8 = q8n @ unit(q)
        s8[p] = -9
        hit += len(truth & set(np.argsort(-s8)[:K]))
    print(f"本物の上位 {K} 語を当てた割合: {hit / (K * len(pairs)):.1%}")


if __name__ == "__main__":
    main()
