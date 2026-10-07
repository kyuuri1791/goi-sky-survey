"""意味の近い語を探す索引（IVF-PQ）を FAISS で作り、アプリが読む形式で書き出す（形式は src/lib/ivfpq.ts を参照）。

  index.bin       IVF-PQ。語を NLIST グループに分け、各語のグループの中心からのずれを M 個の区切りごとに代表の番号（1 バイト）で持つ
  rerank-*.bin    並べ直し用: 語ごとに倍率（f32）＋ 1 バイトに丸めたベクトル（i8 × 300）。
                  GitHub の 1 ファイル 100MB の上限より小さくなるよう、前半と後半に分ける
"""

from pathlib import Path

import faiss
import numpy as np
from faiss.contrib.inspect_tools import get_invlist

NLIST, M, KS = 1024, 50, 256
MAGIC = 0x31515649  # "IVQ1"
RERANK_FILES = 2


def build(vecs: np.ndarray):
    """FAISS の IVF-PQ（ユークリッド距離で学習。検索では内積で見積もる）"""
    n, dim = vecs.shape
    index = faiss.IndexIVFPQ(faiss.IndexFlatL2(dim), dim, NLIST, M, 8)
    index.train(vecs)
    index.add(vecs)
    return index


def write(index, vecs: np.ndarray, out: Path) -> None:
    n, dim = vecs.shape
    coarse = index.quantizer.reconstruct_n(0, NLIST)
    books = faiss.vector_to_array(index.pq.centroids).reshape(M, KS, dim // M)
    lists = [get_invlist(index.invlists, c) for c in range(NLIST)]
    start = np.concatenate([[0], np.cumsum([len(ids) for ids, _ in lists])]).astype(np.uint32)
    order = np.concatenate([ids for ids, _ in lists]).astype(np.uint32)
    codes = np.concatenate([codes.reshape(-1, M) for _, codes in lists]).astype(np.uint8)
    header = np.array([MAGIC, n, dim, NLIST, M, KS, 0, 0], np.uint32)
    with open(out / "index.bin", "wb") as f:
        for arr in (header, coarse.astype(np.float32), books.astype(np.float32), start, order, codes):
            f.write(arr.tobytes())

    scale = np.abs(vecs).max(axis=1) / 127
    scale[scale == 0] = 1
    q = np.round(vecs / scale[:, None]).astype(np.int8)
    rows = np.concatenate([scale.astype("<f4")[:, None].view(np.uint8), q.view(np.uint8)], axis=1)
    per = -(-n // RERANK_FILES)
    for f in range(RERANK_FILES):
        (out / f"rerank-{f}.bin").write_bytes(rows[f * per : (f + 1) * per].tobytes())
