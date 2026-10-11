// 地図の操作: ドラッグ・ピンチ・ホイール・タップを見分けて、handlers に知らせる
type Handlers = {
  /** 指やホイールで動かし始めたとき（飛んでいる途中なら止める） */
  grab: () => void;
  /** 画面の上で (dx, dy) px 引っぱった */
  pan: (dx: number, dy: number) => void;
  /** 画面の (sx, sy) を中心に f 倍に拡大した */
  zoom: (f: number, sx: number, sy: number) => void;
  /** 画面の (x, y) をタップした（ほとんど動かさずに離した） */
  tap: (x: number, y: number) => void;
};

/** タップとみなす、押してから離すまでに動かした量（px）の上限 */
const TAP_MOVE = 5;

export class Input {
  /** 触れている指（ポインター）ごとの、直前の位置 */
  private pointers = new Map<number, [number, number]>();
  /** 押してから動かした量（ピンチしたときは、タップにならないよう大きく足す） */
  private moved = 0;
  /** 直前の 2 本の指の間隔（ピンチしていなければ 0） */
  private pinch = 0;

  /** signal: 中止すると、登録したイベントを外す */
  constructor(
    private canvas: HTMLCanvasElement,
    private handlers: Handlers,
    signal: AbortSignal,
  ) {
    canvas.addEventListener("pointerdown", this.onDown, { signal });
    canvas.addEventListener("pointermove", this.onMove, { signal });
    canvas.addEventListener("pointerup", this.onUp, { signal });
    canvas.addEventListener("wheel", this.onWheel, { signal, passive: false });
  }

  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    this.moved = 0;
    this.handlers.grab();
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const cur: [number, number] = [e.clientX, e.clientY];
    this.pointers.set(e.pointerId, cur);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (this.pinch) this.handlers.zoom(d / this.pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      this.pinch = d;
      this.moved += 10;
      return;
    }
    this.handlers.pan(cur[0] - p[0], cur[1] - p[1]);
    this.moved += Math.abs(cur[0] - p[0]) + Math.abs(cur[1] - p[1]);
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = 0;
    if (this.moved < TAP_MOVE && !this.pointers.size) this.handlers.tap(e.clientX, e.clientY);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.handlers.grab();
    this.handlers.zoom(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  };
}
