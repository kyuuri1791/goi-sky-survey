"""300 次元のベクトルを UMAP で 2 次元に並べる。遠い語どうしの距離ではなく、近所づきあい（局所的な近さ）が保たれる。"""

import numpy as np
import umap


def layout(vecs: np.ndarray) -> np.ndarray:
    """各語の平面上の位置（語数 × 2）。全体が −1〜1 の正方形に収まるようにそろえる"""
    # 乱数の種を固定すると UMAP が 1 スレッドでしか動かず遅くなるので、固定しない（作り直すたびに配置は少し変わる）。
    # 最初の配置は、既定のスペクトル法だと 39 万語ではメモリが足りなくなるので PCA にする
    emb = umap.UMAP(n_neighbors=20, min_dist=0.3, spread=1.5, init="pca", low_memory=True, verbose=True).fit_transform(vecs)
    lo, hi = emb.min(axis=0), emb.max(axis=0)
    return (emb - (lo + hi) / 2) * (2 / (hi - lo).max())
