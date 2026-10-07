import "server-only";
import type { Hit } from "./ivfpq.ts";
import { getLexicon, NEIGHBORS } from "./server-data.ts";

/** ブラウザに返す語の情報 */
export type WordInfo = { id: number; text: string; x: number; y: number; rank: number; pos: number; score?: number };

export function info(id: number, score?: number): WordInfo {
  const { meta } = getLexicon();
  return { id, text: meta.display[id], x: meta.x[id], y: meta.y[id], rank: meta.rank[id], pos: meta.pos[id], ...(score === undefined ? {} : { score: Math.round(score * 1000) / 1000 }) };
}

/**
 * 入力の文字列を語の番号の列にする。そのまま語彙にあればその語（書き方、別名の順に探す）、
 * なければ語彙にある語で前から一番長く切っていく（「家系ラーメン」→「家系」「ラーメン」）。切れない文字が残れば null。
 * 切るときの別名は 3 文字以上に限る（「冬のこたつ」の「のこ」が「野小」になったりしないように）
 */
export function resolve(text: string): number[] | null {
  const { byText, byAlias, maxLen } = getLexicon();
  const t = text.trim();
  if (!t) return null;
  const whole = byText.get(t) ?? byAlias.get(t);
  if (whole !== undefined) return [whole];
  const out: number[] = [];
  let i = 0;
  while (i < t.length) {
    let found = -1;
    let len = 0;
    for (let l = Math.min(maxLen, t.length - i); l >= 1; l--) {
      const part = t.slice(i, i + l);
      const id = byText.get(part) ?? (l >= 3 ? byAlias.get(part) : undefined);
      if (id !== undefined) {
        found = id;
        len = l;
        break;
      }
    }
    if (found < 0) return null;
    out.push(found);
    i += len;
  }
  return out;
}

/** 語の番号の列のベクトルを足し合わせる */
export function combine(ids: number[]): Float32Array {
  const { index } = getLexicon();
  const v = new Float32Array(index.dim);
  for (const id of ids) {
    const w = index.vector(id);
    for (let d = 0; d < v.length; d++) v[d] += w[d];
  }
  return v;
}

/** 語 id に意味の近い語（前もって計算した表を引くだけ）。隠す語は除く */
export function neighborsOf(id: number): WordInfo[] {
  const { neighborIds, neighborScores, hiddenIds } = getLexicon();
  const out: WordInfo[] = [];
  for (let k = id * NEIGHBORS; k < (id + 1) * NEIGHBORS; k++) {
    if (!hiddenIds.has(neighborIds[k])) out.push(info(neighborIds[k], neighborScores[k] / 10000));
  }
  return out;
}

/** v に意味の近い語（索引で探す。複合語のように表にない問い合わせに使う）。隠す語と exclude は除く */
export function nearest(v: Float32Array, k: number, exclude: number[] = []): WordInfo[] {
  const { index, hiddenIds } = getLexicon();
  const ex = new Set([...hiddenIds, ...exclude]);
  return index.search(v, k, ex).map((h: Hit) => info(h.id, h.score));
}
