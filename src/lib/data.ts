import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

/** 複合語を分けるときに試す、一番長い語の文字数 */
export const MAX_PART_LEN = 20;

/** ベクトルのまとまりの語数と、1 語の次元数・バイト数(pipeline/vectors.py の CHUNK、DIM、STRIDE と合わせる) */
const CHUNK = 1024;
const DIM = 300;
const STRIDE = 304;
const PIECE = 8192;

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

/** ベクトルのファイル(GitHub の 1 ファイルの上限を超えないよう分けてある) */
const vectorFiles = () => once("vectorFiles", () => fs.readdirSync(DIR).filter((f) => /^vectors-\d+\.db$/.test(f)));

/**
 * データ(data/*.db。表の形は pipeline/store.py、pipeline/vectors.py)。words.db を開き、近い語とベクトルのファイルをつなぐ。
 * SQLite は使う部分だけファイルから読むので、全部(300MB ほど)をメモリに載せない
 */
function db(): DatabaseSync {
  return once("db", () => {
    const db = new DatabaseSync(path.join(DIR, "words.db"), { readOnly: true });
    db.prepare("attach ? as neighbors").run(path.join(DIR, "neighbors.db"));
    vectorFiles().forEach((f, i) => db.prepare(`attach ? as vectors${i}`).run(path.join(DIR, f)));
    return db;
  });
}

/** SQL を準備する(同じ SQL は使い回す) */
export function sql(text: string): StatementSync {
  return once(`sql:${text}`, () => db().prepare(text));
}

/**
 * 全部の語のベクトルを WebAssembly のメモリに並べ、内積を 16 バイトずつまとめて計算する関数(src/lib/dots.c を npm run wasm で
 * WebAssembly にしたもの)で比べる。メモリには先頭から、内積の結果(語数 × 4 バイト)、問い合わせ、ベクトル(語数 × STRIDE)を置く。
 * 検索のたびにファイルから読むと、読んだ分(120MB ほど)を毎回作っては捨てることになり、かえってメモリが膨らむので、最初に一度だけ読む
 */
function vectors() {
  return once("vectors", () => {
    const each = (cols: string) => vectorFiles().map((_, i) => `select ${cols} from vectors${i}.chunks`).join(" union all ");
    const { n } = sql(`select sum(len) / 4 as n from (${each("length(norms) as len")})`).get() as { n: number };
    const OUT = 0, Q = n * 4, VECS = Q + STRIDE;
    const memory = new WebAssembly.Memory({ initial: Math.ceil((VECS + n * STRIDE) / 65536) });
    const wasm = new WebAssembly.Module(fs.readFileSync(path.join(process.cwd(), "src/lib/dots.wasm")));
    const { dots } = new WebAssembly.Instance(wasm, { env: { memory } }).exports as { dots: (q: number, v: number, n: number, out: number) => void };
    const bytes = new Uint8Array(memory.buffer), norms = new Float32Array(n);
    // ベクトルは 8KB ずつ切り出して読む(まとまりごと読むと、node:sqlite が作る大きな一時的なバッファの分がメモリに残る)
    const piece = sql(vectorFiles().map((_, i) => `select substr(data, ?2, ?3) as d from vectors${i}.chunks where id = ?1`).join(" union all "));
    for (const r of sql(each("id, length(data) as len, norms")).all() as { id: number; len: number; norms: Uint8Array }[]) {
      for (let o = 0; o < r.len; o += PIECE) bytes.set((piece.get(r.id, o + 1, Math.min(PIECE, r.len - o)) as { d: Uint8Array }).d, VECS + r.id * CHUNK * STRIDE + o);
      norms.set(new Float32Array(r.norms.buffer.slice(r.norms.byteOffset, r.norms.byteOffset + r.norms.length)), r.id * CHUNK);
    }
    return { n, memory, dots, norms, OUT, Q, VECS };
  });
}

/** 語 id の、1 バイトに丸めたベクトル(語ごとに長さが違う) */
export function vectorOf(id: number): Int8Array {
  const { memory, VECS } = vectors();
  return new Int8Array(memory.buffer, VECS + id * STRIDE, DIM).slice();
}

/** 1 バイトに丸めた q と cos で比べて、近い順に上位 k 語(全部の語と比べる)。score は cos 類似度 */
export function nearestVectors(q: Int8Array, k: number): { id: number; score: number }[] {
  const { n, memory, dots, norms, OUT, Q, VECS } = vectors();
  const bytes = new Int8Array(memory.buffer);
  bytes.fill(0, Q, Q + STRIDE);
  bytes.set(q, Q);
  dots(Q, VECS, n, OUT);
  const out = new Int32Array(memory.buffer, OUT, n), qLen = Math.hypot(...q);
  const best: { id: number; score: number }[] = [];
  for (let id = 0; id < n; id++) {
    const score = out[id] / (qLen * norms[id]);
    if (!(best.length < k || score > best[best.length - 1].score)) continue;
    let j = best.length;
    while (j > 0 && best[j - 1].score < score) j--;
    best.splice(j, 0, { id, score });
    if (best.length > k) best.pop();
  }
  return best;
}
