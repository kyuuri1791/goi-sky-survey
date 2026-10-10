import "server-only";
import { MAX_LEVEL, levelOf, tileIndex } from "./levels.ts";
import { getHiddenIds, getWords } from "./server-data.ts";

/** ブラウザに送る点: [x, y, id, 品詞, 表示] */
export type TilePoint = [number, number, number, number, string];

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
  // 位置は小数 5 桁に丸める（f32 のまま JSON にすると桁が多くなる）
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  return (buckets().get(key(level, tx, ty)) ?? []).map((id) => [r(meta.x[id]), r(meta.y[id]), id, meta.pos[id], meta.display(id)]);
}
