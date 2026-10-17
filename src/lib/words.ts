import "server-only";
import type { Word, WordResult } from "@/types.ts";
import { MAX_PART_LEN, nearestVectors, sql, vectorOf } from "./data.ts";

/** 語 id の情報。位置はデータを作るときに小数 5 桁に丸めてある */
export function info(id: number, score?: number): Word {
  const w = sql("select text, x, y, rank, pos from words where id = ?").get(id) as Omit<Word, "id" | "score">;
  return { id, ...w, ...(score === undefined ? {} : { score: Math.round(score * 1000) / 1000 }) };
}

/** 語彙にある語の番号か */
export const exists = (id: number) => sql("select 1 from words where id = ?").get(id) !== undefined;

/** 書き方 → 語の番号。alias は、読みや別の書き方で引けたとき 1。書き方そのものが同じなら、よく使われる語が入っている */
const lookup = (text: string) => sql("select id, alias from lookup where text = ?").get(text) as { id: number; alias: number } | undefined;

/**
 * 入力の文字列を語の番号の列にする。そのまま語彙にあればその語(書き方、別名の順に探す)、
 * なければ語彙にある語で前から一番長く切っていく(「家系ラーメン」→「家系」「ラーメン」)。切れない文字が残れば null。
 * 切るときの別名は 3 文字以上に限る(「冬のこたつ」の「のこ」が「野小」になったりしないように)
 */
export function resolve(text: string): number[] | null {
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
    // 4 を上限にする
    if (found < 0 || out.length === 4) return null;
    out.push(found);
    i += len;
  }
  return out;
}

/** 語 id に使われ方の近い語(前もって計算した表を引くだけ) */
export function neighborsOf(id: number): Word[] {
  const rows = sql("select neighbor, score from neighbors where id = ? order by k").all(id) as { neighbor: number; score: number }[];
  return rows.map((r) => info(r.neighbor, r.score));
}

/** 語彙にある語 id を引いた答え(その語と近い語) */
export function wordResult(id: number): WordResult {
  return { word: info(id), neighbors: neighborsOf(id) };
}

/**
 * 語の列 ids(複合語を分けた語)のベクトルを足し合わせた意味に、使われ方の近い語。ids は除く。
 * 各語のベクトルは長さ 1 なので、そのまま足して長さ 1 にそろえる
 */
export function nearest(ids: number[], k: number): Word[] {
  const parts = ids.map(vectorOf);
  const sum = new Float32Array(parts[0].length);
  for (const v of parts) v.forEach((x, d) => (sum[d] += x));
  const len = Math.hypot(...sum);
  return nearestVectors(sum.map((x) => x / len), k + ids.length)
    .filter((h) => !ids.includes(h.id))
    .slice(0, k)
    .map((h) => info(h.id, h.score));
}
