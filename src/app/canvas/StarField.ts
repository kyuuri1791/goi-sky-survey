// 地図の点。全体の星（段 0 のタイル）から始めて、見えている範囲と拡大率に要るタイル（/api/tiles）を読み足していく
import { MAX_LEVEL, tileIndex, visibleCount } from "@/shared/levels.ts";
import type { TilePoint } from "@/shared/types.ts";
import type { Camera } from "./Camera.ts";

export type Star = { x: number; y: number; id: number; pos: number; text: string };

export class StarField {
  /** 読み込んだ点（よく使われる順＝id の小さい順に並べておく） */
  readonly stars: Star[] = [];
  private loaded = new Set<string>();

  /** baseTile: 全体の星。ページに入っているので、読み込まずに使う */
  constructor(baseTile: TilePoint[]) {
    this.add(baseTile);
    this.loaded.add("0/0/0");
  }

  /** いまの拡大率と範囲で要るタイルを読む */
  request(camera: Camera) {
    const level = Math.min(MAX_LEVEL, Math.max(0, Math.ceil(Math.log2(Math.max(1, camera.zoom()) * 1.1))));
    const [x0, y0] = camera.toData(0, 0);
    const [x1, y1] = camera.toData(camera.w, camera.h);
    for (let lv = 0; lv <= level; lv++) {
      for (let tx = tileIndex(x0, lv); tx <= tileIndex(x1, lv); tx++) {
        for (let ty = tileIndex(y0, lv); ty <= tileIndex(y1, lv); ty++) void this.load(`${lv}/${tx}/${ty}`);
      }
    }
  }

  /** 画面の真ん中（縦横それぞれ中央の半分）に描いている点の数（max まで数えたら打ち切る） */
  countInCenter(camera: Camera, max: number) {
    const vis = visibleCount(camera.zoom());
    const [x0, y0] = camera.toData(camera.w / 4, camera.h / 4), [x1, y1] = camera.toData((camera.w * 3) / 4, (camera.h * 3) / 4);
    let count = 0;
    for (const p of this.stars) {
      if (p.id > vis) break;
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && ++count >= max) break;
    }
    return count;
  }

  private add(tile: TilePoint[]) {
    for (const [x, y, id, pos, text] of tile) this.stars.push({ x, y, id, pos, text });
    this.stars.sort((a, b) => a.id - b.id);
  }

  private async load(key: string) {
    if (this.loaded.has(key)) return;
    this.loaded.add(key);
    try {
      const r = await fetch(`/api/tiles/${key}`);
      if (!r.ok) throw new Error(String(r.status));
      this.add(await r.json());
    } catch {
      // 読めなかったら（サーバーが起きる途中のエラーなど）、次に見えたときに読み直す
      this.loaded.delete(key);
    }
  }
}
