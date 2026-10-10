import "server-only";
import type { HomeView } from "./levels.ts";
import { getWords } from "./server-data.ts";

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
  // 位置は f32 なので、ページに入れる値は小数 5 桁に丸める
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  return { x: r(x), y: r(y), rx: r(quantile(xs.map((v) => Math.abs(v - x)))), ry: r(quantile(ys.map((v) => Math.abs(v - y)))) };
}
