"""各語のベクトルを 1 バイトに丸めて書き出す(読む側は src/lib/data.ts)。複合語の検索で、
分けた語のベクトルを取り出して足し、それに使われ方の近い語を全部の語と比べて探すのに使う。

  vectors-*.bin  語の番号の順に、1 語 STRIDE バイトずつ並べただけのファイル(300 次元の後ろを 0 で埋める。
                 src/lib/dots.c が 16 バイトずつまとめて計算するため)。検索のたびに少しずつ読むので、変換なしで読める形にしている。
                 GitHub の 1 ファイル 100MB の上限より小さくなるよう、前半と後半に分ける
"""

from pathlib import Path

import numpy as np

FILES = 2
DIM, STRIDE = 300, 304


def quantize(vecs: np.ndarray) -> np.ndarray:
    """語ごとに、一番大きい成分が 127 になるよう伸ばして丸める(cos で比べるので、語ごとの倍率は捨ててよい)"""
    scale = np.abs(vecs).max(axis=1, keepdims=True) / 127
    scale[scale == 0] = 1
    return np.round(vecs / scale).astype(np.int8)


def write(out: Path, vecs: np.ndarray) -> None:
    q = np.zeros((len(vecs), STRIDE), np.int8)
    q[:, :DIM] = quantize(vecs)
    per = -(-len(q) // FILES)
    for i in range(FILES):
        q[i * per : (i + 1) * per].tofile(out / f"vectors-{i}.bin")


def read(out: Path) -> np.ndarray:
    """書き出したベクトルを語の番号の順に戻す"""
    return np.concatenate([np.fromfile(out / f"vectors-{i}.bin", np.int8).reshape(-1, STRIDE)[:, :DIM] for i in range(FILES)])
