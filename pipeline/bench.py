"""複合語の検索で、全部と比べた本物の上位 10 語をどれだけ当てられるか(再現率)を測る。npm run data:bench から compose 経由で呼ぶ。
アプリ(src/lib/data.ts の nearestVectors)と同じ手順をなぞる: 分けた語のベクトルを足して長さ 1 にし、vec1 で各ファイルから
CANDIDATES 語ずつ候補を取り、縮めた符号で近い方から CANDIDATES 語を、丸めないベクトルで比べ直す。"""

from pathlib import Path

import numpy as np

import ngcrypt
import sources
import vectors
from vocab import kept_ids

K, QUERIES = 10, 200
# src/lib/data.ts の CANDIDATES と同じにする
CANDIDATES = 300


def unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def main():
    words, vecs = sources.chive()
    vecs = vecs[kept_ids(words, ngcrypt.words())]
    db = vectors.open_all(Path("/out"))
    rows = " union all ".join(f"select rowid, distance from v{i}.vectors where cmd = ?1 and arg = ?2" for i in range(vectors.FILES))
    knn = f"{rows} order by distance limit {CANDIDATES}"
    arg = f'{{"K":{CANDIDATES}}}'
    # よく使われる 3 万語から 2 語ずつ選んで足したものを問い合わせにする
    rng = np.random.default_rng(5)
    pairs = [p for p in rng.choice(30_000, (QUERIES, 2)) if p[0] != p[1]]
    hit = 0
    for p in pairs:
        q = unit(vecs[p].sum(0)).astype(np.float32)
        s = vecs @ q
        s[p] = -9
        truth = set(np.argsort(-s)[:K])
        cand = np.array([r for r, _ in db.execute(knn, (q.tobytes(), arg)) if r not in p])
        got = cand[np.argsort(-(vecs[cand] @ q))[:K]]
        hit += len(truth & set(got))
    print(f"本物の上位 {K} 語を当てた割合: {hit / (K * len(pairs)):.1%}")


if __name__ == "__main__":
    main()
