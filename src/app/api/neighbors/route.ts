import type { NextRequest } from "next/server";
import { getLexicon } from "@/lib/server-data.ts";
import { combine, info, nearest } from "@/lib/words.ts";

// 星を押したとき: /api/neighbors?id=123
export async function GET(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get("id"));
  const { meta, hiddenIds } = getLexicon();
  if (!Number.isInteger(id) || id < 0 || id >= meta.word.length || hiddenIds.has(id)) {
    return Response.json({ error: "番号が正しくありません" }, { status: 400 });
  }
  return Response.json({ word: info(id), neighbors: nearest(combine([{ id, sign: 1 }]), 8, [id]) });
}
