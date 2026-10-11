import "server-only";
import { MAX_LEVEL, levelOf, tileIndex } from "./levels.ts";
import type { TilePoint } from "@/types.ts";
import { sql } from "./data.ts";

const g = globalThis as { __goiTiles?: Map<string, number[]> };

const key = (level: number, tx: number, ty: number) => `${level}/${tx}/${ty}`;

/**
 * 段・タイルごとに、そこに入る語の番号を分けておく(空間のインデックス)。最初に呼ばれたときに作って、以後は使い回す。
 * 番号の小さい順に入れるので、タイルの中もよく使われる順に並ぶ
 */
function buckets(): Map<string, number[]> {
  if (!g.__goiTiles) {
    const map = new Map<string, number[]>();
    for (const { id, x, y } of sql("select id, x, y from words order by id").iterate() as Iterable<{ id: number; x: number; y: number }>) {
      const level = levelOf(id);
      const k = key(level, tileIndex(x, level), tileIndex(y, level));
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
  const ids = buckets().get(key(level, tx, ty)) ?? [];
  const rows = sql("select x, y, id, pos, text from words where id in (select value from json_each(?)) order by id").all(JSON.stringify(ids)) as {
    x: number;
    y: number;
    id: number;
    pos: number;
    text: string;
  }[];
  return rows.map((r) => [r.x, r.y, r.id, r.pos, r.text]);
}
