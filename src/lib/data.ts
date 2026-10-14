import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

/** 複合語を分けるときに試す、一番長い語の文字数 */
export const MAX_PART_LEN = 20;

/** 1 語の次元数・バイト数(pipeline/vectors.py の DIM、STRIDE と合わせる)と、検索のときに一度に読む語数 */
const DIM = 300;
const STRIDE = 304;
const CHUNK = 1024;

const DIR = path.join(process.cwd(), "data");
const g = globalThis as { __goi?: Map<string, unknown> };
const cache = (g.__goi ??= new Map());

/**
 * API の応答に付けるキャッシュの指定。答えは誰が見ても同じなので、CDN に覚えさせてサーバーまで届く要求を減らす(CPU の使用量を抑える)。
 * ブラウザには残さない(max-age=0)。デプロイすると CDN のキャッシュは消えるので、データを作り直しても古い答えは残らない
 */
export const CDN_CACHE = { "Cache-Control": "public, max-age=0, s-maxage=31536000" };

/** 最初に呼ばれたときに make で作り、以後は使い回す */
function once<T>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}


/**
 * データ(data/*.db。表の形は pipeline/store.py)。words.db を開き、近い語のファイルをつなぐ。
 * SQLite は使う部分だけファイルから読むので、全部をメモリに載せない
 */
function db(): DatabaseSync {
  return once("db", () => {
    const db = new DatabaseSync(path.join(DIR, "words.db"), { readOnly: true });
    db.prepare("attach ? as neighbors").run(path.join(DIR, "neighbors.db"));
    return db;
  });
}

/** SQL を準備する(同じ SQL は使い回す) */
export function sql(text: string): StatementSync {
  return once(`sql:${text}`, () => db().prepare(text));
}

/**
 * ベクトルのファイル(data/vectors-*.bin。形は pipeline/vectors.py)と、内積を 16 バイトずつまとめて計算する関数
 * (src/lib/dots.c を npm run wasm で WebAssembly にしたもの)。ベクトルはメモリに載せず、検索のたびに CHUNK 語ずつ WebAssembly のメモリへ直接読む
 * (読んだファイルは OS が覚えておくので速く、プロセスのメモリは増えない)。メモリには先頭から、問い合わせ、内積、長さの 2 乗、読んだベクトルを置く
 */
function vectors() {
  return once("vectors", () => {
    const files = fs.readdirSync(DIR).filter((f) => /^vectors-\d+\.bin$/.test(f)).sort();
    let first = 0;
    const parts = files.map((f) => {
      const file = path.join(DIR, f), count = fs.statSync(file).size / STRIDE;
      const part = { fd: fs.openSync(file, "r"), first, count };
      first += count;
      return part;
    });
    const Q = 0, OUT = STRIDE, SQ = OUT + CHUNK * 4, VECS = SQ + CHUNK * 4;
    const memory = new WebAssembly.Memory({ initial: Math.ceil((VECS + CHUNK * STRIDE) / 65536) });
    const wasm = new WebAssembly.Module(fs.readFileSync(path.join(process.cwd(), "src/lib/dots.wasm")));
    const { dots } = new WebAssembly.Instance(wasm, { env: { memory } }).exports as { dots: (q: number, v: number, n: number, out: number, sq: number) => void };
    return { parts, memory, dots, Q, OUT, SQ, VECS };
  });
}

/** 語 id の、1 バイトに丸めたベクトル(語ごとに長さが違う) */
export function vectorOf(id: number): Int8Array {
  const { fd, first } = vectors().parts.find((p) => id < p.first + p.count)!;
  const v = new Int8Array(DIM);
  fs.readSync(fd, v, 0, DIM, (id - first) * STRIDE);
  return v;
}

/** 1 バイトに丸めた q と cos で比べて、近い順に上位 k 語(全部の語と比べる)。score は cos 類似度 */
export function nearestVectors(q: Int8Array, k: number): { id: number; score: number }[] {
  const { parts, memory, dots, Q, OUT, SQ, VECS } = vectors();
  const query = new Int8Array(memory.buffer, Q, STRIDE);
  query.fill(0);
  query.set(q);
  const chunk = new Uint8Array(memory.buffer, VECS, CHUNK * STRIDE), out = new Int32Array(memory.buffer, OUT, CHUNK), sq = new Int32Array(memory.buffer, SQ, CHUNK);
  const qLen = Math.hypot(...q);
  const best: { id: number; score: number }[] = [];
  for (const { fd, first, count } of parts) {
    for (let start = 0; start < count; start += CHUNK) {
      const n = Math.min(CHUNK, count - start);
      fs.readSync(fd, chunk, 0, n * STRIDE, start * STRIDE);
      dots(Q, VECS, n, OUT, SQ);
      for (let i = 0; i < n; i++) {
        const id = first + start + i, score = out[i] / (qLen * Math.sqrt(sq[i]));
        if (!(best.length < k || score > best[best.length - 1].score)) continue;
        let j = best.length;
        while (j > 0 && best[j - 1].score < score) j--;
        best.splice(j, 0, { id, score });
        if (best.length > k) best.pop();
      }
    }
  }
  return best;
}
