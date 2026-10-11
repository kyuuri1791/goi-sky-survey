// 単語を使われ方の近さで並べた平面を、canvas に暗い背景に光る点として描く地図。App から使うのはこのクラスだけ。
// 視点（Camera）・点（StarField）・選んだ語（Selection）・描画（Renderer）・操作（Input）を持ち、毎フレームのループを回す。
// タップした語は onTap で知らせる（語を引いてパネルに出すのは呼んだ側）
import type { HomeView } from "@/shared/levels.ts";
import type { TilePoint, Word } from "@/shared/types.ts";
import { Camera } from "./Camera.ts";
import { Input } from "./Input.ts";
import { Renderer } from "./Renderer.ts";
import { Selection } from "./Selection.ts";
import { StarField } from "./StarField.ts";

type Events = {
  /** 語をタップしたとき（何もない所なら null） */
  onTap: (id: number | null) => void;
  /** 最初の範囲から外れたか、戻ったか（「全体を表示」ボタンを出すか） */
  onAwayChange: (away: boolean) => void;
};

/** 画面の真ん中にこれだけ点がなければ、何もない所へ行き過ぎているとみなす */
const MIN_STARS = 40;

export class SkyMap {
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;
  private field: StarField;
  private selection = new Selection();
  private renderer: Renderer;
  /** destroy で、登録したイベントをまとめて外す */
  private listeners = new AbortController();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private disposed = false;
  private dpr = 1;
  /** 冒頭の演出が終わったか。終わるまでは「全体を表示」を出さない */
  private introDone = false;
  private away = false;
  /** 最後にタイルを読むか調べた時刻 */
  private lastTiles = 0;

  /** home: 最初に見せる範囲、baseTile: 全体の星（段 0 のタイル） */
  constructor(
    private canvas: HTMLCanvasElement,
    home: HomeView,
    baseTile: TilePoint[],
    private events: Events,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.camera = new Camera(home);
    this.field = new StarField(baseTile);
    this.renderer = new Renderer(this.ctx, this.camera, this.field);
    const { signal } = this.listeners;
    this.resize();
    addEventListener("resize", this.resize, { signal });
    new Input(
      canvas,
      {
        grab: () => this.camera.stop(),
        pan: (dx, dy) =>
          this.moveLimited(() => {
            this.camera.x -= dx / this.camera.s;
            this.camera.y -= dy / this.camera.s;
          }),
        zoom: (f, sx, sy) => this.zoomAt(f, sx, sy),
        tap: (x, y) => this.events.onTap(this.renderer.hitTest(x, y)),
      },
      signal,
    );
    requestAnimationFrame(this.loop);
  }

  /** 語 w と近い語に目印をつける。fly なら、近い語が名前まで画面に収まる所へ飛ぶ */
  select(w: Word, neighbors: Word[], fly: boolean) {
    this.selection.set(w, neighbors);
    if (fly) this.camera.flyTo(this.camera.focusView(w, neighbors));
  }

  /** 目印をすぐ消す */
  clear() {
    this.selection.clear();
  }

  /** 最初の範囲（全体の表示）に戻る。目印は薄くして消す */
  goHome() {
    this.camera.flyTo(this.camera.homeView(), 1200);
    this.selection.fadeOut();
  }

  /** 冒頭の演出: 語 w の近くから始めて、ゆっくり引いて全体を見せる */
  playIntro(w: Word, neighbors: Word[]) {
    // 検索で語に飛んだときと同じく、近い語が名前まで画面に収まる視点から始める（最初はパネルを出さないので、パネルの分は空けない）
    this.camera.set(this.camera.focusView(w, neighbors, false));
    this.select(w, neighbors, false);
    this.timers.push(
      setTimeout(() => {
        this.camera.flyTo(this.camera.homeView(), 3000);
        this.timers.push(setTimeout(() => (this.introDone = true), 3000));
        // 引き始めたら目印は薄くして消す（そのあいだに別の語を選んでいたら、そちらは残す）
        if (this.selection.word?.id === w.id) this.selection.fadeOut();
      }, 900),
    );
  }

  /** 冒頭の演出をせず、全体の表示から始める */
  showHome() {
    this.camera.set(this.camera.homeView());
    this.introDone = true;
  }

  destroy() {
    this.disposed = true;
    this.listeners.abort();
    this.timers.forEach(clearTimeout);
  }

  private resize = () => {
    this.dpr = window.devicePixelRatio || 1;
    this.camera.w = this.canvas.clientWidth;
    this.camera.h = this.canvas.clientHeight;
    this.canvas.width = this.camera.w * this.dpr;
    this.canvas.height = this.camera.h * this.dpr;
  };

  private loop = (t: number) => {
    if (this.disposed) return;
    this.camera.update(performance.now());
    if (t - this.lastTiles > 200) {
      this.lastTiles = t;
      this.field.request(this.camera);
      const away = this.introDone && this.camera.isAway();
      if (away !== this.away) this.events.onAwayChange((this.away = away));
    }
    this.renderer.draw(t, this.dpr, this.selection, this.selection.opacity());
    requestAnimationFrame(this.loop);
  };

  /**
   * 視点を動かす。画面の真ん中の点が MIN_STARS より少ないときは、点が増える向きか、語の集まりの中心（home）に近づく向きにしか動かさない
   * （何もない所へいくらでも行けてしまわないように）。戻る向きにはいつでも動かせるので、急に引き戻すことはない
   */
  private moveLimited(change: () => void) {
    const { camera } = this, { home } = camera;
    const [fromX, fromY, before] = [camera.x, camera.y, this.field.countInCenter(camera, MIN_STARS)];
    change();
    const after = this.field.countInCenter(camera, MIN_STARS);
    const dist = (x: number, y: number) => Math.hypot(x - home.x, y - home.y);
    if (after < MIN_STARS && after <= before && dist(camera.x, camera.y) > dist(fromX, fromY)) [camera.x, camera.y] = [fromX, fromY];
  }

  /** 画面の (sx, sy) を中心に f 倍に拡大する */
  private zoomAt(f: number, sx: number, sy: number) {
    this.moveLimited(() => {
      const { camera } = this;
      const [dx, dy] = camera.toData(sx, sy);
      camera.s = Math.min(camera.fitScale() * 600, Math.max(camera.fitScale() * 0.5, camera.s * f));
      camera.x = dx - (sx - camera.w / 2) / camera.s;
      camera.y = dy - (sy - camera.h / 2) / camera.s;
    });
  }
}
