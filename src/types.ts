// ブラウザとサーバーで共通の型(API の答えと、ページに入れて渡すデータ)

/** 語の情報。score は近さ(近い語として返すときだけ)。id が負なら、語彙にない複合語の仮の点(rank と pos は使わない) */
export type Word = { id: number; text: string; x: number; y: number; rank: number; pos: number; score?: number };

/** 語を引いた答え。composite は、語彙にない複合語を分けた語(そのとき word は、分けた語の意味を合わせた地図上の仮の点) */
export type WordResult = { word: Word; neighbors: Word[]; composite?: Word[] };

/** タイルの点: [x, y, id, 品詞, 表示] */
export type TilePoint = [number, number, number, number, string];
