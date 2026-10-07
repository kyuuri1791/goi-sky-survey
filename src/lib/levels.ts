// 拡大の段とタイルの決まり。サーバー（タイルを作る）とブラウザ（どのタイルを読むか決める）の両方で使う。
//
// 語の番号（id）は、よく使われる順。よく使われる語ほど、引いて見ているとき（浅い段）から出す。
// 拡大率 z のとき、よく使われる方から BASE × z^EXP 語が見えるようにする。
// 段 L では平面（−1〜1 の正方形）を 2^L × 2^L のタイルに区切る。

export const BASE = 4000;
export const EXP = 1.6;
/** 一番深い段（約 39 万語がすべて段 0〜5 に入る） */
export const MAX_LEVEL = 5;

/** 品詞の大分類。点の色と凡例の順。pipeline/build.py の POS_CLASS の番号と合わせる */
export const POS_NAMES = ["動詞", "形容詞", "副詞など", "名詞", "固有名詞", "その他"];

/** 拡大率 z で見せる語の数 */
export const visibleCount = (z: number) => BASE * Math.max(1, z) ** EXP;

/** 語 id が現れる段: 4000 × (2^L)^1.6 > id となる一番小さい L */
export const levelOf = (id: number) => (id < BASE ? 0 : Math.min(MAX_LEVEL, Math.ceil(Math.log2((id / BASE) ** (1 / EXP)))));

/** 段 level で、平面の座標 v（x か y）が入るタイルの番号（0 〜 2^level − 1） */
export const tileIndex = (v: number, level: number) => {
  const g = 2 ** level;
  return Math.max(0, Math.min(g - 1, Math.floor(((v + 1) / 2) * g)));
};

/** 最初に見せる範囲: よく使われる語が集まっている所の中心と、そこから縦横それぞれどこまでか（平面の座標） */
export type HomeView = { x: number; y: number; rx: number; ry: number };
