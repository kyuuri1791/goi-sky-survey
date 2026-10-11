import "server-only";
import fs from "node:fs";
import path from "node:path";
import { IvfPq } from "./ivfpq.ts";

/** neighbors.bin に入っている、語ごとの近い語の数（pipeline/neighbors.py の K） */
export const NEIGHBORS = 8;
/** 複合語を分けるときに試す、一番長い語の文字数 */
export const MAX_PART_LEN = 20;

const DIR = path.join(process.cwd(), "data");
const g = globalThis as { __goi?: Map<string, unknown> };
const cache = (g.__goi ??= new Map());

/**
 * API の応答に付けるキャッシュの指定。答えは誰が見ても同じなので、CDN に覚えさせてサーバーまで届く要求を減らす（CPU の使用量を抑える）。
 * ブラウザには残さない（max-age=0）。デプロイすると CDN のキャッシュは消えるので、データを作り直しても古い答えは残らない
 */
export const CDN_CACHE = { "Cache-Control": "public, max-age=0, s-maxage=31536000" };

/** 最初に呼ばれたときに make で作り、以後は使い回す */
function once<T>(key: string, make: () => T): () => T {
  return () => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key) as T;
  };
}

/** ファイルの中を、前から順に型付き配列として切り出していく（形式は pipeline/store.py） */
function reader(buf: Buffer, start: number) {
  let off = start;
  // 位置が 4 バイト単位にそろっていなくても読めるよう、その部分だけ複製する（どれも小さい）
  const take = (bytes: number) => {
    const b = buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + bytes);
    off += bytes;
    return b;
  };
  return {
    f32: (n: number) => new Float32Array(take(n * 4)),
    u32: (n: number) => new Uint32Array(take(n * 4)),
    u8: (n: number) => new Uint8Array(take(n)),
    /** 次の 4 バイト単位の位置まで進める */
    pad: () => void (off += (4 - (off % 4)) % 4),
    rest: () => buf.subarray(off),
  };
}

export type Words = {
  n: number;
  x: Float32Array;
  y: Float32Array;
  rank: Uint32Array;
  pos: Uint8Array;
  hidden: Uint8Array;
  /** 語 id の表示の書き方 */
  display: (id: number) => string;
};

/** 単語の情報（data/words.bin）。位置・頻度順位・品詞・表示の書き方 */
export const getWords = once("words", (): Words => {
  const buf = fs.readFileSync(path.join(DIR, "words.bin"));
  if (buf.toString("latin1", 0, 4) !== "GWD1") throw new Error("words.bin の形式が違います");
  const n = buf.readUInt32LE(4);
  const r = reader(buf, 20);
  const x = r.f32(n), y = r.f32(n), rank = r.u32(n), pos = r.u8(n), hidden = r.u8(n);
  r.pad();
  const offs = r.u32(n + 1);
  const blob = r.rest();
  return { n, x, y, rank, pos, hidden, display: (id) => blob.toString("utf8", offs[id], offs[id + 1]) };
});

/** 隠す語（不適切な言葉）。検索結果に出さない */
export const getHiddenIds = once("hidden", () => {
  const { hidden } = getWords();
  return new Set(Array.from(hidden.keys()).filter((id) => hidden[id]));
});

/**
 * 書き方 → 語の番号（data/lookup.bin を二分探索で引く）。alias は、読みや別の書き方で引けたとき true。
 * 書き方そのもの（正規化表記・普段の書き方）が同じなら、よく使われる語が入っている
 */
export const getLookup = once("lookup", () => {
  const buf = fs.readFileSync(path.join(DIR, "lookup.bin"));
  if (buf.toString("latin1", 0, 4) !== "GLK1") throw new Error("lookup.bin の形式が違います");
  const m = buf.readUInt32LE(4);
  const r = reader(buf, 8);
  const offs = r.u32(m + 1), ids = r.u32(m), kind = r.u8(m);
  r.pad();
  const blob = r.rest();
  return (text: string): { id: number; alias: boolean } | undefined => {
    const q = Buffer.from(text);
    let lo = 0, hi = m - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = q.compare(blob, offs[mid], offs[mid + 1]);
      if (c === 0) return { id: ids[mid], alias: kind[mid] === 1 };
      if (c < 0) hi = mid - 1;
      else lo = mid + 1;
    }
    return undefined;
  };
});

/** 前もって計算した近い語（語ごとに NEIGHBORS 個、近い順）と、その近さ × 10000。番号（u32）の並びのあとに近さ（i16）の並び */
export const getNeighbors = once("neighbors", () => {
  const nb = fs.readFileSync(path.join(DIR, "neighbors.bin"));
  const count = getWords().n * NEIGHBORS;
  return {
    ids: new Uint32Array(nb.buffer.slice(nb.byteOffset, nb.byteOffset + count * 4)),
    scores: new Int16Array(nb.buffer.slice(nb.byteOffset + count * 4, nb.byteOffset + count * 6)),
  };
});

/** 使われ方の近い語を探す索引（複合語の検索だけで使う）。候補を大まかに絞る */
export const getIndex = once("index", () => new IvfPq(path.join(DIR, "index.bin")));

export type Vectors = {
  dim: number;
  /** 語 id のベクトル（1 バイトに丸めたものを戻す。長さはほぼ 1） */
  vector: (id: number) => Float32Array;
  /** 語 id のベクトルと q の内積 */
  dot: (id: number, q: Float32Array) => number;
};

/**
 * 1 バイトに丸めた全部の語のベクトル（data/vectors-*.bin。語ごとに倍率 f32 ＋ i8 × 300）。複合語の検索で、
 * 分けた語のベクトルを足すときと、索引で絞った候補の近さを計算し直すときに使う。
 * 120MB ほどあるので、裏で読み込み、最初の要求を待たせない
 */
export const getVectors = once("vectors", async (): Promise<Vectors> => {
  const files = (await fs.promises.readdir(DIR)).filter((f) => /^vectors-\d+\.bin$/.test(f)).sort((a, b) => parseInt(a.slice(8)) - parseInt(b.slice(8)));
  const bufs = await Promise.all(files.map((f) => fs.promises.readFile(path.join(DIR, f))));
  const dim = getIndex().dim, row = 4 + dim;
  const perFile = bufs[0].length / row;
  const views = bufs.map((b) => ({ data: new DataView(b.buffer, b.byteOffset, b.length), i8: new Int8Array(b.buffer, b.byteOffset, b.length) }));
  const at = (id: number) => {
    const f = Math.floor(id / perFile);
    return { ...views[f], o: (id - f * perFile) * row };
  };
  return {
    dim,
    vector(id) {
      const { data, i8, o } = at(id);
      const s = data.getFloat32(o, true), v = new Float32Array(dim);
      for (let d = 0; d < dim; d++) v[d] = i8[o + 4 + d] * s;
      return v;
    },
    dot(id, q) {
      const { data, i8, o } = at(id);
      let t = 0;
      for (let d = 0; d < dim; d++) t += q[d] * i8[o + 4 + d];
      return t * data.getFloat32(o, true);
    },
  };
});

/**
 * データを全部読み込む（2 回目からは何もしない）。どの API でも最初に呼ぶ。
 * デプロイ先は、要求が重なるとサーバーを何台も立ち上げて振り分ける。どのサーバーでも最初の検索が待たされないよう、
 * 最初の要求で全部読んでおく（ベクトルだけは大きいので、裏で読み始める）
 */
export function loadAll() {
  getHiddenIds();
  getLookup();
  getNeighbors();
  getIndex();
  // 読めなかったら、次に呼ばれたときに読み直す
  getVectors().catch(() => cache.delete("vectors"));
}
