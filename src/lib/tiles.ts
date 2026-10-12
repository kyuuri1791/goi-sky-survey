import "server-only";
import { MAX_LEVEL, levelOf } from "./levels.ts";
import type { TilePoint } from "@/types.ts";
import { sql } from "./data.ts";

const g = globalThis as { __goiLevelStarts?: number[] };

/**
 * 段ごとの、そこに入る語の番号の範囲。段 L は番号 starts[L] 以上 starts[L + 1] 未満(levelOf は番号について増えるだけなので、範囲は続いている)。
 * 起動したときに全部の語を読んでタイルに分けておくと、サーバーが起きてから最初のタイルが遅くなるので、範囲だけ求めておき、タイルは SQL で引く
 */
function levelStarts(): number[] {
  if (!g.__goiLevelStarts) {
    const { n } = sql("select count(*) as n from words").get() as { n: number };
    const starts = [0];
    for (let level = 1; level <= MAX_LEVEL; level++) {
      let lo = starts[level - 1], hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (levelOf(mid) >= level) hi = mid;
        else lo = mid + 1;
      }
      starts.push(lo);
    }
    g.__goiLevelStarts = [...starts, n];
  }
  return g.__goiLevelStarts;
}

/** 段 level のタイル (tx, ty) に入る点(よく使われる順)。範囲の外なら null */
export function tile(level: number, tx: number, ty: number): TilePoint[] | null {
  const size = 2 ** level;
  if (![level, tx, ty].every(Number.isInteger) || level < 0 || level > MAX_LEVEL || tx < 0 || ty < 0 || tx >= size || ty >= size) return null;
  // タイルの範囲(平面は −1〜1)。端のタイルは、外にはみ出した語も入れる(tileIndex と同じ分け方)
  const lo = (t: number) => (t === 0 ? -Infinity : -1 + (2 * t) / size);
  const hi = (t: number) => (t === size - 1 ? Infinity : -1 + (2 * (t + 1)) / size);
  const starts = levelStarts();
  const rows = sql("select x, y, id, pos, text from words where id >= ? and id < ? and x >= ? and x < ? and y >= ? and y < ? order by id").all(
    starts[level],
    starts[level + 1],
    lo(tx),
    hi(tx),
    lo(ty),
    hi(ty),
  ) as { x: number; y: number; id: number; pos: number; text: string }[];
  return rows.map((r) => [r.x, r.y, r.id, r.pos, r.text]);
}
