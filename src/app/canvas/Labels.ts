// 語の名前を置く場所と濃さを決める（描くのは Renderer）
import type { Rgb } from "@/app/styles/pos.ts";
import type { Word } from "@/shared/types.ts";
import type { Camera } from "./Camera.ts";

export type Box = { x: number; y: number; w: number; h: number };
export const intersects = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 名前の候補。x, y は名前の左端と縦の中央、a はいちばん濃いときの濃さ */
export type LabelCand = { id: number; text: string; x: number; y: number; size: number; color: Rgb; a: number };
/** 描く名前。alpha は出し入れの途中の濃さ（0〜1）、show は出ているか（消えかけなら false） */
export type PlacedLabel = { cand: LabelCand; box: Box; width: number; alpha: number; show: boolean };

/**
 * ほかの語の名前。すでに置いた名前と重ならないものだけ出す。
 * 画面のマス目で決めると、動かすたびに境目が変わって密集した所で名前が入れ替わり、点滅して見えるので、名前どうしの重なりで決める。
 * いま出ている名前（消えかけのものも含む）を先に置いて場所を確保し、そのあとによく使われる語から順に置く
 * （新しい名前が、消えかけの名前の上に重なって現れないように）。出すときは 0.25 秒、消すときは 0.12 秒ほどかけて、なめらかに濃さを変える
 */
export class Labels {
  /** 語の名前の濃さ（0〜1）。出す・消すときは少しずつ変えて、密集した所で名前が点滅して見えないようにする */
  private alpha = new Map<number, number>();
  /** 語の名前の幅（語ごとに文字の大きさが決まっているので、一度測ったら使い回す） */
  private widths = new Map<number, number>();
  private lastFrame = 0;

  /** 名前の候補に濃さが残っているか（消えかけの名前も、候補に入れ続ける） */
  isFading(id: number) {
    return this.alpha.has(id);
  }

  /**
   * 時刻 t のフレームで描く名前を決める。labelMax より番号の小さい語だけを出し、reserved（選んだ語の周り）には置かない。
   * measure: 名前の幅を測る
   */
  layout(cands: LabelCand[], labelMax: number, t: number, reserved: Box[], measure: (c: LabelCand) => number): PlacedLabel[] {
    const step = Math.min(1, (t - this.lastFrame) / 250);
    this.lastFrame = t;
    const grid = new BoxGrid();
    reserved.forEach((b) => grid.add(b));
    const seen = new Set<number>();
    const out: PlacedLabel[] = [];
    const order = [...cands.filter((c) => this.alpha.has(c.id)), ...cands.filter((c) => !this.alpha.has(c.id))];
    for (const c of order) {
      seen.add(c.id);
      let width = this.widths.get(c.id);
      if (width === undefined) this.widths.set(c.id, (width = measure(c)));
      const box = { x: c.x - 2, y: c.y - c.size * 0.7, w: width + 4, h: c.size * 1.4 };
      const free = !grid.overlaps(box);
      const show = c.id < labelMax && free;
      // 消すときは出すときの倍の速さにする（動かして名前どうしがぶつかったとき、重なって見える時間を短くする）
      const alpha = Math.max(0, Math.min(1, (this.alpha.get(c.id) ?? 0) + (show ? step : -2 * step)));
      if (alpha <= 0) {
        this.alpha.delete(c.id);
        continue;
      }
      // 出ている名前と、消えかけの名前は、場所を確保する
      if (free) grid.add(box);
      this.alpha.set(c.id, alpha);
      out.push({ cand: c, box, width, alpha, show });
    }
    // 画面の外に出た語などは、濃さの記録を消す
    for (const id of this.alpha.keys()) if (!seen.has(id)) this.alpha.delete(id);
    return out;
  }
}

/** 置いた名前の四角を、画面のマス目ごとに登録しておき、重なりを速く調べる */
class BoxGrid {
  private static CELL = 64;
  private boxes: Box[] = [];
  private cells = new Map<string, number[]>();

  add(b: Box) {
    const k = this.boxes.push(b) - 1;
    for (const key of this.cellsOf(b)) this.cells.set(key, [...(this.cells.get(key) ?? []), k]);
  }

  overlaps(b: Box) {
    return this.cellsOf(b).some((key) => (this.cells.get(key) ?? []).some((k) => intersects(b, this.boxes[k])));
  }

  /** 四角がかかるマス目 */
  private cellsOf(b: Box) {
    const cell = BoxGrid.CELL, keys: string[] = [];
    for (let gx = Math.floor(b.x / cell); gx <= Math.floor((b.x + b.w) / cell); gx++) {
      for (let gy = Math.floor(b.y / cell); gy <= Math.floor((b.y + b.h) / cell); gy++) keys.push(`${gx},${gy}`);
    }
    return keys;
  }
}

/** 選んだ語と近い語の名前を置く場所。leader は、点から離して置いたときに点とつなぐ線の名前側の端 */
export type MarkLabel = { word: Word; sx: number; sy: number; spot: Box; leader: [number, number] | null };

/**
 * 選んだ語と近い語の名前を、点の周りの重ならない所に置く。
 * まず点のすぐ隣（右・左・上・下）を試し、空いていなければ点から少しずつ離して探す。measure: 名前の幅を測る
 */
export function placeMarkLabels(marks: Word[], selectedId: number | undefined, camera: Camera, measure: (text: string) => number): MarkLabel[] {
  const boxes: Box[] = [];
  const out: MarkLabel[] = [];
  for (const m of marks) {
    const [sx, sy] = camera.toScreen(m.x, m.y);
    if (!camera.isOnScreen(sx, sy)) continue;
    const r = selectedId === m.id ? 3.5 : 2.8;
    const w = measure(m.text);
    const near = [[sx + r + 5, sy - 9], [sx - r - 5 - w, sy - 9], [sx - w / 2, sy - r - 22], [sx - w / 2, sy + r + 4]];
    const far: number[][] = [];
    for (let d = 26; d <= 110; d += 21) {
      for (let k = 0; k < 12; k++) {
        const th = (k / 12) * Math.PI * 2;
        far.push([sx + Math.cos(th) * d - (Math.cos(th) < -0.2 ? w : Math.cos(th) > 0.2 ? 0 : w / 2), sy + Math.sin(th) * d - 9]);
      }
    }
    const free = (b: Box) => b.x > 0 && b.x + b.w < camera.w && b.y > 0 && b.y + b.h < camera.h && !boxes.some((o) => intersects(b, o));
    const spot = [...near, ...far].map(([x, y]) => ({ x, y, w, h: 18 })).find(free) ?? { x: near[0][0], y: near[0][1], w, h: 18 };
    boxes.push(spot);
    const cx = Math.max(spot.x, Math.min(spot.x + spot.w, sx)), cy = Math.max(spot.y, Math.min(spot.y + spot.h, sy));
    out.push({ word: m, sx, sy, spot, leader: Math.hypot(cx - sx, cy - sy) > r + 10 ? [cx, cy] : null });
  }
  return out;
}
