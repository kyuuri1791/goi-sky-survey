// chiVe の単語（Sudachi の正規化表記。例: 迚も、其の、為る）を、普段の書き方（とても、その、する）に戻す対応表を作る
//   node scripts/surface.mjs
// 基本は正規化表記のまま（見る、思う、写真などはそのまま）。かなで書かれやすい種類の言葉
//   （副詞・接続詞・連体詞・代名詞・感動詞・助動詞・助詞・接頭辞、補助的に使われる動詞・形容詞 = 下の KANA_WORDS）だけ、
// 辞書にあるひらがなの書き方のうちコストが一番小さいものを選び、それが漢字の書き方よりコストが小さい
// （かなの方がよく使われる）ときに限って戻す。突然・特に・必ず のように普段漢字で書く言葉はそのまま残る。
// 出力: data-src/surface.json（正規化表記 → 書き方。同じなら入れない）
//       data-src/pos.json（正規化表記 → 品詞の大分類。点の色に使う）
// 出典: SudachiDict（Works Applications, Apache License 2.0）
import fs from "node:fs";
import readline from "node:readline";

const KANA_POS = new Set(["副詞", "接続詞", "連体詞", "代名詞", "感動詞", "助動詞", "助詞", "接頭辞"]);
const KANA_WORDS = new Set([
  "為る", "有る", "無い", "居る", "成る", "出来る", "呉れる", "遣る", "仕舞う", "貰う", "御座る", "致す", "下さる",
  "頂く", "見える", "良い", "宜しい", "居らっしゃる", "仰る", "御座います", "事", "物", "所", "為", "訳", "筈", "侭", "様", "達",
]);

const info = new Map(); // 正規化表記 → { pos, cost: Map(書き方 → 一番小さいコスト) }
const posOf = new Map(); // 正規化表記 → 品詞の大分類（名詞は固有名詞かどうかも見る）
// 品詞は、同じ語の見出しのうち一番よく使われるもの（正規化表記と同じ書き方の見出しで、コストが一番小さいもの）から決める。
// 「円」は普通名詞のほかに人名・地名の見出しもあるので、どれか 1 つを適当に選ぶと固有名詞になってしまう。
// コストはよく使われる語ほど小さい（負のこともある）。ちょうど 0 の見出しはコストが付いていない（core_lex.csv の全部と、small_lex.csv の記号など）ので比べられない。
// small_lex.csv にある語はそちらを優先し、コスト 0 の見出しは後回しにする
const posRank = new Map(); // 正規化表記 → 品詞を決めた見出しの [ファイルの順, 書き方が正規化表記と違うか, コスト]
const better = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
for (const [fileIndex, file] of ["data-src/small_lex.csv", "data-src/core_lex.csv"].entries()) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const c = line.split(",");
    if (c.length < 13) continue;
    const [surface, cost, pos1, conjType, conjForm, norm] = [c[4], Number(c[3]), c[5], c[9], c[10], c[12]];
    const rank = [fileIndex, surface === norm ? 0 : 1, cost !== 0 ? cost : Infinity];
    if (!posRank.has(norm) || better(rank, posRank.get(norm)) < 0) {
      posRank.set(norm, rank);
      posOf.set(norm, pos1 === "名詞" && c[6] === "固有名詞" ? "固有名詞" : pos1);
    }
    if (!(conjForm === "*" || conjForm === "終止形-一般") || conjType.startsWith("文語")) continue;
    let e = info.get(norm);
    if (!e) info.set(norm, (e = { pos: pos1, cost: new Map() }));
    // かなに戻すかどうかを決める品詞（表示の品詞の posOf とは別。こちらを変えると「当然→とうぜん」のように戻しすぎる）
    if (surface === norm) e.pos = pos1;
    if (!(e.cost.get(surface) <= cost)) e.cost.set(surface, cost);
  }
}
// 自動では変になるものの手直し。OVERRIDE は書き方を指定、KEEP は漢字のまま残す
// 形容詞などは自動にするとくだけた形（凄い→すげえ）が選ばれるので、よく出るものだけ手で指定する
const OVERRIDE = {
  事: "こと", 貴方: "あなた", 確り: "しっかり", 唯: "ただ", 矢張り: "やはり", 決して: "けっして", 彼奴: "あいつ", 偶: "たま",
  美味しい: "おいしい", 可成: "かなり", 奇麗: "きれい", 様々: "さまざま", 余り: "あまり", 目茶苦茶: "めちゃくちゃ", 目茶目茶: "めちゃめちゃ",
  目茶: "めちゃ", 流石: "さすが", 如何: "いかが", 可哀想: "かわいそう", 酷い: "ひどい", 有り難い: "ありがたい", 可笑しい: "おかしい",
  真面目: "まじめ", 真っ直ぐ: "まっすぐ", 生憎: "あいにく", 怠い: "だるい", 仕方無い: "仕方ない", さり気無い: "さりげない", 可愛い: "かわいい",
  御八つ: "おやつ", 御握り: "おにぎり", 御御籤: "おみくじ", 御負け: "おまけ", 御免: "ごめん", 御萩: "おはぎ", 御結び: "おむすび",
  御菓子: "お菓子", 御礼: "お礼", 御酒: "お酒",
};
const KEEP = new Set(["突然", "全然", "早速", "急遽", "断然", "依然", "到底", "所詮", "突如", "少し", "時", "様", "真", "相", "毎", "糞", "延々", "着々", "当分", "次々", "主な", "時折"]);
const isHira = (s) => /^[\p{Script=Hiragana}ー]+$/u.test(s);
const words = JSON.parse(fs.readFileSync("data-src/words.json", "utf8"));
const map = {};
for (const w of words) {
  const e = info.get(w);
  if (!e || !(KANA_POS.has(e.pos) || KANA_WORDS.has(w)) || isHira(w)) continue;
  let kana = null;
  let kanaCost = Infinity;
  for (const [sf, cost] of e.cost) if (isHira(sf) && cost < kanaCost) [kana, kanaCost] = [sf, cost];
  if (kana && kanaCost < (e.cost.get(w) ?? Infinity)) map[w] = kana;
}
// 「御」で始まる語（御飯、御茶）は、辞書に「お〜」「ご〜」の書き方があればそちらにする（両方あればコストの小さい方）。
// 辞書のコストは「ゴハン ＜ 御飯 ＜ ご飯」のように普段の使われ方と合わないことがあるので、「御〜」とは比べない
for (const w of words) {
  const e = info.get(w);
  if (!e || !w.startsWith("御") || w.length < 2 || map[w]) continue;
  let best = null;
  let bestCost = Infinity;
  for (const head of ["お", "ご"]) {
    const sf = head + w.slice(1);
    const cost = e.cost.get(sf);
    if (cost !== undefined && cost < bestCost) [best, bestCost] = [sf, cost];
  }
  if (best) map[w] = best;
}
for (const w of KEEP) delete map[w];
Object.assign(map, OVERRIDE);
fs.writeFileSync("data-src/surface.json", JSON.stringify(map));
fs.writeFileSync("data-src/pos.json", JSON.stringify(Object.fromEntries(words.map((w) => [w, posOf.get(w) ?? "その他"]))));
const changed = words.slice(0, 21060).filter((w) => map[w]);
console.log(`書き方が変わる単語: 全体 ${Object.keys(map).length} 語、よく使われる約 2 万語のうち ${changed.length} 語`);
console.log(changed.slice(0, 500).map((w) => `${w}→${map[w]}`).join(" "));
