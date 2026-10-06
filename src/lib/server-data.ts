import "server-only";
import fs from "node:fs";
import path from "node:path";
import { IvfPq } from "./ivfpq.ts";

export type Meta = { word: string[]; display: string[]; pos: number[]; x: number[]; y: number[]; rank: number[]; hidden: number[] };

export type Lexicon = {
  meta: Meta;
  index: IvfPq;
  /** 書き方（正規化表記・普段の書き方のどちらでも）→ 語の番号 */
  byText: Map<string, number>;
  /** 隠す語（不適切な言葉）。検索結果に出さない */
  hiddenIds: Set<number>;
  /** 複合語を分けるときの、一番長い語の文字数 */
  maxLen: number;
};

const g = globalThis as { __goiLexicon?: Lexicon };

/** 単語の情報と検索の索引。最初に呼ばれたときに読み込んで、以後は使い回す */
export function getLexicon(): Lexicon {
  if (!g.__goiLexicon) {
    const dir = path.join(process.cwd(), "data");
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as Meta;
    const rerank = fs.readdirSync(dir).filter((f) => /^rerank-\d+\.bin$/.test(f)).sort((a, b) => parseInt(a.slice(7)) - parseInt(b.slice(7)));
    const index = new IvfPq(path.join(dir, "index.bin"), rerank.map((f) => path.join(dir, f)));
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
    g.__goiLexicon = { meta, index, byText, hiddenIds, maxLen: Math.min(maxLen, 20) };
  }
  return g.__goiLexicon;
}
