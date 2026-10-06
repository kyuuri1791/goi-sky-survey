# 日本語語彙スカイサーベイ（β版）

日本語の約 39 万語を意味の近さで平面に並べたWebアプリです。暗い背景に光る点として眺め、拡大すると、あまり使われない語が少しずつ現れます。

## 機能

- **見る**: ドラッグで移動、ホイールかピンチで拡大。点の明るさは語がよく使われる度合い、色は品詞
- **探す**: 語で検索するとその位置へ飛び、意味の近い語 8 つと線でつながる。点を押しても同じ
  - 語彙にない複合語は、語彙にある語に分けて意味を合わせて探す（家系ラーメン → 家系 ＋ ラーメン → 醤油ラーメン、豚骨ラーメン…）

## 仕組み

### 語のベクトルと近さ

- 単語は [chiVe](https://github.com/WorksApplications/chiVe)（v1.3、出現回数 90 回以上の約 41 万語、300 次元ベクトル）を利用している
- 近さはコサイン類似度、パネルの数字はこの値

### 語の選び方と表記

- 記号や数字だけの語、ひらがな 1〜2 文字（助詞や助動詞が大半）、NGリストを除いて 391,015 語
- chiVe は表記をそろえた形（迚も、其の、為る）で単語を持っているので、[SudachiDict](https://github.com/WorksApplications/SudachiDict) を使って普段の書き方（とても、その、する）に戻して表示する
  - かなで書かれやすい種類の語（副詞・接続詞・連体詞など）だけ、辞書でかなの書き方の方がよく使われる場合に戻す。自動でうまくいかない約 40 語は手で指定している
- 検索はどちらの書き方でも引ける。辞書の読みや、ひらがなを含む別の書き方でも引ける（ねこ → 猫、朝ごはん → 朝御飯）


### 平面への配置（`scripts/layout-all.mjs`）

300 次元を 2 次元に写すとき、遠い語どうしの距離ではなく「近所づきあい」が保たれるようにしています。画面上で近い語は意味も近いことが多い一方、画面上で遠い 2 語がどれだけ違うかは当てになりません。

1. よく使われる 5 万語を [UMAP](https://github.com/PAIR-code/umap-js) で並べる
2. 残りの約 34 万語は、意味の近い並べ済みの語 10 語を探し、そのうち一番近い語の周りにまとまっている語だけの位置の重み付き平均に、少しのずれを足して置く
   - 単純に 10 語の平均を取ると、近い語が平面のあちこちに散らばっている珍しい語が、どれとも関係ない中間に落ちてしまった

### 表示のタイル（`src/lib/levels.ts`、`src/lib/tiles.ts`）

- 語ごとに、よく使われる順位から「何段目の拡大で現れるか」を決める（拡大率 z のとき 4000 × z^1.6 語が見える。段 0〜5）
- 段 L では平面を 2^L × 2^L のタイルに区切る。サーバーは起動後の最初の問い合わせで、段・タイルごとに語を振り分けておき（796 個）、`/api/tiles/段/x/y` でその中の点を返す
- ブラウザは、いまの拡大率と見えている範囲のタイルだけを読む。一度読んだタイルはページを開いているあいだ持っておく

### 意味の近い語の検索（`scripts/build-index.mjs`、`src/lib/ivfpq.ts`）

複合語のように、問い合わせのベクトルは無数にありうるので、前もって答えを計算しておけません。毎回 39 万語から近い語を探すために、IVF-PQ の索引を自作しています。

- **IVF**: 語を 1024 グループに分けておき、問い合わせに近い 32 グループの中だけ調べる
- **PQ**: 300 次元を 6 次元 × 50 に区切り、区切りごとに 256 個の代表のどれに近いかの番号（1 バイト）で持つ。1 語 50 バイト
- **並べ直し**: 見積もりで残った上位 100 候補だけ、各数字を 1 バイトに丸めたベクトルをファイルから読んで計算し直す（メモリには載せない）

| 方法 | 本物の上位 10 語を当てた割合 | 1 回の時間 | メモリ |
|---|---|---|---|
| 全部と比べる | 100% | 約 100ms | 493MB |
| IVF-PQ（50 バイト） | 69% | 2.4ms | 24MB |
| IVF-PQ（100 バイト） | 82% | 3.4ms | 44MB |
| **IVF-PQ（50 バイト）＋ 上位 100 候補を並べ直し** | **92%** | **3.2ms** | 24MB ＋ ファイル 119MB |

（41 万語の索引で、よく使われる 10 万語から選んだ 200 語を問い合わせにした測定。`node scripts/bench/ivfpq.mjs`。全部と比べる方法は `node scripts/bench/brute.mjs`）

## 開発

```bash
npm install
npm run dev
```

### NGリスト

NGリストで不適切な言葉を除外しています。リストの中身は公開しないため、暗号化した `data-src/ng.enc` だけをリポジトリに入れています。

暗号は Node 組み込みの AES-256-GCM で、鍵は環境変数 `NG_KEY` か、git に入れない `.env` の `NG_KEY` から読みます（`scripts/crypt.mjs`）。

```bash
npm run ng:decrypt   # data-src/ng.enc → data-src/ng-words.txt（データを作り直す前に）
npm run ng:encrypt   # 一覧を更新したら暗号化し直して、data-src/ng.enc をコミットする
```

### データの作り直し
作り直すときは元データを `data-src/` に置き、NGリストを戻してから `npm run data:all` を実行します（30 分ほど）。

```bash
# chiVe
curl -o data-src/chive-1.3-mc90.tar.gz https://sudachi.s3-ap-northeast-1.amazonaws.com/chive/chive-1.3-mc90.tar.gz
tar xzf data-src/chive-1.3-mc90.tar.gz -C data-src
# SudachiDict（2026-07-23 版の small_lex.csv と core_lex.csv）
curl -o data-src/small_lex.zip https://sudachi.s3-ap-northeast-1.amazonaws.com/sudachidict-raw/20260723/small_lex.zip
curl -o data-src/core_lex.zip https://sudachi.s3-ap-northeast-1.amazonaws.com/sudachidict-raw/20260723/core_lex.zip
unzip -o data-src/small_lex.zip -d data-src
unzip -o data-src/core_lex.zip -d data-src

npm run ng:decrypt
npm run data:all
```

## デプロイ

[ロリポップ！デプロイナウ](https://lolipop.jp/deploy-now/) で公開します。

## 出典

- 単語ベクトル: chiVe（Works Applications, Apache License 2.0）
- 表記の正規化・品詞: SudachiDict（Works Applications, Apache License 2.0）

`data/` のファイルはこれらをもとに作ったものです。著作権の表示と加えた変更は [NOTICE.md](NOTICE.md)、ライセンスの全文は [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt) にあります。
