// 品詞の大分類と、その色（地図の点と名前・パネル・凡例で同じものを使う）

/** 品詞の大分類の名前。pipeline/build.py の POS_CLASS の番号と合わせる */
export const POS_NAMES = ["動詞", "形容詞", "副詞など", "名詞", "固有名詞", "その他"];

export type Rgb = [number, number, number];

// 色覚の違いがあっても見分けやすい Okabe-Ito の配色を、暗い背景向けに明るくしたもの。
// いちばん多い名詞は白っぽくして全体を星空らしく保ち、その他（記号・接尾辞など）は灰色で目立たせない
const COLORS: Rgb[] = [
  [100, 185, 240], // 動詞: 空色
  [80, 210, 170], // 形容詞: 青緑
  [225, 145, 205], // 副詞など: 赤紫
  [235, 230, 215], // 名詞: 白
  [245, 170, 60], // 固有名詞: 橙
  [150, 150, 165], // その他: 灰
];

export const posRgb = (pos: number): Rgb => COLORS[pos] ?? COLORS[5];
export const posColor = (pos: number) => `rgb(${posRgb(pos)})`;
export const posName = (pos: number) => POS_NAMES[pos] ?? "";
