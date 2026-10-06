// 足し算・近い語の検索に使う IVF-PQ の索引を作る（scripts/bench/ivfpq.mjs の測定で決めたやり方）
//   node --max-old-space-size=10000 scripts/build-index.mjs
// 出力:
//   data/index.bin    IVF-PQ（形式は src/lib/ivfpq.ts を参照）
//   data/rerank-0.bin, rerank-1.bin  並べ直し用: 語ごとに倍率（f32）＋ 1 バイトに丸めたベクトル（i8 × 300）。
//                     候補の分だけファイルから読む。GitHub の 1 ファイル 100MB の上限より小さくなるよう、前半と後半に分ける
import fs from "node:fs";
import { DIM, load } from "./lib.mjs";
import { keptIds } from "./vocab.mjs";

const NLIST = 1024;
const M = 50;
const SUB = DIM / M;
const KS = 256;
const SAMPLE = 40000;
const MAGIC = 0x31515649; // "IVQ1"
const RERANK_FILES = 2;

const t0 = performance.now();
const log = (s) => console.log(`[${((performance.now() - t0) / 1000).toFixed(0)}s] ${s}`);
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const { words, vecs: all } = load();
const kept = keptIds(words);
const n = kept.length;
const vecs = new Float32Array(n * DIM);
kept.forEach((i, j) => vecs.set(all.subarray(i * DIM, (i + 1) * DIM), j * DIM));
log(`${n} 語`);

function kmeans(get, count, dim, k, iters) {
  const cent = new Float32Array(k * dim);
  for (let c = 0; c < k; c++) cent.set(get(Math.floor(rand() * count)), c * dim);
  const assign = new Int32Array(count);
  for (let it = 0; it < iters; it++) {
    const cn = new Float32Array(k);
    for (let c = 0; c < k; c++) for (let d = 0; d < dim; d++) cn[c] += cent[c * dim + d] ** 2;
    for (let i = 0; i < count; i++) {
      const v = get(i);
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        let t = 0;
        for (let d = 0; d < dim; d++) t += v[d] * cent[c * dim + d];
        const dist = cn[c] - 2 * t;
        if (dist < bd) { bd = dist; best = c; }
      }
      assign[i] = best;
    }
    const sum = new Float64Array(k * dim), cnt = new Int32Array(k);
    for (let i = 0; i < count; i++) {
      const v = get(i);
      cnt[assign[i]]++;
      for (let d = 0; d < dim; d++) sum[assign[i] * dim + d] += v[d];
    }
    for (let c = 0; c < k; c++) {
      if (!cnt[c]) cent.set(get(Math.floor(rand() * count)), c * dim);
      else for (let d = 0; d < dim; d++) cent[c * dim + d] = sum[c * dim + d] / cnt[c];
    }
  }
  return cent;
}
const nearestCentroid = (v, cent, k, dim, cn) => {
  let best = 0, bd = Infinity;
  for (let c = 0; c < k; c++) {
    let t = 0;
    for (let d = 0; d < dim; d++) t += v[d] * cent[c * dim + d];
    const dist = cn[c] - 2 * t;
    if (dist < bd) { bd = dist; best = c; }
  }
  return best;
};

// 1. グループの中心
const sampleIdx = Array.from({ length: SAMPLE }, () => Math.floor(rand() * n));
const coarse = kmeans((i) => vecs.subarray(sampleIdx[i] * DIM, (sampleIdx[i] + 1) * DIM), SAMPLE, DIM, NLIST, 8);
const ccn = new Float32Array(NLIST);
for (let c = 0; c < NLIST; c++) for (let d = 0; d < DIM; d++) ccn[c] += coarse[c * DIM + d] ** 2;
log("グループの中心");

// 2. 振り分けと残差
const list = new Int32Array(n);
const resid = new Float32Array(n * DIM);
for (let i = 0; i < n; i++) {
  const v = vecs.subarray(i * DIM, (i + 1) * DIM);
  const c = nearestCentroid(v, coarse, NLIST, DIM, ccn);
  list[i] = c;
  for (let d = 0; d < DIM; d++) resid[i * DIM + d] = v[d] - coarse[c * DIM + d];
}
log("振り分け");

// 3. PQ
const books = new Float32Array(M * KS * SUB);
const codes = new Uint8Array(n * M);
for (let m = 0; m < M; m++) {
  const getSub = (i) => resid.subarray(i * DIM + m * SUB, i * DIM + (m + 1) * SUB);
  const book = kmeans((i) => getSub(sampleIdx[i]), SAMPLE, SUB, KS, 10);
  books.set(book, m * KS * SUB);
  const bcn = new Float32Array(KS);
  for (let c = 0; c < KS; c++) for (let d = 0; d < SUB; d++) bcn[c] += book[c * SUB + d] ** 2;
  for (let i = 0; i < n; i++) codes[i * M + m] = nearestCentroid(getSub(i), book, KS, SUB, bcn);
}
log("PQ");

// グループごとに並べる
const order = Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => list[a] - list[b]);
const start = new Uint32Array(NLIST + 1);
for (const i of order) start[list[i] + 1]++;
for (let c = 0; c < NLIST; c++) start[c + 1] += start[c];
const sortedCodes = new Uint8Array(n * M);
order.forEach((i, j) => sortedCodes.set(codes.subarray(i * M, (i + 1) * M), j * M));

// 書き出し: ヘッダー（u32 × 8）→ 中心 → 符号表 → start → order → codes
const header = new Uint32Array([MAGIC, n, DIM, NLIST, M, KS, 0, 0]);
const fd = fs.openSync("data/index.bin", "w");
for (const arr of [header, coarse, books, start, order, sortedCodes]) fs.writeSync(fd, new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
fs.closeSync(fd);
log(`data/index.bin ${(fs.statSync("data/index.bin").size / 1e6).toFixed(1)}MB`);

// 並べ直し用（語ごとに 4 + 300 バイト）
const rr = Buffer.alloc(n * (4 + DIM));
for (let i = 0; i < n; i++) {
  let mx = 0;
  for (let d = 0; d < DIM; d++) mx = Math.max(mx, Math.abs(vecs[i * DIM + d]));
  const s = mx / 127 || 1;
  rr.writeFloatLE(s, i * (4 + DIM));
  for (let d = 0; d < DIM; d++) rr.writeInt8(Math.round(vecs[i * DIM + d] / s), i * (4 + DIM) + 4 + d);
}
const per = Math.ceil(n / RERANK_FILES);
for (let f = 0; f < RERANK_FILES; f++) {
  const part = rr.subarray(f * per * (4 + DIM), Math.min(n, (f + 1) * per) * (4 + DIM));
  fs.writeFileSync(`data/rerank-${f}.bin`, part);
  log(`data/rerank-${f}.bin ${(part.length / 1e6).toFixed(0)}MB`);
}
