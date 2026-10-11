import "server-only";
import type { HomeView } from "@/shared/levels.ts";
import { getWords } from "./data.ts";
import { round5 } from "./words.ts";

/** 最初の範囲を決めるのに使う語の数（よく使われる方から）と、そのうち範囲に収める割合 */
const WORDS = 20000;
const COVER = 0.95;

/**
 * 最初に見せる範囲。平面は一番外れた語まで収まるように縮めてあるので、全体を見せると点が真ん中に小さく集まってしまう。
 * よく使われる語の中央を中心に、その 95% が入る範囲を縦横別々に求める（データを作り直しても自動で合う）
 */
export function homeView(): HomeView {
  const meta = getWords();
  const median = (a: number[]) => a.toSorted((p, q) => p - q)[Math.floor(a.length / 2)];
  const quantile = (a: number[]) => a.toSorted((p, q) => p - q)[Math.floor(COVER * (a.length - 1))];
  const xs = Array.from(meta.x.subarray(0, WORDS)), ys = Array.from(meta.y.subarray(0, WORDS));
  const x = median(xs), y = median(ys);
  return { x: round5(x), y: round5(y), rx: round5(quantile(xs.map((v) => Math.abs(v - x)))), ry: round5(quantile(ys.map((v) => Math.abs(v - y)))) };
}
