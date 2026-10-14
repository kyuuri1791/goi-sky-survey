"""各語のベクトルを 1 バイトに丸めて、sqlite-vec の表に書き出す(読む側は src/lib/data.ts)。複合語の検索で、
分けた語のベクトルを取り出して足し、それに使われ方の近い語を探すのに使う。

  vectors-*.db  表 vectors(rowid = 語の番号、embedding = int8[300]、近さは cos)。
                表 signs(id = 先頭の語の番号、bits = そこから最大 SIGN_CHUNK 語分の、各次元が正なら 1 の 300 ビットを 40 バイトにしたもの)。
                複合語の検索で、全部の語を signs で大まかに比べて候補を絞り、候補だけ vectors で比べ直す。
                GitHub の 1 ファイル 100MB の上限より小さくなるよう、前半と後半に分ける
"""

import sqlite3
from pathlib import Path

import numpy as np
import sqlite_vec

FILES = 2
SIGN_BYTES = 40
# signs の 1 行に入れる語数(読み込むときの行数を減らす)
SIGN_CHUNK = 1024


def quantize(vecs: np.ndarray) -> np.ndarray:
    """語ごとに、一番大きい成分が 127 になるよう伸ばして丸める(cos で比べるので、語ごとの倍率は捨ててよい)"""
    scale = np.abs(vecs).max(axis=1, keepdims=True) / 127
    scale[scale == 0] = 1
    return np.round(vecs / scale).astype(np.int8)


def signs(q: np.ndarray) -> np.ndarray:
    """各次元が正なら 1 のビット列(次元 d は d // 8 バイト目の下から d % 8 ビット目。src/lib/data.ts と合わせる)"""
    bits = np.zeros((len(q), SIGN_BYTES * 8), bool)
    bits[:, : q.shape[1]] = q > 0
    return np.packbits(bits, axis=1, bitorder="little")


def connect(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.enable_load_extension(True)
    sqlite_vec.load(db)
    return db


def write(out: Path, vecs: np.ndarray) -> None:
    q = quantize(vecs)
    s = signs(q)
    per = -(-len(q) // FILES)
    for i in range(FILES):
        path = out / f"vectors-{i}.db"
        path.unlink(missing_ok=True)
        db = connect(path)
        db.execute(f"create virtual table vectors using vec0(embedding int8[{q.shape[1]}] distance_metric=cosine)")
        db.execute("create table signs (id integer primary key, bits blob not null)")
        ids = range(i * per, min((i + 1) * per, len(q)))
        db.executemany("insert into vectors(rowid, embedding) values (?, vec_int8(?))", ((j, q[j].tobytes()) for j in ids))
        db.executemany("insert into signs values (?, ?)", ((j, s[j : min(j + SIGN_CHUNK, ids.stop)].tobytes()) for j in ids[::SIGN_CHUNK]))
        db.commit()
        db.execute("vacuum")
        db.close()


def read(out: Path) -> np.ndarray:
    """書き出したベクトルを語の番号の順に戻す"""
    parts = []
    for i in range(FILES):
        db = connect(out / f"vectors-{i}.db")
        parts += [np.frombuffer(e, np.int8) for _, e in db.execute("select rowid, embedding from vectors order by rowid")]
        db.close()
    return np.stack(parts)
