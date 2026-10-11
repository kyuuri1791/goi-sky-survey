import { CDN_CACHE } from "@/lib/data.ts";
import { exists, wordResult } from "@/lib/words.ts";

// 星を押したとき: /api/neighbors/123
export async function GET(_request: Request, ctx: RouteContext<"/api/neighbors/[id]">) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id < 0 || !exists(id)) {
    return Response.json({ error: "番号が正しくありません" }, { status: 400 });
  }
  return Response.json(wordResult(id), { headers: CDN_CACHE });
}
