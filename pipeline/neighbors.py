"""全部の語について、使われ方の近い語を前もって計算しておく（全部と比べるので正確）。

点を押したときと、語彙にある語を検索したときは、アプリはこの表を引くだけにする（src/server/words.ts）。
語彙にある語なら、索引で見積もるより正確で速い。

  neighbors.bin   u32[語数 × K]  近い語の番号（近い順。自分は含まない）
                  i16[語数 × K]  近さ（cos 類似度）× 10000
"""

from pathlib import Path

import faiss
import numpy as np

K = 8
BATCH = 20000


def write(vecs: np.ndarray, out: Path, log=print) -> None:
    n, dim = vecs.shape
    index = faiss.IndexFlatIP(dim)
    index.add(vecs)
    ids = np.zeros((n, K), np.uint32)
    scores = np.zeros((n, K), np.int16)
    for start in range(0, n, BATCH):
        s, i = index.search(vecs[start : start + BATCH], K + 1)
        for row, (ss, ii) in enumerate(zip(s, i)):
            keep = ii != start + row  # 自分自身を除く
            ids[start + row] = ii[keep][:K]
            scores[start + row] = np.round(ss[keep][:K] * 10000)
        log(f"近い語 {min(start + BATCH, n)}/{n}")
    with open(out / "neighbors.bin", "wb") as f:
        f.write(ids.tobytes())
        f.write(scores.tobytes())
