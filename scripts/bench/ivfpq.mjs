// IVF-PQ を作って、全部と比べた結果をどれだけ当てられるか（再現率）と速さ、メモリを測る
//   node scripts/bench/ivfpq.mjs [グループ数=1024] [PQ の区切り数=50]
//
// IVF: 単語をグループ（k 平均法の中心）に分け、検索では問い合わせに近い nprobe グループの中だけ見る
// PQ:  中心からのずれ（残差）を M 個の区切りに分け、区切りごとに 256 個の代表のどれに近いかの番号（1 バイト）で持つ
// 類似度 q·x ≈ q·中心 + Σ_m q_m·代表_m[番号_m]（区切りごとの表を引くだけで計算できる）
import { bruteKnn, DIM, load } from "../lib.mjs";

const NLIST = Number(process.argv[2] ?? 1024);
const M = Number(process.argv[3] ?? 50);
const SUB = DIM / M;
const KS = 256;
const SAMPLE = 40000;

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const { words, vecs, n } = load();
const t0 = performance.now();
const log = (s) => console.log(`[${((performance.now() - t0) / 1000).toFixed(0)}s] ${s}`);

/** k 平均法。data は dim 次元の点が count 個。中心 k 個を返す */
function kmeans(data, count, dim, k, iters, getOffset = (i) => i * dim) {
  const cent = new Float32Array(k * dim);
  for (let c = 0; c < k; c++) {
    const o = getOffset(Math.floor(rand() * count));
    for (let d = 0; d < dim; d++) cent[c * dim + d] = data[o + d];
  }
  const assign = new Int32Array(count);
  for (let it = 0; it < iters; it++) {
    const cn = new Float32Array(k);
    for (let c = 0; c < k; c++) {
      let s = 0;
      for (let d = 0; d < dim; d++) s += cent[c * dim + d] ** 2;
      cn[c] = s;
    }
    for (let i = 0; i < count; i++) {
      const o = getOffset(i);
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        let dt = 0;
        const co = c * dim;
        for (let d = 0; d < dim; d++) dt += data[o + d] * cent[co + d];
        const dist = cn[c] - 2 * dt;
        if (dist < bestD) {
          bestD = dist;
          best = c;
        }
      }
      assign[i] = best;
    }
    const sum = new Float64Array(k * dim);
    const cnt = new Int32Array(k);
    for (let i = 0; i < count; i++) {
      const o = getOffset(i);
      const c = assign[i];
      cnt[c]++;
      for (let d = 0; d < dim; d++) sum[c * dim + d] += data[o + d];
    }
    for (let c = 0; c < k; c++) {
      if (cnt[c] === 0) {
        const o = getOffset(Math.floor(rand() * count));
        for (let d = 0; d < dim; d++) cent[c * dim + d] = data[o + d];
      } else for (let d = 0; d < dim; d++) cent[c * dim + d] = sum[c * dim + d] / cnt[c];
    }
  }
  return cent;
}

// 1. グループの中心（標本で学習）
const sampleIdx = Array.from({ length: SAMPLE }, () => Math.floor(rand() * n));
const sample = new Float32Array(SAMPLE * DIM);
sampleIdx.forEach((i, j) => sample.set(vecs.subarray(i * DIM, (i + 1) * DIM), j * DIM));
const coarse = kmeans(sample, SAMPLE, DIM, NLIST, 8);
log(`グループの中心 ${NLIST} 個`);

// 2. 全単語をグループに振り分け、残差を求める
const list = new Int32Array(n);
const cn = new Float32Array(NLIST);
for (let c = 0; c < NLIST; c++) for (let d = 0; d < DIM; d++) cn[c] += coarse[c * DIM + d] ** 2;
const resid = new Float32Array(n * DIM);
for (let i = 0; i < n; i++) {
  const o = i * DIM;
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < NLIST; c++) {
    let dt = 0;
    for (let d = 0; d < DIM; d++) dt += vecs[o + d] * coarse[c * DIM + d];
    const dist = cn[c] - 2 * dt;
    if (dist < bestD) {
      bestD = dist;
      best = c;
    }
  }
  list[i] = best;
  for (let d = 0; d < DIM; d++) resid[o + d] = vecs[o + d] - coarse[best * DIM + d];
}
log("全単語を振り分け");

// 3. 区切りごとの代表（PQ の符号表）を学習して、全単語を番号にする
const books = [];
const codes = new Uint8Array(n * M);
for (let m = 0; m < M; m++) {
  const sub = new Float32Array(SAMPLE * SUB);
  sampleIdx.forEach((i, j) => {
    for (let d = 0; d < SUB; d++) sub[j * SUB + d] = resid[i * DIM + m * SUB + d];
  });
  const book = kmeans(sub, SAMPLE, SUB, KS, 10);
  books.push(book);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < KS; c++) {
      let dist = 0;
      for (let d = 0; d < SUB; d++) dist += (resid[i * DIM + m * SUB + d] - book[c * SUB + d]) ** 2;
      if (dist < bestD) {
        bestD = dist;
        best = c;
      }
    }
    codes[i * M + m] = best;
  }
}
log(`PQ ${M} 区切り × 256 代表（1 語 ${M} バイト）`);

// グループごとの単語の並び
const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => list[a] - list[b]);
const start = new Int32Array(NLIST + 1);
for (const i of order) start[list[i] + 1]++;
for (let c = 0; c < NLIST; c++) start[c + 1] += start[c];

/** IVF-PQ で q に近い上位 k 語 */
function search(q, k, nprobe, exclude) {
  // 近いグループを選ぶ（内積で）
  const cs = [];
  for (let c = 0; c < NLIST; c++) {
    let s = 0;
    for (let d = 0; d < DIM; d++) s += q[d] * coarse[c * DIM + d];
    cs.push([s, c]);
  }
  cs.sort((a, b) => b[0] - a[0]);
  // 区切りごとの表: q_m · 代表_m[c]
  const lut = new Float32Array(M * KS);
  for (let m = 0; m < M; m++) {
    const book = books[m];
    for (let c = 0; c < KS; c++) {
      let s = 0;
      for (let d = 0; d < SUB; d++) s += q[m * SUB + d] * book[c * SUB + d];
      lut[m * KS + c] = s;
    }
  }
  const top = [];
  let worst = -Infinity;
  for (let p = 0; p < nprobe; p++) {
    const [base, c] = cs[p];
    for (let j = start[c]; j < start[c + 1]; j++) {
      const i = order[j];
      if (i === exclude) continue;
      let s = base;
      const o = i * M;
      for (let m = 0; m < M; m++) s += lut[m * KS + codes[o + m]];
      if (top.length < k || s > worst) {
        top.push([s, i]);
        top.sort((a, b) => b[0] - a[0]);
        if (top.length > k) top.pop();
        worst = top[top.length - 1][0];
      }
    }
  }
  return top;
}

// 並べ直し用: 各数字を 1 バイト（−127〜127）に丸めたベクトル。単語ごとに最大の絶対値で割って丸める
const sq = new Int8Array(n * DIM);
const sqScale = new Float32Array(n);
for (let i = 0; i < n; i++) {
  let mx = 0;
  for (let d = 0; d < DIM; d++) mx = Math.max(mx, Math.abs(vecs[i * DIM + d]));
  sqScale[i] = mx / 127;
  for (let d = 0; d < DIM; d++) sq[i * DIM + d] = Math.round(vecs[i * DIM + d] / sqScale[i]);
}
/** IVF-PQ で rerank 件の候補を出し、丸めたベクトルで計算し直して上位 k 語 */
function searchRerank(q, k, nprobe, exclude, rerank) {
  const cand = search(q, rerank, nprobe, exclude);
  const scored = cand.map(([, i]) => {
    let s = 0;
    const o = i * DIM;
    for (let d = 0; d < DIM; d++) s += q[d] * sq[o + d];
    return [s * sqScale[i], i];
  });
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, k);
}

// 4. 評価: よく使われる 10 万語から 200 語を問い合わせにして、全部と比べた上位 10 語を何語当てるか
const queries = Array.from({ length: 200 }, () => Math.floor(rand() * Math.min(n, 100000)));
const truth = [];
let bruteMs = 0;
for (const qi of queries) {
  const q = vecs.subarray(qi * DIM, (qi + 1) * DIM);
  const t = performance.now();
  truth.push(new Set(bruteKnn(vecs, n, q, 10, qi).map(([, j]) => j)));
  bruteMs += performance.now() - t;
}
log(`全部と比べる: 1 回 ${(bruteMs / queries.length).toFixed(0)}ms`);
for (const nprobe of [8, 16, 32, 64]) {
  let hit = 0;
  let ms = 0;
  queries.forEach((qi, j) => {
    const q = vecs.subarray(qi * DIM, (qi + 1) * DIM);
    const t = performance.now();
    const res = search(q, 10, nprobe, qi);
    ms += performance.now() - t;
    for (const [, i] of res) if (truth[j].has(i)) hit++;
  });
  console.log(`  nprobe ${nprobe}: 再現率 ${((hit / (queries.length * 10)) * 100).toFixed(1)}%  1 回 ${(ms / queries.length).toFixed(1)}ms`);
}
for (const [nprobe, rerank] of [[16, 50], [32, 100], [64, 200]]) {
  let hit = 0;
  let ms = 0;
  queries.forEach((qi, j) => {
    const q = vecs.subarray(qi * DIM, (qi + 1) * DIM);
    const t = performance.now();
    const res = searchRerank(q, 10, nprobe, qi, rerank);
    ms += performance.now() - t;
    for (const [, i] of res) if (truth[j].has(i)) hit++;
  });
  console.log(`  並べ直し nprobe ${nprobe} 候補 ${rerank}: 再現率 ${((hit / (queries.length * 10)) * 100).toFixed(1)}%  1 回 ${(ms / queries.length).toFixed(1)}ms（+丸めたベクトル ${((n * DIM) / 1e6).toFixed(0)}MB）`);
}
const mem = n * M + NLIST * DIM * 4 + M * KS * SUB * 4 + n * 4;
console.log(`索引のメモリ: 約 ${(mem / 1e6).toFixed(1)}MB（元のベクトルは ${((n * DIM * 4) / 1e6).toFixed(0)}MB）`);
// 例
for (const w of ["ラーメン", "猫", "宇宙"]) {
  const i = words.indexOf(w);
  if (i < 0) continue;
  console.log(`  ${w}: ${search(vecs.subarray(i * DIM, (i + 1) * DIM), 8, 32, i).map(([, j]) => words[j]).join(" ")}`);
}
