"""各語のベクトルを、SQLite の vec1 の表に書き出す(読む側は src/lib/data.ts)。複合語の検索で、
分けた語のベクトルを取り出して足し、それに使われ方の近い語を探すのに使う。

  vectors-*.db  表 vectors(rowid = 語の番号、vector = 長さ 1 の float32[300])。
                vec1 は各語を短い符号に縮めたインデックスで近い候補を探す(近さは cos)。
                GitHub の 1 ファイル 100MB の上限より小さくなるよう、語の番号の順に分ける
"""

import sqlite3
from pathlib import Path

import numpy as np

FILES = 6
VEC1 = "/vec1/vec1.so"
# 学習の設定(各語を 32 バイトの符号に縮める。語をグループに分けて一部だけ探す方式は、当たりが下がるので使わない)
TRAIN = '{"distance":"cos","quantizer":"opq","codesize":32,"nbucket":0,"nthread":8}'


def connect(path: Path | str) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.enable_load_extension(True)
    db.load_extension(VEC1)
    return db


def write(out: Path, vecs: np.ndarray) -> None:
    v = np.ascontiguousarray(vecs, np.float32)
    per = -(-len(v) // FILES)
    paths = [out / f"vectors-{i}.db" for i in range(FILES)]
    for i, path in enumerate(paths):
        path.unlink(missing_ok=True)
        db = connect(path)
        db.execute("create virtual table vectors using vec1(vector)")
        db.executemany("insert into vectors(rowid, vector) values (?, ?)", ((j, v[j].tobytes()) for j in range(i * per, min((i + 1) * per, len(v)))))
        db.commit()
        db.close()
    # 学習は全部の語で 1 回だけ行い、各ファイルの表に同じ学習結果でインデックスを作る
    db = connect(":memory:")
    for i, path in enumerate(paths):
        db.execute(f"attach ? as v{i}", (str(path),))
    rows = " union all ".join(f"select vector from v{i}.vectors" for i in range(FILES))
    model = db.execute(f"select vec1_train(vector, ?) from ({rows})", (TRAIN,)).fetchone()[0]
    db.close()
    for path in paths:
        db = connect(path)
        db.execute("insert into vectors(cmd, vector) values ('rebuild', ?)", (model,))
        db.commit()
        db.execute("vacuum")
        db.close()


def open_all(out: Path) -> sqlite3.Connection:
    """書き出したファイルを全部つないで開く(表は v0.vectors、v1.vectors、…)"""
    db = connect(":memory:")
    for i in range(FILES):
        db.execute(f"attach ? as v{i}", (str(out / f"vectors-{i}.db"),))
    return db
