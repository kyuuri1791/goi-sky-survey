import "server-only";
import type { Hit } from "./ivfpq.ts";
import { getLexicon } from "./server-data.ts";

/** ブラウザに返す語の情報 */
export type WordInfo = { id: number; text: string; x: number; y: number; rank: number; pos: number; score?: number };

export function info(id: number, score?: number): WordInfo {
  const { meta } = getLexicon();
  return { id, text: meta.display[id], x: meta.x[id], y: meta.y[id], rank: meta.rank[id], pos: meta.pos[id], ...(score === undefined ? {} : { score: Math.round(score * 1000) / 1000 }) };
}

/**
 * 入力の文字列を語の番号の列にする。そのまま語彙にあればその語、なければ語彙にある語で前から一番長く切っていく
 * （「家系ラーメン」→「家系」「ラーメン」）。切れない文字が残れば null
 */
export function resolve(text: string): number[] | null {
  const { byText, maxLen } = getLexicon();
  const t = text.trim();
  if (!t) return null;
  const whole = byText.get(t);
  if (whole !== undefined) return [whole];
  const out: number[] = [];
  let i = 0;
  while (i < t.length) {
    let found = -1;
    let len = 0;
    for (let l = Math.min(maxLen, t.length - i); l >= 1; l--) {
      const id = byText.get(t.slice(i, i + l));
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

/** 語の番号の列（符号つき）のベクトルを足し合わせる */
export function combine(parts: { id: number; sign: number }[]): Float32Array {
  const { index } = getLexicon();
  const v = new Float32Array(index.dim);
  for (const { id, sign } of parts) {
    const w = index.vector(id);
    for (let d = 0; d < v.length; d++) v[d] += sign * w[d];
  }
  return v;
}

/** v に意味の近い語。隠す語と exclude は除く */
export function nearest(v: Float32Array, k: number, exclude: number[] = []): WordInfo[] {
  const { index, hiddenIds } = getLexicon();
  const ex = new Set([...hiddenIds, ...exclude]);
  return index.search(v, k, ex).map((h: Hit) => info(h.id, h.score));
}
