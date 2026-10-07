"""元データ（chiVe と SudachiDict）の取得と読み込み。取得したものと読み込んだ結果は /work（名前付きボリューム）に残し、次からは使い回す。"""

import io
import json
import tarfile
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

WORK = Path("/work")
CHIVE_URL = "https://sudachi.s3-ap-northeast-1.amazonaws.com/chive/chive-1.3-mc90.tar.gz"
SUDACHI_URL = "https://sudachi.s3-ap-northeast-1.amazonaws.com/sudachidict-raw/20260723/{}.zip"
SUDACHI_FILES = ["small_lex", "core_lex"]  # small_lex（よく使われる語）を先に読む


def _download(url: str, path: Path) -> Path:
    if not path.exists():
        print(f"取得: {url}")
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(path)
    return path


def chive() -> tuple[list[str], np.ndarray]:
    """chiVe の単語（よく使われる順）と、長さ 1 にそろえたベクトル（単語数 × 300）"""
    words_path, vecs_path = WORK / "chive-words.json", WORK / "chive-vectors.npy"
    if not vecs_path.exists():
        archive = _download(CHIVE_URL, WORK / "chive-1.3-mc90.tar.gz")
        print("chiVe を読み込み中")
        with tarfile.open(archive, "r|gz") as tar:
            member = next(m for m in tar if m.name.endswith(".txt"))
            lines = (raw.decode("utf-8") for raw in tar.extractfile(member))
            n, dim = map(int, next(lines).split())
            vecs = np.zeros((n, dim), np.float32)
            words = []
            for line in lines:
                parts = line.rstrip().split(" ")
                if len(parts) != dim + 1:
                    continue
                vecs[len(words)] = np.array(parts[1:], np.float32)
                words.append(parts[0])
        vecs = vecs[: len(words)]
        vecs /= np.maximum(np.linalg.norm(vecs, axis=1, keepdims=True), 1e-12)
        np.save(vecs_path, vecs)
        words_path.write_text(json.dumps(words, ensure_ascii=False))
    return json.loads(words_path.read_text()), np.load(vecs_path)


def sudachi_lines():
    """SudachiDict の各行を (ファイルの順, 列のリスト) で返す。small_lex.csv、core_lex.csv の順"""
    for i, name in enumerate(SUDACHI_FILES):
        archive = _download(SUDACHI_URL.format(name), WORK / f"{name}.zip")
        with zipfile.ZipFile(archive) as z, z.open(f"{name}.csv") as f:
            for line in io.TextIOWrapper(f, encoding="utf-8"):
                cols = line.rstrip("\n").split(",")
                if len(cols) >= 13:
                    yield i, cols
