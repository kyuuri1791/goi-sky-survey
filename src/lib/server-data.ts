import "server-only";
import fs from "node:fs";
import path from "node:path";
import { IvfPq } from "./ivfpq.ts";

export type Meta = {
  word: string[];
  display: string[];
  pos: number[];
  x: number[];
  y: number[];
  rank: number[];
  hidden: number[];
  /** 検索用の別名（読み、ひらがなを含む別の書き方）→ 語の番号 */
  alias: Record<string, number>;
};

export type Lexicon = {
  meta: Meta;
  index: IvfPq;
  /** 書き方（正規化表記・普段の書き方のどちらでも）→ 語の番号 */
  byText: Map<string, number>;
  /** 別名（読み、ひらがなを含む別の書き方）→ 語の番号 */
  byAlias: Map<string, number>;
  /** 隠す語（不適切な言葉）。検索結果に出さない */
  hiddenIds: Set<number>;
  /** 複合語を分けるときの、一番長い語の文字数 */
  maxLen: number;
  /** 前もって計算した近い語（語ごとに NEIGHBORS 個、近い順）と、その近さ × 10000 */
  neighborIds: Uint32Array;
  neighborScores: Int16Array;
};

/** neighbors.bin に入っている、語ごとの近い語の数（pipeline/neighbors.py の K） */
export const NEIGHBORS = 8;

const g = globalThis as { __goiLexicon?: Lexicon };

/** 単語の情報と検索の索引。最初に呼ばれたときに読み込んで、以後は使い回す */
export function getLexicon(): Lexicon {
  if (!g.__goiLexicon) {
    const dir = path.join(process.cwd(), "data");
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as Meta;
    const index = new IvfPq(path.join(dir, "index.bin"));
    const byText = new Map<string, number>();
    const hiddenIds = new Set<number>();
    let maxLen = 1;
    meta.word.forEach((w, id) => {
      if (meta.hidden[id]) {
        hiddenIds.add(id);
        return;
      }
      // よく使われる方（番号の小さい方）を優先する
      for (const t of [w, meta.display[id]]) {
        if (!byText.has(t)) byText.set(t, id);
        maxLen = Math.max(maxLen, t.length);
      }
    });
    const byAlias = new Map(Object.entries(meta.alias));
    for (const t of byAlias.keys()) maxLen = Math.max(maxLen, t.length);
    // 近い語の表: 番号（u32）の並びのあとに近さ（i16）の並び
    const nb = fs.readFileSync(path.join(dir, "neighbors.bin"));
    const count = meta.word.length * NEIGHBORS;
    const neighborIds = new Uint32Array(nb.buffer.slice(nb.byteOffset, nb.byteOffset + count * 4));
    const neighborScores = new Int16Array(nb.buffer.slice(nb.byteOffset + count * 4, nb.byteOffset + count * 6));
    g.__goiLexicon = { meta, index, byText, byAlias, hiddenIds, maxLen: Math.min(maxLen, 20), neighborIds, neighborScores };
  }
  return g.__goiLexicon;
}
