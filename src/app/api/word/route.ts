import type { NextRequest } from "next/server";
import { combine, info, nearest, resolve } from "@/lib/words.ts";

// 語を探す: /api/word?w=猫
// 語彙にない複合語は語彙にある語に分けて意味を合わせ、その近くの語を返す（composite に分けた語）
export async function GET(request: NextRequest) {
  const w = (request.nextUrl.searchParams.get("w") ?? "").slice(0, 40);
  const ids = resolve(w);
  if (!ids) return Response.json({ error: `「${w}」は見つかりませんでした` }, { status: 404 });
  if (ids.length === 1) {
    const id = ids[0];
    return Response.json({ word: info(id), neighbors: nearest(combine([id]), 8, [id]) });
  }
  // 一番近い語をその語として扱い、残りの 8 語を近い語にする
  const [word, ...neighbors] = nearest(combine(ids), 9, ids);
  return Response.json({ composite: ids.map((id) => info(id)), word, neighbors });
}
