import "server-only";
import fs from "node:fs";
import path from "node:path";
import { IvfPq } from "./ivfpq.ts";

export type Meta = {
  word: string[];
  display: string[];
  pos: number[];
  x: number[];
  y: number[];
  rank: number[];
  hidden: number[];
  /** 検索用の別名（読み、ひらがなを含む別の書き方）→ 語の番号 */
  alias: Record<string, number>;
};

/** neighbors.bin に入っている、語ごとの近い語の数（pipeline/neighbors.py の K） */
export const NEIGHBORS = 8;
/** 複合語を分けるときに試す、一番長い語の文字数 */
export const MAX_PART_LEN = 20;

const DIR = path.join(process.cwd(), "data");
const g = globalThis as { __goi?: Map<string, unknown> };
const cache = (g.__goi ??= new Map());

/** 最初に呼ばれたときに make で作り、以後は使い回す */
function once<T>(key: string, make: () => T): () => T {
  return () => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key) as T;
  };
}

/** 単語の情報（data/meta.json） */
export const getMeta = once("meta", () => JSON.parse(fs.readFileSync(path.join(DIR, "meta.json"), "utf8")) as Meta);

/** 隠す語（不適切な言葉）。検索結果に出さない */
export const getHiddenIds = once("hidden", () => new Set(getMeta().hidden.flatMap((h, id) => (h ? [id] : []))));

/** 書き方（正規化表記・普段の書き方のどちらでも）→ 語の番号。よく使われる方（番号の小さい方）を優先する */
export const getByText = once("byText", () => {
  const { word, display, hidden } = getMeta();
  const byText = new Map<string, number>();
  word.forEach((w, id) => {
    if (hidden[id]) return;
    if (!byText.has(w)) byText.set(w, id);
    if (!byText.has(display[id])) byText.set(display[id], id);
  });
  return byText;
});

/** 前もって計算した近い語（語ごとに NEIGHBORS 個、近い順）と、その近さ × 10000。番号（u32）の並びのあとに近さ（i16）の並び */
export const getNeighbors = once("neighbors", () => {
  const nb = fs.readFileSync(path.join(DIR, "neighbors.bin"));
  const count = getMeta().word.length * NEIGHBORS;
  return {
    ids: new Uint32Array(nb.buffer.slice(nb.byteOffset, nb.byteOffset + count * 4)),
    scores: new Int16Array(nb.buffer.slice(nb.byteOffset + count * 4, nb.byteOffset + count * 6)),
  };
});

/** 意味の近い語を探す索引（複合語の検索だけで使う） */
export const getIndex = once("index", () => new IvfPq(path.join(DIR, "index.bin")));

/**
 * データを全部読み込む（2 回目からは何もしない）。どの API でも最初に呼ぶ。
 * デプロイ先は、要求が重なるとサーバーを何台も立ち上げて振り分ける。ページを開いたときのタイルの要求で立ち上がったサーバーが
 * 索引を読んでいないと、そこに当たった最初の検索だけ索引の読み込み（本番で約 1 秒）を待つことになるので、どのサーバーも最初に全部読んでおく
 */
export function loadAll() {
  getHiddenIds();
  getByText();
  getNeighbors();
  getIndex();
}
