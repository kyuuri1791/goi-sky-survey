# 第三者のデータとソフトウェアについて

このリポジトリの `data/` にあるファイルは、次のデータをもとに作ったものです。どちらも Apache License, Version 2.0 で提供されています。ライセンスの全文は [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt) にあります。

## chiVe v1.3(mc90)

- 提供元: <https://github.com/WorksApplications/chiVe>
- Copyright (c) 2024 Works Applications Co., Ltd. All rights reserved.
- Licensed under the Apache License, Version 2.0

使っているファイルと、加えた変更:

- `data/vectors-*.db`: 単語ベクトルを長さ 1 にそろえ、近い語を探すインデックス(各語を短い符号に縮めたもの)と一緒に SQLite のファイルにしたもの
- `data/neighbors.db`: 単語ベクトルから計算した、各語の使われ方の近い語
- `data/words.db`: 単語の表示用の書き方と、ベクトルを 2 次元に写した位置

単語は、記号や数字だけのもの、ひらがな 1〜2 文字などと、不適切な言葉を除いています。

## SudachiDict(2026-07-23 版の small_lex.csv、core_lex.csv)

- 提供元: <https://github.com/WorksApplications/SudachiDict>
- Copyright (c) 2017-2023 Works Applications Co., Ltd.
- Licensed under the Apache License, Version 2.0
- SudachiDict は UniDic と NEologd の一部を含んでいます

使っているファイルと、加えた変更:

- `data/words.db`: 辞書の見出しから決めた、各語の表示用の書き方と品詞の大分類、検索用の読みと別の書き方

## vec1 0.8

- 提供元: <https://sqlite.org/vec1>
- パブリックドメイン(著作権は放棄されています)

`vendor/vec1/vec1.so` は、`vendor/vec1/build.sh` で vec1.c をそのままビルドしたものです。
