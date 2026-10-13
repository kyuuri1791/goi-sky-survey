"""各語のベクトルを 1 バイトに丸めて書き出す(読む側は src/lib/data.ts)。複合語の検索で、
分けた語のベクトルを取り出して足し、それに使われ方の近い語を全部の語と比べて探すのに使う。

  vectors-*.db  表 chunks(id = まとまりの番号、data = CHUNK 語分のベクトル、norms = その長さ)。
                まとまり c には語の番号 c × CHUNK から CHUNK 語が入り、1 語は STRIDE バイト(300 次元の後ろを 0 で埋める。
                src/lib/dots.c が 16 バイトずつまとめて計算するため)、長さは float32。
                GitHub の 1 ファイル 100MB の上限より小さくなるよう、前半と後半に分ける
"""

import sqlite3
from pathlib import Path

import numpy as np

FILES = 2
CHUNK = 1024
DIM, STRIDE = 300, 304


def quantize(vecs: np.ndarray) -> np.ndarray:
    """語ごとに、一番大きい成分が 127 になるよう伸ばして丸める(cos で比べるので、語ごとの倍率は捨ててよい)"""
    scale = np.abs(vecs).max(axis=1, keepdims=True) / 127
    scale[scale == 0] = 1
    return np.round(vecs / scale).astype(np.int8)


def write(out: Path, vecs: np.ndarray) -> None:
    q = np.zeros((len(vecs), STRIDE), np.int8)
    q[:, :DIM] = quantize(vecs)
    norms = np.linalg.norm(q.astype(np.float32), axis=1).astype(np.float32)
    chunks = -(-len(q) // CHUNK)
    per = -(-chunks // FILES)
    for i in range(FILES):
        path = out / f"vectors-{i}.db"
        path.unlink(missing_ok=True)
        db = sqlite3.connect(path)
        db.execute("pragma page_size = 65536")
        db.execute("create table chunks (id integer primary key, data blob not null, norms blob not null)")
        rows = ((c, q[c * CHUNK : (c + 1) * CHUNK].tobytes(), norms[c * CHUNK : (c + 1) * CHUNK].tobytes()) for c in range(i * per, min((i + 1) * per, chunks)))
        db.executemany("insert into chunks values (?, ?, ?)", rows)
        db.commit()
        db.close()


def read(out: Path) -> np.ndarray:
    """書き出したベクトルを語の番号の順に戻す"""
    parts = []
    for i in range(FILES):
        db = sqlite3.connect(out / f"vectors-{i}.db")
        parts += [np.frombuffer(d, np.int8).reshape(-1, STRIDE)[:, :DIM] for (d,) in db.execute("select data from chunks order by id")]
        db.close()
    return np.concatenate(parts)
