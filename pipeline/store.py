"""アプリが読む単語の情報を、SQLite のファイルに書き出す(読む側は src/lib/data.ts)。
GitHub の 1 ファイル 100MB の上限より小さくなるよう、近い語の表は別のファイルにする。

  words.db      words      語の番号(id。よく使われる順)、表示の書き方、平面上の位置(x, y)、頻度順位、品詞の番号
                lookup     検索で引く書き方 → 語の番号。alias は、読みや別の書き方なら 1
                meta       語の並びのハッシュ(配置を変えずに作り直すとき、語の並びが同じか確かめる)
  neighbors.db  neighbors  語ごとの使われ方の近い語(近い順に k = 0, 1, …)と、その近さ(cos 類似度)
"""

import hashlib
import sqlite3
from collections.abc import Iterable
from pathlib import Path

import numpy as np

SCHEMA = {
    "words": "(id integer primary key, text text not null, x real not null, y real not null, rank integer not null, pos integer not null)",
    "lookup": "(text text primary key, id integer not null, alias integer not null) without rowid",
    "meta": "(key text primary key, value text not null) without rowid",
    "neighbors": "(id integer not null, k integer not null, neighbor integer not null, score real not null, primary key (id, k)) without rowid",
}


def words_hash(words: list[str]) -> str:
    return hashlib.sha256("\n".join(words).encode()).hexdigest()[:16]


def _replace(path: Path, table: str, columns: int, rows: Iterable[tuple]) -> None:
    """表 table の中身を rows で入れ替える(ほかの表はそのまま)"""
    db = sqlite3.connect(path)
    db.execute(f"drop table if exists {table}")
    db.execute(f"create table {table} {SCHEMA[table]}")
    db.executemany(f"insert into {table} values ({', '.join('?' * columns)})", rows)
    db.commit()
    db.execute("vacuum")
    db.close()


def write_words(path: Path, words: list[str], display: list[str], x, y, rank, pos) -> None:
    """位置は小数 5 桁に丸める(ブラウザに渡すときも 5 桁)"""
    rows = zip(range(len(words)), display, (round(float(v), 5) for v in x), (round(float(v), 5) for v in y), map(int, rank), map(int, pos))
    _replace(path, "words", 6, rows)
    _replace(path, "meta", 2, [("words_hash", words_hash(words))])


def read_positions(path: Path) -> tuple[str, np.ndarray, np.ndarray]:
    """語の並びのハッシュと位置を読む(配置を変えずに作り直すとき用)"""
    db = sqlite3.connect(path)
    (h,) = db.execute("select value from meta where key = 'words_hash'").fetchone()
    xy = np.array(db.execute("select x, y from words order by id").fetchall(), np.float32)
    db.close()
    return h, xy[:, 0], xy[:, 1]


def write_lookup(path: Path, entries: dict[str, tuple[int, int]]) -> None:
    """entries: 書き方 → (語の番号, 別名なら 1)"""
    _replace(path, "lookup", 3, ((t, i, a) for t, (i, a) in entries.items()))


def write_neighbors(path: Path, ids: np.ndarray, scores: np.ndarray) -> None:
    """ids, scores: 語の数 × K。近さは小数 4 桁に丸める"""
    rows = ((i, k, int(ids[i, k]), round(float(scores[i, k]), 4)) for i in range(len(ids)) for k in range(ids.shape[1]))
    _replace(path, "neighbors", 4, rows)
