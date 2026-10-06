// 全部と比べる素直な方法の速さとメモリ
//   node scripts/bench/brute.mjs
import { bruteKnn, DIM, load } from "../lib.mjs";

const t0 = performance.now();
const { words, vecs, n } = load();
console.log(`読み込み ${(performance.now() - t0).toFixed(0)}ms、${n} 語、ベクトル ${((n * DIM * 4) / 1e6).toFixed(0)}MB、RSS ${(process.memoryUsage().rss / 1e6).toFixed(0)}MB`);
const id = (w) => words.indexOf(w);
for (const w of ["ラーメン", "猫", "宇宙", "東京", "嬉しい", "走る"]) {
  const i = id(w);
  if (i < 0) {
    console.log(w, "なし");
    continue;
  }
  const q = vecs.subarray(i * DIM, (i + 1) * DIM);
  const t = performance.now();
  const top = bruteKnn(vecs, n, q, 10, i);
  console.log(`${w}（${i}位）: ${(performance.now() - t).toFixed(0)}ms → ${top.map(([s, j]) => `${words[j]}(${s.toFixed(2)})`).join(" ")}`);
}
