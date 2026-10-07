"""data/ のファイル（索引と単語の情報）を作る。npm run data:all から compose 経由で呼ぶ。

  1. chiVe と SudachiDict を取得して読み込む（2 回目からは /work に残したものを使う）
  2. 表示する語を選ぶ（載せない言葉は ng.enc を復号してメモリ上で使う）
  3. 表示用の書き方・品詞・検索用の別名を決める
  4. UMAP で 2 次元に並べる
  5. IVF-PQ の索引を作る
  6. 全部の語の近い語を計算する
  7. /out（= data/）に index.bin、neighbors.bin、meta.json を書き出す

  python -m build             全部作る
  python -m build meta        書き方・品詞・別名だけ作り直す（配置は今の data/meta.json のまま）
  python -m build neighbors   近い語の表だけ作り直す（配置は変えない）
"""

import json
import sys
import time
from pathlib import Path

import index
import neighbors
import ngcrypt
import sources
from layout import layout
from surface import analyze
from vocab import kept_ids

OUT = Path("/out")
# 品詞の番号。src/lib/levels.ts の POS_NAMES（動詞、形容詞、副詞など、名詞、固有名詞、その他）の順
POS_CLASS = {"動詞": 0, "形容詞": 1, "形状詞": 1, "副詞": 2, "接続詞": 2, "連体詞": 2, "代名詞": 2, "感動詞": 2, "名詞": 3, "固有名詞": 4}

t0 = time.time()


def log(s: str) -> None:
    print(f"[{time.time() - t0:.0f}s] {s}", flush=True)


def aliases(words: list[str], display: list[str], alias: dict) -> dict[str, int]:
    """検索用の別名 → 語の番号。いちばんよく使われる読み、別の書き方、ほかの読みの順に入れ、同じ別名はよく使われる語（番号の小さい方）にする。
    どれかの語の書き方そのものと同じ別名は入れない（書き方の方を優先する）"""
    exact = set(words) | set(display)
    out: dict[str, int] = {}
    for key in ("reading", "variants", "readings"):
        for i, w in enumerate(words):
            ts = alias[w][key]
            for t in [ts] if isinstance(ts, str) else ts or []:
                if len(t) >= 2 and t not in exact and t not in out:
                    out[t] = i
    return out


def main() -> None:
    all_words, all_vecs = sources.chive()
    ids = kept_ids(all_words, ngcrypt.words())
    words, vecs = [all_words[i] for i in ids], all_vecs[ids]
    del all_vecs  # 表示しない語も含む元のベクトルは、ここで手放してメモリを空ける
    log(f"表示する語 {len(words)}（chiVe {len(all_words)} 語から）")
    if sys.argv[1:] == ["neighbors"]:
        neighbors.write(vecs, OUT, log)
        log("近い語")
        return

    surf, pos, alias = analyze(words)
    display = [surf.get(w, w) for w in words]
    log(f"書き方・品詞・別名（書き方を変える語 {sum(w in surf for w in words)}）")
    if sys.argv[1:] == ["meta"]:
        prev = json.loads((OUT / "meta.json").read_text())
        if prev["word"] != words:
            sys.exit("今の data/meta.json と語の並びが違うので、配置を使い回せません（python -m build で全部作り直してください）")
        write_meta(words, display, pos, alias, ids, prev["x"], prev["y"])
        return

    # float32 のまま丸めると JSON に 0.12345000267028809 のように書かれるので、float64 にしてから丸める
    xy = layout(vecs).astype("float64").round(5)
    log("配置")

    ix = index.build(vecs)
    index.write(ix, *vecs.shape, OUT)
    log("索引")

    neighbors.write(vecs, OUT, log)
    log("近い語")

    write_meta(words, display, pos, alias, ids, xy[:, 0].tolist(), xy[:, 1].tolist())


def write_meta(words, display, pos, alias, ids, x, y) -> None:
    meta = {
        "word": words,
        "display": display,
        "pos": [POS_CLASS.get(pos[w], 5) for w in words],
        "x": x,
        "y": y,
        "rank": [i + 1 for i in ids],
        "hidden": [0] * len(words),
        "alias": aliases(words, display, alias),
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
    log(f"別名 {len(meta['alias'])}")
    for f in sorted(OUT.iterdir()):
        log(f"data/{f.name} {f.stat().st_size / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
