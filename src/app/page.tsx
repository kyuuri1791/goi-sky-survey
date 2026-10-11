import App from "@/app/components/App/App.tsx";
import { homeView } from "@/server/home.ts";
import { tile } from "@/server/tiles.ts";
import { resolve, wordResult } from "@/server/words.ts";

/** 最初に見せる語 */
const INTRO_WORD = "猫";

export default function Page() {
  return <App home={homeView()} intro={wordResult(resolve(INTRO_WORD)![0])} baseTile={tile(0, 0, 0)!} />;
}
