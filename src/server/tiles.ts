import "server-only";
import { MAX_LEVEL, levelOf, tileIndex } from "@/shared/levels.ts";
import type { TilePoint } from "@/shared/types.ts";
import { getHiddenIds, getWords } from "./data.ts";
import { round5 } from "./words.ts";

const g = globalThis as { __goiTiles?: Map<string, number[]> };

const key = (level: number, tx: number, ty: number) => `${level}/${tx}/${ty}`;

/**
 * 段・タイルごとに、そこに入る語の番号を分けておく（空間の索引）。最初に呼ばれたときに作って、以後は使い回す。
 * 番号の小さい順に入れるので、タイルの中もよく使われる順に並ぶ
 */
function buckets(): Map<string, number[]> {
  if (!g.__goiTiles) {
    const meta = getWords(), hiddenIds = getHiddenIds();
    const map = new Map<string, number[]>();
    for (let id = 0; id < meta.n; id++) {
      if (hiddenIds.has(id)) continue;
      const level = levelOf(id);
      const k = key(level, tileIndex(meta.x[id], level), tileIndex(meta.y[id], level));
      const list = map.get(k);
      if (list) list.push(id);
      else map.set(k, [id]);
    }
    g.__goiTiles = map;
  }
  return g.__goiTiles;
}

/** 段 level のタイル (tx, ty) に入る点。範囲の外なら null */
export function tile(level: number, tx: number, ty: number): TilePoint[] | null {
  const size = 2 ** level;
  if (![level, tx, ty].every(Number.isInteger) || level < 0 || level > MAX_LEVEL || tx < 0 || ty < 0 || tx >= size || ty >= size) return null;
  const meta = getWords();
  return (buckets().get(key(level, tx, ty)) ?? []).map((id) => [round5(meta.x[id]), round5(meta.y[id]), id, meta.pos[id], meta.display(id)]);
}
