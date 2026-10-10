import { CDN_CACHE, loadAll } from "@/lib/server-data.ts";
import { combine, info, nearest, neighborsOf, resolve } from "@/lib/words.ts";

// 語を探す: /api/word/猫（語は ?w= ではなくパスに入れる。CDN が ? 以降をキャッシュの区別に使わない設定でも、語ごとに別の答えとして覚えさせるため）
// 語彙にない複合語は語彙にある語に分けて意味を合わせ、その近くの語を返す（composite に分けた語）
export async function GET(_request: Request, ctx: RouteContext<"/api/word/[w]">) {
  loadAll();
  const w = (await ctx.params).w.slice(0, 40);
  const ids = resolve(w);
  if (!ids) return Response.json({ error: `「${w}」は見つかりませんでした` }, { status: 404 });
  if (ids.length === 1) {
    const id = ids[0];
    return Response.json({ word: info(id), neighbors: neighborsOf(id) }, { headers: CDN_CACHE });
  }
  // 一番近い語をその語として扱い、残りの 8 語を近い語にする
  const [word, ...neighbors] = await nearest(await combine(ids), 9, ids);
  return Response.json({ composite: ids.map((id) => info(id)), word, neighbors }, { headers: CDN_CACHE });
}
