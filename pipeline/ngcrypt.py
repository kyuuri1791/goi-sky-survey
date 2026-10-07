"""載せない言葉の一覧（ng.enc）の暗号化と復号。

一覧の中身は公開しないので、git には暗号化した ng.enc だけを入れる。鍵は環境変数 NG_KEY（compose が .env から渡す）。
復号した一覧はディスクに書かず、メモリ上で使う（編集するときだけ /tmp の tmpfs に置く）。

  python -m ngcrypt edit   ng.enc を復号してエディタで開き、保存したら暗号化し直す

形式: "NGE2"（4 バイト）、scrypt のソルト（16）、IV（12）、認証タグ（16）、暗号文（一覧を gzip したもの）。暗号は AES-256-GCM。
鍵をなくすと復号できないので、パスワード管理ソフトなど別の場所にも控えておくこと。
"""

import gzip
import hashlib
import os
import subprocess
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENC = Path(__file__).parent / "ng.enc"
MAGIC = b"NGE2"


def _key(salt: bytes) -> bytes:
    if not os.environ.get("NG_KEY"):
        sys.exit("鍵がありません。.env に NG_KEY を設定してください")
    return hashlib.scrypt(os.environ["NG_KEY"].encode(), salt=salt, n=2**15, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)


def decrypt() -> str:
    buf = ENC.read_bytes()
    if buf[:4] != MAGIC:
        sys.exit(f"{ENC.name} の形式が違います")
    salt, iv, tag, body = buf[4:20], buf[20:32], buf[32:48], buf[48:]
    try:
        plain = AESGCM(_key(salt)).decrypt(iv, body + tag, None)
    except Exception:
        sys.exit("復号できませんでした（鍵が違うか、ファイルが壊れています）")
    return gzip.decompress(plain).decode()


def encrypt(text: str) -> None:
    salt, iv = os.urandom(16), os.urandom(12)
    sealed = AESGCM(_key(salt)).encrypt(iv, gzip.compress(text.encode()), None)
    body, tag = sealed[:-16], sealed[-16:]
    ENC.write_bytes(MAGIC + salt + iv + tag + body)


def words() -> set[str]:
    """一覧の語（# で始まる行と空行を除く）"""
    return {s.strip() for s in decrypt().splitlines() if s.strip() and not s.startswith("#")}


if __name__ == "__main__":
    if sys.argv[1:] != ["edit"]:
        sys.exit("使い方: python -m ngcrypt edit")
    tmp = Path("/tmp/ng-words.txt")
    tmp.write_text(decrypt())
    try:
        subprocess.run([os.environ.get("EDITOR", "vi"), str(tmp)], check=True)
        encrypt(tmp.read_text())
        print(f"{ENC.name} を暗号化し直しました。反映するには npm run data:all を実行してください")
    finally:
        tmp.unlink(missing_ok=True)
