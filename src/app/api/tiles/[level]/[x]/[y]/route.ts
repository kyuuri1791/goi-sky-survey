import { gzipSync } from "node:zlib";
import { CDN_CACHE, loadAll } from "@/server/data.ts";
import { tile } from "@/server/tiles.ts";

// 表示のタイル: /api/tiles/2/1/3 → 段 2 のタイル (1, 3) に入る点 [[x, y, id, 品詞, 表示], ...]
export async function GET(request: Request, ctx: RouteContext<"/api/tiles/[level]/[x]/[y]">) {
  loadAll();
  const { level, x, y } = await ctx.params;
  const points = tile(Number(level), Number(x), Number(y));
  if (!points) return Response.json({ error: "タイルの番号が正しくありません" }, { status: 400 });
  // タイルは 1 つ 100KB を超えることがあり、デプロイ先では圧縮されずに送られるので、ここで gzip する（4 割ほどになる）
  if (!/\bgzip\b/.test(request.headers.get("accept-encoding") ?? "")) return Response.json(points, { headers: { ...CDN_CACHE, Vary: "Accept-Encoding" } });
  return new Response(gzipSync(JSON.stringify(points)), {
    headers: { ...CDN_CACHE, "Content-Type": "application/json", "Content-Encoding": "gzip", Vary: "Accept-Encoding" },
  });
}
