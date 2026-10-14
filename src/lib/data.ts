import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { getLoadablePath } from "sqlite-vec";

/** 複合語を分けるときに試す、一番長い語の文字数 */
export const MAX_PART_LEN = 20;

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
    const db = new DatabaseSync(path.join(DIR, "words.db"), { readOnly: true, allowExtension: true });
    db.loadExtension(getLoadablePath());
    db.prepare("attach ? as neighbors").run(path.join(DIR, "neighbors.db"));
    vectorFiles().forEach((f, i) => db.prepare(`attach ? as vectors${i}`).run(path.join(DIR, f)));
    return db;
  });
}

/** SQL を準備する(同じ SQL は使い回す) */
export function sql(text: string): StatementSync {
  return once(`sql:${text}`, () => db().prepare(text));
}

/** ベクトルの表ごとに SQL を作り、union all でつなぐ */
const eachVectors = (make: (table: string) => string) => vectorFiles().map((_, i) => make(`vectors${i}.vectors`)).join(" union all ");

/** 語 id の、1 バイトに丸めたベクトル(語ごとに長さが違う) */
export function vectorOf(id: number): Int8Array {
  const { embedding } = sql(eachVectors((t) => `select embedding from ${t} where rowid = ?1`)).get(id) as { embedding: Uint8Array };
  return new Int8Array(embedding.buffer, embedding.byteOffset, embedding.length);
}

/** 符号のビット列の 1 語のバイト数(pipeline/vectors.py の SIGN_BYTES と合わせる) */
const SIGN_BYTES = 40;
/** 複合語の検索で、符号で大まかに比べて残す候補の語数(pipeline/bench.py の CANDIDATES と合わせる) */
const CANDIDATES = 1000;

/** 全部の語の符号のビット列(vectors-*.db の signs。15MB ほど)と、ファイルごとの最後の語の番号。signs の 1 行には、id の語から続く何語分かが入っている */
function signs() {
  return once("signs", () => {
    const { n } = sql("select count(*) as n from words").get() as { n: number };
    const bits = new Uint8Array(n * SIGN_BYTES);
    const last = vectorFiles().map((_, i) => {
      let end = -1;
      for (const r of sql(`select id, bits from vectors${i}.signs`).iterate() as Iterable<{ id: number; bits: Uint8Array }>) {
        bits.set(r.bits, r.id * SIGN_BYTES);
        end = r.id + r.bits.length / SIGN_BYTES - 1;
      }
      return end;
    });
    return { n, bits, last };
  });
}

/**
 * 1 バイトに丸めた q と cos で比べて、近い順に上位 k 語。score は cos 類似度。
 * 全部の語を、語の符号(各次元が正か)と q の内積で大まかに比べて CANDIDATES 語に絞り、候補だけ元のベクトルの cos で並べ直す
 * (全部の語と cos で比べるより 4 倍ほど速く、上位の語は 99% 以上同じになる。pipeline/bench.py で測る)
 */
export function nearestVectors(q: Int8Array, k: number): { id: number; score: number }[] {
  const { n, bits, last } = signs();
  // 符号と q の内積 = 符号が正の次元の q の和。8 次元(1 バイト)ずつ、そのビットの並びに対する q の和の表を作って引く
  const lut = new Int32Array(SIGN_BYTES * 256);
  for (let j = 0; j < SIGN_BYTES; j++) {
    for (let b = 1; b < 256; b++) {
      const d = j * 8 + 31 - Math.clz32(b & -b);
      lut[j * 256 + b] = lut[j * 256 + (b & (b - 1))] + (d < q.length ? q[d] : 0);
    }
  }
  const rough = new Int32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += SIGN_BYTES) {
    let s = 0;
    for (let j = 0; j < SIGN_BYTES; j++) s += lut[(j << 8) | bits[o + j]];
    rough[i] = s;
  }
  // 大まかな値の大きい方から CANDIDATES 語を選ぶ(値は ±127 × 300 に収まるので、数を数えて境目を決める)
  const MAX = 127 * q.length;
  const count = new Int32Array(2 * MAX + 1);
  for (const s of rough) count[s + MAX]++;
  let cut = 2 * MAX;
  for (let taken = 0; cut > 0 && taken + count[cut] < CANDIDATES; cut--) taken += count[cut];
  const qLen = Math.hypot(...q);
  const scored: { id: number; score: number }[] = [];
  for (let id = 0; id < n; id++) {
    if (rough[id] + MAX < cut) continue;
    const file = last.findIndex((end) => id <= end);
    const { embedding: e } = sql(`select embedding from vectors${file}.vectors where rowid = ?`).get(id) as { embedding: Uint8Array };
    const v = new Int8Array(e.buffer, e.byteOffset, e.length);
    let dot = 0, len = 0;
    for (let d = 0; d < v.length; d++) {
      dot += q[d] * v[d];
      len += v[d] * v[d];
    }
    scored.push({ id, score: dot / (qLen * Math.sqrt(len)) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}
