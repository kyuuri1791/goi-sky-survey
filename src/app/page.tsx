import Sky from "@/components/Sky.tsx";
import { homeView } from "@/lib/home.ts";
import { tile } from "@/lib/tiles.ts";
import { info, neighborsOf, resolve } from "@/lib/words.ts";

/** 最初に見せる語 */
const INTRO_WORD = "猫";

/**
 * 最初に見せる語と近い語、全体の星（段 0 のタイル。よく使われる約 4000 語）は、ページを作るときに求めてページに入れておく。
 * ページは CDN から返るので、しばらくアクセスがなくてサーバーが止まっていても、起きるのを待たずにすぐ出せる
 */
export default function Page() {
  const id = resolve(INTRO_WORD)![0];
  return <Sky home={homeView()} intro={{ word: info(id), neighbors: neighborsOf(id) }} baseTile={tile(0, 0, 0)!} />;
}
