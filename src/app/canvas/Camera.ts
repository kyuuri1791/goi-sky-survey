// 視点: 画面の真ん中に来る平面の位置と、拡大の大きさ。平面の座標と画面の座標の変換と、視点を動かすアニメーションも受け持つ
import type { HomeView } from "@/shared/levels.ts";
import type { Word } from "@/shared/types.ts";
import { MARK_FONT_SIZE } from "./style.ts";

/** 画面の真ん中に来る平面の位置 (x, y) と、平面の長さ 1 が画面の何 px か (s) */
export type View = { x: number; y: number; s: number };

export class Camera implements View {
  /** 画面の幅と高さ（CSS の px） */
  w = 0;
  h = 0;
  x = 0;
  y = 0;
  s = 1;
  /** 飛んでいる途中のアニメーション（時刻を渡すと、その時刻の位置へ進める）。null なら止まっている */
  private flight: ((now: number) => void) | null = null;

  /** home: 最初に見せる範囲（よく使われる語が集まっている所） */
  constructor(readonly home: HomeView) {}

  /** 拡大率 1 = 最初に見せる範囲（home）が画面に収まる大きさ。縦横それぞれ合わせて、小さい方にする */
  fitScale() {
    return Math.min((this.w * 0.46) / this.home.rx, (this.h * 0.46) / this.home.ry);
  }

  zoom() {
    return this.s / this.fitScale();
  }

  /** 最初の範囲を見る視点（全体の表示） */
  homeView(): View {
    return { x: this.home.x, y: this.home.y, s: this.fitScale() };
  }

  set(v: View) {
    [this.x, this.y, this.s] = [v.x, v.y, v.s];
  }

  toScreen(x: number, y: number): [number, number] {
    return [this.w / 2 + (x - this.x) * this.s, this.h / 2 + (y - this.y) * this.s];
  }

  toData(sx: number, sy: number): [number, number] {
    return [this.x + (sx - this.w / 2) / this.s, this.y + (sy - this.h / 2) / this.s];
  }

  /** 画面の座標が、画面の中か（点の大きさの分、少し外まで含める） */
  isOnScreen(sx: number, sy: number) {
    return sx >= -20 && sy >= -20 && sx <= this.w + 20 && sy <= this.h + 20;
  }

  /** 最初の範囲から外れているか。拡大しているか、中心から画面の 4 分の 1 以上ずれていたら外れているとみなす */
  isAway() {
    return this.zoom() > 1.25 || Math.abs(this.x - this.home.x) * this.s > this.w / 4 || Math.abs(this.y - this.home.y) * this.s > this.h / 4;
  }

  /**
   * 語を選んだときに見せる、画面のうち隠れていない範囲（中心と幅・高さ）。
   * PC では右のパネル（300px ほど）、左下の凡例の列（220px ほど）、下の検索欄（80px ほど）を、
   * スマホ（幅 640px 以下）では下の 4 割ほどのパネルを除く。withPanel が false なら（パネルを出さないとき）、パネルの分は除かない
   */
  freeArea(withPanel = true) {
    const { w: W, h: H } = this;
    if (W > 640) {
      const left = 220, right = W - (withPanel ? 300 : 24), top = 60, bottom = H - 80;
      return { cx: (left + right) / 2, cy: (top + bottom) / 2, w: right - left, h: bottom - top };
    }
    const top = 80, bottom = H - 74 - (withPanel ? H * 0.4 : 0);
    return { cx: W / 2, cy: (top + bottom) / 2, w: W, h: bottom - top };
  }

  /**
   * 語 w と近い語が、名前まで全部、隠れていない範囲に収まる視点。
   * 1. w を範囲の真ん中に置いたまま全部が収まる拡大率にする（全体の表示＝1 倍より引かない）
   * 2. その拡大率でもはみ出す語があれば、収まるところまで視点をずらす（w はそのときだけ真ん中からずれる）
   * 名前は点の右に出るので、名前の幅も入るようにする
   */
  focusView(w: Word, near: Word[], withPanel = true): View {
    const area = this.freeArea(withPanel), pad = 24;
    const L = area.cx - area.w / 2 + pad, R = area.cx + area.w / 2 - pad, T = area.cy - area.h / 2 + pad, B = area.cy + area.h / 2 - pad;
    // 名前の幅の見積もり（全角はほぼ 1 文字ぶんの幅）
    const label = (p: Word) => p.text.length * MARK_FONT_SIZE + 12;
    let s = this.fitScale() * 400;
    for (const n of near) {
      const dx = n.x - w.x, dy = n.y - w.y;
      if (dx > 0 && R - area.cx > label(n)) s = Math.min(s, (R - area.cx - label(n)) / dx);
      if (dx < 0) s = Math.min(s, (area.cx - L) / -dx);
      if (dy !== 0) s = Math.min(s, (dy > 0 ? B - area.cy : area.cy - T) / Math.abs(dy));
    }
    s = Math.max(this.fitScale(), s);
    // 範囲の真ん中に来る平面の位置 c の、全部が収まる幅を求め、その中で w に一番近いところを選ぶ
    const fitAxis = (v: (p: Word) => number, lo: number, hi: number, center: number, extra: (p: Word) => number) => {
      let cMin = -Infinity, cMax = Infinity;
      for (const p of [w, ...near]) {
        cMin = Math.max(cMin, v(p) - (hi - extra(p) - center) / s);
        cMax = Math.min(cMax, v(p) - (lo - center) / s);
      }
      return cMin <= cMax ? Math.min(cMax, Math.max(cMin, v(w))) : (cMin + cMax) / 2;
    };
    const cx = fitAxis((p) => p.x, L, R, area.cx, label);
    const cy = fitAxis((p) => p.y, T, B, area.cy, () => 0);
    return { x: cx + (this.w / 2 - area.cx) / s, y: cy + (this.h / 2 - area.cy) / s, s };
  }

  /** 視点 to へ ms かけて飛ぶ（遠くへは、いったん引いてから寄る） */
  flyTo(to: View, ms = 1400) {
    const from = { x: this.x, y: this.y, s: this.s };
    const t0 = performance.now();
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const midS = Math.min(from.s, to.s, (Math.min(this.w, this.h) * 0.5) / Math.max(dist, 0.01));
    this.flight = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
      const ls = p < 0.5 ? Math.log(from.s) + (Math.log(midS) - Math.log(from.s)) * (e * 2) : Math.log(midS) + (Math.log(to.s) - Math.log(midS)) * ((e - 0.5) * 2);
      this.set({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, s: Math.exp(ls) });
      if (p >= 1) this.flight = null;
    };
  }

  /** 飛んでいる途中なら止める（指やホイールで動かし始めたとき） */
  stop() {
    this.flight = null;
  }

  /** 飛んでいる途中なら、時刻 now の位置へ進める */
  update(now: number) {
    this.flight?.(now);
  }
}
