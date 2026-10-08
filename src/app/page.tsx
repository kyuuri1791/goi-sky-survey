import Sky from "@/components/Sky.tsx";
import { homeView } from "@/lib/home.ts";
import { info, neighborsOf, resolve } from "@/lib/words.ts";

/** 最初に見せる語。ページを作るときに近い語まで求めてページに入れておき、サーバーの応答を待たずに出す */
const INTRO_WORD = "猫";

export default function Page() {
  const id = resolve(INTRO_WORD)![0];
  return <Sky home={homeView()} intro={{ word: info(id), neighbors: neighborsOf(id) }} />;
}
