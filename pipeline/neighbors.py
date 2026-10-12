"""全部の語について、使われ方の近い語を前もって計算しておく(全部と比べるので正確)。

点を押したときと、語彙にある語を検索したときは、アプリはこの表を引くだけにする(src/lib/words.ts)。
語彙にある語なら、検索のたびに全部の語と比べるより速い。

書き出す先は neighbors.db。自分自身は含まない。
"""

from pathlib import Path

import faiss
import numpy as np

import store

K = 8
BATCH = 20000


def write(vecs: np.ndarray, out: Path, log=print) -> None:
    n, dim = vecs.shape
    index = faiss.IndexFlatIP(dim)
    index.add(vecs)
    ids = np.zeros((n, K), np.uint32)
    scores = np.zeros((n, K), np.float32)
    for start in range(0, n, BATCH):
        s, i = index.search(vecs[start : start + BATCH], K + 1)
        for row, (ss, ii) in enumerate(zip(s, i)):
            keep = ii != start + row  # 自分自身を除く
            ids[start + row] = ii[keep][:K]
            scores[start + row] = ss[keep][:K]
        log(f"近い語 {min(start + BATCH, n)}/{n}")
    store.write_neighbors(out / "neighbors.db", ids, scores)
