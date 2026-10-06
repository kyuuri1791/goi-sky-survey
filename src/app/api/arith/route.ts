import type { NextRequest } from "next/server";
import { combine, info, nearest, resolve } from "@/lib/words.ts";

// 言葉の足し算: /api/arith?q=王様 - 男 + 女
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 120);
  const tokens = q.replace(/[＋]/g, "+").replace(/[－−]/g, "-").split(/\s*([+-])\s*/).filter(Boolean);
  const parts: { id: number; sign: number }[] = [];
  let sign = 1;
  for (const tk of tokens) {
    if (tk === "+" || tk === "-") {
      sign = tk === "+" ? 1 : -1;
      continue;
    }
    const ids = resolve(tk);
    if (!ids) return Response.json({ error: `「${tk}」は見つかりませんでした` }, { status: 404 });
    for (const id of ids) parts.push({ id, sign });
    sign = 1;
  }
  if (parts.length < 2) return Response.json({ error: "2 つ以上の語を + か - でつないでください" }, { status: 400 });
  const used = parts.map((p) => p.id);
  const results = nearest(combine(parts), 6, used);
  return Response.json({ parts: parts.map((p) => ({ ...info(p.id), sign: p.sign })), results });
}
