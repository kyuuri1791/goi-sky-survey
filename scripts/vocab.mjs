// 星にする語の選び方（配置・索引・タイルで共通）
import fs from "node:fs";

const NG = new Set(fs.readFileSync("data-src/ng-words.txt", "utf8").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#")));

/** 星にしない単語: 不適切な言葉、記号や数字だけのもの、ひらがな・カタカナ 1〜2 文字（助詞や助動詞が大半） */
export function skip(w) {
  if (NG.has(w)) return true;
  if (/^[\p{P}\p{S}\p{N}\s]+$/u.test(w) && !/\p{Extended_Pictographic}/u.test(w)) return true;
  if (/^[\p{Script=Hiragana}ー]{1,2}$/u.test(w)) return true;
  if (/^[\p{Script=Katakana}ー]$/u.test(w)) return true;
  if (/^[A-Za-z]$/.test(w)) return true;
  return false;
}

/** 星にする語の chiVe での番号（よく使われる順）。この並びの番号をアプリの中の語の番号にする */
export function keptIds(words) {
  const kept = [];
  for (let i = 0; i < words.length; i++) if (!skip(words[i])) kept.push(i);
  return kept;
}
