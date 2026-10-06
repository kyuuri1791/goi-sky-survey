// 全部の単語を 2 次元に並べる。
//   1. よく使われる ANCHORS 語（星にしない語を除く）を UMAP で並べる
//   2. 残りの語は、意味の近い並べ済みの語 K 語を探し、その位置の重み付き平均に少しのずれを足して置く
//      （近い語は、並べ済みの語をグループ分けした簡易な索引で探す）
//   node --max-old-space-size=8000 scripts/layout-all.mjs [並べ済みにする語数=50000] [残りを置く上限=全部]
// 出力: data-src/layout.json（単語の番号 = chiVe の順位、x、y）
import fs from "node:fs";
import { UMAP } from "umap-js";
import { DIM, load } from "./lib.mjs";
import { keptIds } from "./vocab.mjs";

const ANCHORS = Number(process.argv[2] ?? 50000);
const LIMIT = Number(process.argv[3] ?? Infinity);
const K = 10;
const NLIST = 256;
const NPROBE = 12;
/** 一番近い語からこの距離以内の近い語だけで位置を決める（平面の座標は全体で −1〜1） */
const GROUP_R = 0.03;
const MIN_JITTER = 0.0015;

const t0 = performance.now();
const log = (s) => console.log(`[${((performance.now() - t0) / 1000).toFixed(0)}s] ${s}`);
let seed = 11;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const { words, vecs } = load();
const kept = keptIds(words);
const anchors = kept.slice(0, ANCHORS);
const rest = kept.slice(ANCHORS, ANCHORS + Math.min(LIMIT, kept.length));
log(`星にする語 ${kept.length}（並べ済み ${anchors.length}、残り ${rest.length}）`);

// --- 1. UMAP（REUSE=1 なら前回の data-src/layout.json の並べ済みの位置をそのまま使う） ---
let AX, AY;
if (process.env.REUSE) {
  const prev = JSON.parse(fs.readFileSync("data-src/layout.json", "utf8"));
  if (prev.anchors !== anchors.length || prev.ids.slice(0, anchors.length).some((id, j) => id !== anchors[j])) throw new Error("前回の並べ済みの語と一致しません");
  AX = Float32Array.from(prev.x.slice(0, anchors.length));
  AY = Float32Array.from(prev.y.slice(0, anchors.length));
  log("UMAP は前回の結果を使う");
} else {
  const umap = new UMAP({ nComponents: 2, nNeighbors: 20, minDist: 0.3, spread: 1.5, random: rand });
  const nEpochs = umap.initializeFit(anchors.map((i) => Array.from(vecs.subarray(i * DIM, (i + 1) * DIM))));
  for (let e = 0; e < nEpochs; e++) {
    umap.step();
    if (e % 50 === 0) log(`UMAP ${e}/${nEpochs}`);
  }
  const emb = umap.getEmbedding();
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (const [x, y] of emb) {
    mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y);
  }
  const sc = 2 / Math.max(mxx - mnx, mxy - mny), cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
  AX = Float32Array.from(emb, ([x]) => (x - cx) * sc);
  AY = Float32Array.from(emb, ([, y]) => (y - cy) * sc);
  log("UMAP 完了");
}

// --- 2. 並べ済みの語の簡易な索引: k 平均法でグループに分ける ---
const A = new Float32Array(anchors.length * DIM);
anchors.forEach((i, j) => A.set(vecs.subarray(i * DIM, (i + 1) * DIM), j * DIM));
const cent = new Float32Array(NLIST * DIM);
for (let c = 0; c < NLIST; c++) {
  const j = Math.floor(rand() * anchors.length);
  cent.set(A.subarray(j * DIM, (j + 1) * DIM), c * DIM);
}
const assign = new Int32Array(anchors.length);
for (let it = 0; it < 8; it++) {
  for (let j = 0; j < anchors.length; j++) {
    let best = 0, bs = -Infinity;
    for (let c = 0; c < NLIST; c++) {
      let s = 0;
      for (let d = 0; d < DIM; d++) s += A[j * DIM + d] * cent[c * DIM + d];
      if (s > bs) { bs = s; best = c; }
    }
    assign[j] = best;
  }
  const sum = new Float64Array(NLIST * DIM), cnt = new Int32Array(NLIST);
  for (let j = 0; j < anchors.length; j++) {
    cnt[assign[j]]++;
    for (let d = 0; d < DIM; d++) sum[assign[j] * DIM + d] += A[j * DIM + d];
  }
  for (let c = 0; c < NLIST; c++) {
    let norm = 0;
    for (let d = 0; d < DIM; d++) norm += sum[c * DIM + d] ** 2;
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < DIM; d++) cent[c * DIM + d] = sum[c * DIM + d] / norm; // 向きだけ使う（内積で比べる）
  }
}
const lists = Array.from({ length: NLIST }, () => []);
assign.forEach((c, j) => lists[c].push(j));
log("並べ済みの語をグループ分け");

// --- 3. 残りの語を置く ---
const RX = new Float32Array(rest.length), RY = new Float32Array(rest.length);
const cs = new Float32Array(NLIST);
const order = Array.from({ length: NLIST }, (_, c) => c);
for (let r = 0; r < rest.length; r++) {
  const o = rest[r] * DIM;
  for (let c = 0; c < NLIST; c++) {
    let s = 0;
    for (let d = 0; d < DIM; d++) s += vecs[o + d] * cent[c * DIM + d];
    cs[c] = s;
  }
  order.sort((a, b) => cs[b] - cs[a]);
  const top = []; // [類似度, 並べ済みの番号]
  for (let p = 0; p < NPROBE; p++) {
    for (const j of lists[order[p]]) {
      let s = 0;
      for (let d = 0; d < DIM; d++) s += vecs[o + d] * A[j * DIM + d];
      if (top.length < K || s > top[top.length - 1][0]) {
        top.push([s, j]);
        top.sort((a, b) => b[0] - a[0]);
        if (top.length > K) top.pop();
      }
    }
  }
  // 近い語が平面のあちこちに散らばっていると、平均がどれとも関係ない中間に落ちる。
  // そこで一番近い語の周り（GROUP_R 以内）にいる近い語だけを使い、近いほど重く（類似度の 4 乗）平均する。
  // ずれは使った語の散らばりの 3 割（最低でも MIN_JITTER）
  const [, j0] = top[0];
  let wx = 0, wy = 0, ws = 0;
  const used = [];
  for (const [s, j] of top) {
    if (Math.hypot(AX[j] - AX[j0], AY[j] - AY[j0]) > GROUP_R) continue;
    const w = Math.max(s, 0.01) ** 4;
    wx += AX[j] * w; wy += AY[j] * w; ws += w;
    used.push(j);
  }
  const mx = wx / ws, my = wy / ws;
  let spread = 0;
  for (const j of used) spread += Math.hypot(AX[j] - mx, AY[j] - my);
  spread = Math.max(MIN_JITTER, (spread / used.length) * 0.3);
  RX[r] = mx + gauss() * spread;
  RY[r] = my + gauss() * spread;
  if (r % 20000 === 0) log(`残りを置く ${r}/${rest.length}`);
}
log("残りを置き終わり");

const ids = [...anchors, ...rest];
const x = [...AX, ...RX].map((v) => +v.toFixed(5));
const y = [...AY, ...RY].map((v) => +v.toFixed(5));
fs.writeFileSync("data-src/layout.json", JSON.stringify({ ids, x, y, anchors: anchors.length }));
log(`data-src/layout.json に ${ids.length} 語`);
