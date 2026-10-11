import { CDN_CACHE, getHiddenIds, getWords, loadAll } from "@/server/data.ts";
import { wordResult } from "@/server/words.ts";

// 星を押したとき: /api/neighbors/123
export async function GET(_request: Request, ctx: RouteContext<"/api/neighbors/[id]">) {
  loadAll();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id < 0 || id >= getWords().n || getHiddenIds().has(id)) {
    return Response.json({ error: "番号が正しくありません" }, { status: 400 });
  }
  return Response.json(wordResult(id), { headers: CDN_CACHE });
}
