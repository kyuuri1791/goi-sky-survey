import type { NextRequest } from "next/server";
import { getHiddenIds, getMeta } from "@/lib/server-data.ts";
import { info, neighborsOf } from "@/lib/words.ts";

// 星を押したとき: /api/neighbors?id=123
export async function GET(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id < 0 || id >= getMeta().word.length || getHiddenIds().has(id)) {
    return Response.json({ error: "番号が正しくありません" }, { status: 400 });
  }
  return Response.json({ word: info(id), neighbors: neighborsOf(id) });
}
