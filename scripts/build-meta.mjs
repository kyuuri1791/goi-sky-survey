// 配置（data-src/layout.json）から、サーバーが持つ単語の情報 data/meta.json を作る
//   node --max-old-space-size=2048 scripts/build-meta.mjs
//
// 単語の番号（id）は、表示する語をよく使われる順に並べたときの順番（layout.json の並び）。
// meta.json は語ごとの配列の組: word（chiVe の表記）、display（表示）、pos（品詞の番号）、x、y、rank（chiVe の順位）、hidden と、
// 検索用の別名 alias（読みやひらがなを含む別の書き方 → 語の番号。ごはん → ご飯、朝ごはん → 朝御飯）
// 表示のタイルは、サーバーがこの情報からその場で作る（src/lib/tiles.ts）
import fs from "node:fs";
import { load } from "./lib.mjs";

// 品詞の番号。src/lib/levels.ts の POS_NAMES（動詞、形容詞、副詞など、名詞、固有名詞、その他）の順
const posClass = (p) =>
  p === "動詞" ? 0 : p === "形容詞" || p === "形状詞" ? 1 : ["副詞", "接続詞", "連体詞", "代名詞", "感動詞"].includes(p) ? 2 : p === "名詞" ? 3 : p === "固有名詞" ? 4 : 5;

const { words } = load();
const L = JSON.parse(fs.readFileSync("data-src/layout.json", "utf8"));
const SURFACE = JSON.parse(fs.readFileSync("data-src/surface.json", "utf8"));
const POS = JSON.parse(fs.readFileSync("data-src/pos.json", "utf8"));
const ALIAS = JSON.parse(fs.readFileSync("data-src/alias.json", "utf8"));
// 配置を作ったあとに不適切と分かった語は、ここで隠す（配置と索引の番号は変えない）
const NG = new Set(fs.readFileSync("data-src/ng-words.txt", "utf8").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#")));

const meta = { word: [], display: [], pos: [], x: [], y: [], rank: [], hidden: [] };
let hidden = 0;
for (let id = 0; id < L.ids.length; id++) {
  const w = words[L.ids[id]];
  const hide = NG.has(w);
  if (hide) hidden++;
  // 隠す語は文字を残さない（data/meta.json はリポジトリに入るので）
  meta.word.push(hide ? "" : w);
  meta.display.push(hide ? "" : (SURFACE[w] ?? w));
  meta.pos.push(posClass(POS[w] ?? "その他"));
  meta.x.push(L.x[id]);
  meta.y.push(L.y[id]);
  meta.rank.push(L.ids[id] + 1);
  meta.hidden.push(hide ? 1 : 0);
}
// 別名: 読みを先に、別の書き方を後に入れ、同じ別名はよく使われる語（番号の小さい方）にする。
// どれかの語の書き方そのものと同じ別名は入れない（書き方の方を優先する）
const exact = new Set([...meta.word, ...meta.display]);
meta.alias = {};
for (const key of ["reading", "variants"]) {
  for (let id = 0; id < L.ids.length; id++) {
    const a = ALIAS[meta.word[id]];
    if (!a || meta.hidden[id]) continue;
    for (const t of [a[key] ?? []].flat()) if (t.length >= 2 && !exact.has(t) && !(t in meta.alias)) meta.alias[t] = id;
  }
}
fs.writeFileSync("data/meta.json", JSON.stringify(meta));
console.log(`${L.ids.length - hidden} 語（隠した語 ${hidden}）→ data/meta.json ${(fs.statSync("data/meta.json").size / 1e6).toFixed(1)}MB`);
