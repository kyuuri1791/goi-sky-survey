import { tile } from "@/lib/tiles.ts";

// 表示のタイル: /api/tiles/2/1/3 → 段 2 のタイル (1, 3) に入る点 [[x, y, id, 品詞, 表示], ...]
export async function GET(_request: Request, ctx: RouteContext<"/api/tiles/[level]/[x]/[y]">) {
  const { level, x, y } = await ctx.params;
  const points = tile(Number(level), Number(x), Number(y));
  if (!points) return Response.json({ error: "タイルの番号が正しくありません" }, { status: 400 });
  return Response.json(points);
}
