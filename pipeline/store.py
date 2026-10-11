"""アプリが読む単語の情報を、サーバーがそのまま型付き配列として読めるバイナリで書き出す（読む側は src/server/data.ts）。

JSON にすると、サーバーが起動するたびに 39 万語ぶんを読んで組み立てることになり、メモリも CPU も多く使うため。
どれもリトルエンディアン。各部分の始まりは 4 バイト単位にそろえる。

  words.bin     "GWD1"、語数 n（u32）、語の並びのハッシュ（8 バイト）、予約（u32）
                x（f32[n]）、y（f32[n]）、頻度順位（u32[n]）、品詞の番号（u8[n]）、隠す語（u8[n]）
                表示の書き方: 始まりの位置（u32[n+1]）、UTF-8 をつなげたもの
  lookup.bin    "GLK1"、件数 m（u32）
                検索で引く書き方: 始まりの位置（u32[m+1]）、語の番号（u32[m]）、種類（u8[m]。0 = 書き方そのもの、1 = 読みや別の書き方）、
                UTF-8 をつなげたもの（バイト順に並べてあるので二分探索で引ける）
  vectors-*.bin 語ごとに倍率（f32）＋ 1 バイトに丸めたベクトル（i8 × 300）。GitHub の 1 ファイル 100MB の上限より小さくなるよう、前半と後半に分ける
"""

import hashlib
import struct
from pathlib import Path

import numpy as np

VECTOR_FILES = 2


def _pad(f) -> None:
    f.write(b"\0" * (-f.tell() % 4))


def _strings(f, texts: list[str]) -> None:
    """文字列の並びを、始まりの位置（u32[len+1]）と UTF-8 をつなげたもので書く"""
    blobs = [t.encode() for t in texts]
    f.write(np.concatenate([[0], np.cumsum([len(b) for b in blobs])]).astype("<u4").tobytes())
    f.write(b"".join(blobs))


def words_hash(words: list[str]) -> bytes:
    return hashlib.sha256("\n".join(words).encode()).digest()[:8]


def write_words(path: Path, words: list[str], display: list[str], x, y, rank, pos, hidden) -> None:
    n = len(words)
    with open(path, "wb") as f:
        f.write(b"GWD1" + struct.pack("<I", n) + words_hash(words) + struct.pack("<I", 0))
        for arr, dtype in ((x, "<f4"), (y, "<f4"), (rank, "<u4"), (pos, "u1"), (hidden, "u1")):
            f.write(np.asarray(arr, dtype).tobytes())
        _pad(f)
        _strings(f, display)


def read_positions(path: Path) -> tuple[bytes, np.ndarray, np.ndarray]:
    """words.bin から、語の並びのハッシュと位置を読む（配置を変えずに作り直すとき用）"""
    buf = path.read_bytes()
    assert buf[:4] == b"GWD1", "words.bin の形式が違います"
    (n,) = struct.unpack_from("<I", buf, 4)
    x = np.frombuffer(buf, "<f4", n, 20)
    y = np.frombuffer(buf, "<f4", n, 20 + 4 * n)
    return buf[8:16], x, y


def write_lookup(path: Path, entries: dict[str, tuple[int, int]]) -> None:
    """entries: 書き方 → (語の番号, 種類)。バイト順に並べて書く"""
    keys = sorted(entries, key=lambda t: t.encode())
    with open(path, "wb") as f:
        f.write(b"GLK1" + struct.pack("<I", len(keys)))
        blobs = [k.encode() for k in keys]
        f.write(np.concatenate([[0], np.cumsum([len(b) for b in blobs])]).astype("<u4").tobytes())
        f.write(np.array([entries[k][0] for k in keys], "<u4").tobytes())
        f.write(np.array([entries[k][1] for k in keys], "u1").tobytes())
        _pad(f)
        f.write(b"".join(blobs))


def write_vectors(out: Path, vecs: np.ndarray) -> None:
    scale = np.abs(vecs).max(axis=1) / 127
    scale[scale == 0] = 1
    q = np.round(vecs / scale[:, None]).astype(np.int8)
    rows = np.concatenate([scale.astype("<f4")[:, None].view(np.uint8), q.view(np.uint8)], axis=1)
    per = -(-len(vecs) // VECTOR_FILES)
    for i in range(VECTOR_FILES):
        (out / f"vectors-{i}.bin").write_bytes(rows[i * per : (i + 1) * per].tobytes())
