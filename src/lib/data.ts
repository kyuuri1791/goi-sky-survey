import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

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
    db.loadExtension(path.join(process.cwd(), "vendor/sqlite-vec/vec0.so"));
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

/** 1 バイトに丸めた q と cos で比べて、近い順に上位 k 語(sqlite-vec で全部の語と比べる)。score は cos 類似度 */
export function nearestVectors(q: Int8Array, k: number): { id: number; score: number }[] {
  const rows = sql(`${eachVectors((t) => `select rowid as id, distance from ${t} where embedding match vec_int8(?1) and k = ?2`)} order by distance limit ?2`).all(
    new Uint8Array(q.buffer, q.byteOffset, q.length),
    k,
  ) as { id: number; distance: number }[];
  return rows.map(({ id, distance }) => ({ id, score: 1 - distance }));
}
