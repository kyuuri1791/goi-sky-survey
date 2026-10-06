// 測定で共通に使うもの
import fs from "node:fs";

export const DIM = 300;

export function load() {
  const words = JSON.parse(fs.readFileSync("data-src/words.json", "utf8"));
  const buf = fs.readFileSync("data-src/vectors.f32");
  const vecs = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return { words, vecs, n: words.length };
}

/** 内積（どちらも長さ 1 なので、cos 類似度） */
export function dot(a, ao, b, bo) {
  let s = 0;
  for (let d = 0; d < DIM; d++) s += a[ao + d] * b[bo + d];
  return s;
}

/** 全部と比べて、q に近い上位 k 語（自分自身は除く） */
export function bruteKnn(vecs, n, q, k, exclude = -1) {
  const top = []; // [類似度, 番号]
  let worst = -Infinity;
  for (let i = 0; i < n; i++) {
    if (i === exclude) continue;
    const s = dot(q, 0, vecs, i * DIM);
    if (top.length < k || s > worst) {
      top.push([s, i]);
      top.sort((a, b) => b[0] - a[0]);
      if (top.length > k) top.pop();
      worst = top[top.length - 1][0];
    }
  }
  return top;
}
