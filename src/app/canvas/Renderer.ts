// 地図を描く: 背景、点、語の名前、選んだ語と近い語の目印。
// 直前に描いた点と名前の位置を覚えておき、タップでどの語を選ぶか決めるのにも使う
import { posColor, posRgb } from "@/app/styles/pos.ts";
import { visibleCount } from "@/shared/levels.ts";
import type { Word } from "@/shared/types.ts";
import type { Camera } from "./Camera.ts";
import { type Box, type LabelCand, Labels, placeMarkLabels } from "./Labels.ts";
import type { Selection } from "./Selection.ts";
import type { Star, StarField } from "./StarField.ts";
import { labelFont, MARK_FONT } from "./style.ts";

/** 1 フレームを描くあいだ使う値。labelCands には、点を描きながら名前の候補を集める */
type Frame = { t: number; z: number; vis: number; labelMax: number; labelCands: LabelCand[] };

export class Renderer {
  private labels = new Labels();
  // 直前のフレームで描いた点と名前の位置
  private hitDots: { x: number; y: number; a: number; id: number }[] = [];
  private hitLabels: (Box & { id: number })[] = [];

  constructor(
    private ctx: CanvasRenderingContext2D,
    private camera: Camera,
    private field: StarField,
  ) {}

  /** 時刻 t のフレームを描く。fade は選んだ語の目印の濃さ */
  draw(t: number, dpr: number, selection: Selection, fade: number) {
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawBackground();
    this.hitDots = [];
    this.hitLabels = [];
    const z = this.camera.zoom();
    // 名前を出す語の数（よく使われる順）。全体を見ているとき（拡大率 1）は出さず、拡大するにつれて増やす。
    // 窓の大きさを変えると拡大率が 1 から少しずれるので、1.3 倍ほどまでは出さない
    const frame: Frame = { t, z, vis: visibleCount(z), labelMax: 40 * Math.max(0, z ** 1.7 - 1.5), labelCands: [] };
    const marks = selection.marks;
    const markIds = new Set(marks.map((m) => m.id));
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const p of this.field.stars) {
      if (p.id > frame.vis * 1.2) break;
      if (!markIds.has(p.id)) this.drawStar(frame, p, false);
    }
    // 選んだ語と近い語の点と名前の周りには、ほかの語の名前を置かない
    ctx.font = MARK_FONT;
    const reserved = marks.map((m) => {
      const [sx, sy] = this.camera.toScreen(m.x, m.y);
      return { x: sx - 12, y: sy - 14, w: ctx.measureText(m.text).width + 30, h: 28 };
    });
    this.drawLabels(frame, reserved);
    ctx.globalAlpha = fade;
    // 線（星と名前のあとに描いて、埋もれないようにする）
    if (selection.word) this.drawLines(selection.word, selection.neighbors);
    // 選んだ語と近い語の点を描いてから、名前を描く（名前が点に隠れないように）
    for (const m of marks) this.drawStar(frame, m, true);
    this.drawMarkLabels(selection);
    if (selection.word) this.drawRing(selection.word);
    ctx.globalAlpha = 1;
  }

  /**
   * 画面の (x, y) を押したときに選ぶ語。押した所に名前があればその語、なければ 20px 以内の点の語（どちらも直前に描いたもの）。
   * 点は、ほとんど見えない薄い点が近くにあっても見えている点が選ばれるよう、距離を明るさで割って比べる。どちらもなければ null
   */
  hitTest(x: number, y: number) {
    // 後から描いた（上に重なっている）名前を優先する
    const label = this.hitLabels.findLast((b) => x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y && y <= b.y + b.h);
    if (label) return label.id;
    let best: number | null = null, bd = Infinity;
    for (const p of this.hitDots) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > 20) continue;
      const score = d / (p.a + 0.1);
      if (score < bd) {
        bd = score;
        best = p.id;
      }
    }
    return best;
  }

  private drawBackground() {
    const { ctx } = this, { w: W, h: H } = this.camera;
    const bg = ctx.createRadialGradient(W / 2, H * 0.6, 0, W / 2, H * 0.6, Math.max(W, H));
    bg.addColorStop(0, "#081026");
    bg.addColorStop(1, "#02030a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  /** 点を 1 つ描く。hi: 選んだ語と近い語（必ず描き、名前はここでは出さない） */
  private drawStar(frame: Frame, p: Star, hi: boolean) {
    const { ctx } = this, { t, z, vis, labelMax } = frame, { id } = p;
    const [sx, sy] = this.camera.toScreen(p.x, p.y);
    if (!this.camera.isOnScreen(sx, sy)) return;
    // 拡大して新しく見えてきた語は、少しずつ明るくする
    const appear = hi ? 1 : Math.min(1, Math.max(0, (vis * 1.2 - id) / (vis * 0.2)));
    if (appear <= 0) return;
    const mag = Math.log10(id + 10);
    const r = Math.max(hi ? 2 : 0.6, 3.2 - mag * 0.7) * (0.85 + Math.min(z, 8) * 0.04);
    const tw = id < 400 ? 0.85 + 0.15 * Math.sin(t / 700 + id * 1.7) : 1;
    const a = Math.min(1, (1.25 - mag * 0.22) * appear * tw);
    const [cr, cg, cb] = posRgb(p.pos);
    if (r > 1.6) {
      const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 4);
      halo.addColorStop(0, `rgba(${cr},${cg},${cb},${a * 0.4})`);
      halo.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(sx - r * 4, sy - r * 4, r * 8, r * 8);
    }
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    this.hitDots.push({ x: sx, y: sy, a, id });
    if (!hi && (id < labelMax || this.labels.isFading(id))) {
      // 名前の濃さには、星のまたたき（tw）を入れない（名前がちらつかないように）
      frame.labelCands.push({ id, text: p.text, x: sx + r + 4, y: sy, size: Math.max(10, 14 - mag * 1.2), color: [cr, cg, cb], a: Math.min(1, a / tw + 0.15) * appear });
    }
  }

  /** ほかの語の名前 */
  private drawLabels(frame: Frame, reserved: Box[]) {
    const { ctx } = this;
    const measure = (c: LabelCand) => {
      ctx.font = labelFont(c.size);
      return ctx.measureText(c.text).width;
    };
    for (const { cand: c, box, width, alpha, show } of this.labels.layout(frame.labelCands, frame.labelMax, frame.t, reserved, measure)) {
      ctx.font = labelFont(c.size);
      // 出始めと出終わりがなめらかになるよう、濃さを曲線で変える
      ctx.fillStyle = `rgba(${c.color.join(",")},${c.a * alpha * alpha * (3 - 2 * alpha)})`;
      ctx.fillText(c.text, c.x, c.y);
      if (show) this.hitLabels.push({ x: c.x, y: box.y, w: width, h: box.h, id: c.id });
    }
  }

  /** 選んだ語と近い語を結ぶ点線 */
  private drawLines(word: Word, neighbors: Word[]) {
    const { ctx } = this;
    ctx.lineWidth = 1.3;
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = "rgba(220,228,245,0.7)";
    const [ax, ay] = this.camera.toScreen(word.x, word.y);
    for (const n of neighbors) {
      const [bx, by] = this.camera.toScreen(n.x, n.y);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** 選んだ語と近い語の名前。点から離して置いたときは、点と名前を細い線でつなぐ */
  private drawMarkLabels(selection: Selection) {
    const { ctx } = this;
    ctx.font = MARK_FONT;
    for (const { word, sx, sy, spot, leader } of placeMarkLabels(selection.marks, selection.word?.id, this.camera, (text) => ctx.measureText(text).width)) {
      this.hitLabels.push({ ...spot, id: word.id });
      if (leader) {
        ctx.strokeStyle = "rgba(220,228,245,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(...leader);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(3,5,11,0.65)";
      ctx.fillRect(spot.x - 2, spot.y, spot.w + 4, spot.h);
      // 名前は、点と同じ品詞の色にする（凡例・パネルとそろえる）
      ctx.fillStyle = posColor(word.pos);
      ctx.textBaseline = "top";
      ctx.fillText(word.text, spot.x, spot.y + 1);
      ctx.textBaseline = "middle";
    }
  }

  /** 選んだ語の周りの丸 */
  private drawRing(word: Word) {
    const { ctx } = this;
    const [sx, sy] = this.camera.toScreen(word.x, word.y);
    ctx.strokeStyle = posColor(word.pos);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(sx, sy, 10, 0, Math.PI * 2);
    ctx.stroke();
  }
}
