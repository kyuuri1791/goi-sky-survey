import { getByText, getIndex, getNeighbors } from "@/lib/server-data.ts";

// 検索に使うデータを読み込んでおく: /api/warmup（ページを開いたあと、裏で一度だけ呼ぶ）
// 索引（42MB）は複合語を初めて検索したときに読むが、デプロイ先では初めて読むファイルが遅く、そのときだけ 1 秒以上かかるので、先に済ませておく
export async function GET() {
  getByText();
  getNeighbors();
  getIndex();
  return new Response(null, { status: 204 });
}
