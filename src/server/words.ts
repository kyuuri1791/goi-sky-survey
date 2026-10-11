import "server-only";
import type { Word, WordResult } from "@/shared/types.ts";
import { getHiddenIds, getIndex, getLookup, getNeighbors, getVectors, getWords, MAX_PART_LEN, NEIGHBORS } from "./data.ts";

/** ブラウザに渡す位置は小数 5 桁に丸める（f32 のまま JSON にすると桁が多くなる） */
export const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

export function info(id: number, score?: number): Word {
  const w = getWords();
  return { id, text: w.display(id), x: round5(w.x[id]), y: round5(w.y[id]), rank: w.rank[id], pos: w.pos[id], ...(score === undefined ? {} : { score: Math.round(score * 1000) / 1000 }) };
}

/**
 * 入力の文字列を語の番号の列にする。そのまま語彙にあればその語（書き方、別名の順に探す）、
 * なければ語彙にある語で前から一番長く切っていく（「家系ラーメン」→「家系」「ラーメン」）。切れない文字が残れば null。
 * 切るときの別名は 3 文字以上に限る（「冬のこたつ」の「のこ」が「野小」になったりしないように）
 */
export function resolve(text: string): number[] | null {
  const lookup = getLookup();
  const t = text.trim();
  if (!t) return null;
  const whole = lookup(t);
  if (whole) return [whole.id];
  const out: number[] = [];
  let i = 0;
  while (i < t.length) {
    let found = -1;
    let len = 0;
    for (let l = Math.min(MAX_PART_LEN, t.length - i); l >= 1; l--) {
      const hit = lookup(t.slice(i, i + l));
      if (hit && (!hit.alias || l >= 3)) {
        found = hit.id;
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
export async function combine(ids: number[]): Promise<Float32Array> {
  const vectors = await getVectors();
  const v = new Float32Array(vectors.dim);
  for (const id of ids) {
    const w = vectors.vector(id);
    for (let d = 0; d < v.length; d++) v[d] += w[d];
  }
  return v;
}

/** 語 id に使われ方の近い語（前もって計算した表を引くだけ）。隠す語は除く */
export function neighborsOf(id: number): Word[] {
  const { ids, scores } = getNeighbors();
  const hiddenIds = getHiddenIds();
  const out: Word[] = [];
  for (let k = id * NEIGHBORS; k < (id + 1) * NEIGHBORS; k++) {
    if (!hiddenIds.has(ids[k])) out.push(info(ids[k], scores[k] / 10000));
  }
  return out;
}

/** 語彙にある語 id を引いた答え（その語と近い語） */
export function wordResult(id: number): WordResult {
  return { word: info(id), neighbors: neighborsOf(id) };
}

/** 索引で大まかに絞る候補の数。この中から、1 バイトに丸めたベクトルで近さを計算し直して上位を決める */
const CANDIDATES = 200;

/** v に使われ方の近い語（複合語のように表にない問い合わせに使う）。隠す語と exclude は除く */
export async function nearest(v: Float32Array, k: number, exclude: number[] = []): Promise<Word[]> {
  const ex = new Set([...getHiddenIds(), ...exclude]);
  const vectors = await getVectors();
  let qn = 0;
  for (const x of v) qn += x * x;
  qn = Math.sqrt(qn) || 1;
  return getIndex()
    .search(v, CANDIDATES, ex)
    .map(({ id }) => ({ id, score: vectors.dot(id, v) / qn }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((h) => info(h.id, h.score));
}
