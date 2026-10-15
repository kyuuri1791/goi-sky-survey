import { CDN_CACHE } from "@/lib/data.ts";
import { info, nearest, resolve, wordResult } from "@/lib/words.ts";
import type { Word } from "@/types.ts";

// 語を探す: /api/word/猫(語は ?w= ではなくパスに入れる。CDN が ? 以降をキャッシュの区別に使わない設定でも、語ごとに別の答えとして覚えさせるため)
// 語彙にない複合語は語彙にある語に分けて意味を合わせ、その近くの語を返す(composite に分けた語)。
// 応答の Server-Timing に、近い語を探すのにかかった時間と、サーバーが起動してからの時間を入れる(本番で遅い回の内訳を、ブラウザの開発者ツールで見るため)
export async function GET(_request: Request, ctx: RouteContext<"/api/word/[w]">) {
  const start = performance.now();
  const timing = (search?: number) =>
    [search === undefined ? "" : `search;dur=${search.toFixed(1)}`, `total;dur=${(performance.now() - start).toFixed(1)}`, `uptime;dur=${Math.round(process.uptime() * 1000)}`].filter(Boolean).join(", ");
  const w = (await ctx.params).w.slice(0, 40);
  const ids = resolve(w);
  if (!ids) return Response.json({ error: `「${w}」は見つかりませんでした` }, { status: 404 });
  if (ids.length === 1) return Response.json(wordResult(ids[0]), { headers: { ...CDN_CACHE, "Server-Timing": timing() } });
  // 複合語は語彙にない点なので、地図上の位置は近い語の位置を近さで重みづけした平均にする(UMAP が新しい点を置くときの最初の位置と同じ考え方)
  const before = performance.now();
  const neighbors = nearest(ids, 8);
  const search = performance.now() - before;
  const total = neighbors.reduce((s, n) => s + n.score!, 0);
  const at = (k: "x" | "y") => Math.round((neighbors.reduce((s, n) => s + n[k] * n.score!, 0) / total) * 1e5) / 1e5;
  const word: Word = { id: -1, text: w.trim(), x: at("x"), y: at("y"), rank: 0, pos: -1 };
  return Response.json({ composite: ids.map((id) => info(id)), word, neighbors }, { headers: { ...CDN_CACHE, "Server-Timing": timing(search) } });
}
