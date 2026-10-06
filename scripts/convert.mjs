// chiVe のテキスト（word2vec 形式）を、長さ 1 にそろえた Float32 のバイナリと単語の一覧にする
//   node scripts/convert.mjs data-src/chive-1.3-mc90/chive-1.3-mc90.txt（npm run data:convert）
// 出力: data-src/vectors.f32（単語数 × 300 の Float32）、data-src/words.json（よく使われる順）
import fs from "node:fs";
import readline from "node:readline";

const src = process.argv[2];
const rl = readline.createInterface({ input: fs.createReadStream(src), crlfDelay: Infinity });
let n = 0;
let dim = 0;
let vecs = null;
const words = [];
let i = 0;
for await (const line of rl) {
  if (!vecs) {
    [n, dim] = line.trim().split(/\s+/).map(Number);
    vecs = new Float32Array(n * dim);
    continue;
  }
  const parts = line.trimEnd().split(" ");
  if (parts.length !== dim + 1) continue;
  words.push(parts[0]);
  let norm = 0;
  for (let d = 0; d < dim; d++) {
    const v = Number(parts[d + 1]);
    vecs[i * dim + d] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < dim; d++) vecs[i * dim + d] /= norm;
  i++;
  if (i % 50000 === 0) console.log(`  ${i}/${n}`);
}
fs.writeFileSync("data-src/vectors.f32", new Uint8Array(vecs.buffer, 0, i * dim * 4));
fs.writeFileSync("data-src/words.json", JSON.stringify(words));
console.log(`${i} 語 × ${dim} 次元 → vectors.f32 (${((i * dim * 4) / 1e6).toFixed(0)} MB)`);
