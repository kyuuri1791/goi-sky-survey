"use client";

// 単語を意味の近さで並べた平面を、暗い背景に光る点として描く。
// 点はタイル（/api/tiles）で見えている範囲のぶんだけ読み、よく使われる語ほど明るく、引いて見ているときから出す。
// 検索と近い語はサーバーの API に聞く。
import { useEffect, useRef, useState } from "react";
import { MAX_LEVEL, POS_NAMES, tileIndex, visibleCount as countAt } from "@/lib/levels.ts";

type Word = { id: number; text: string; x: number; y: number; rank: number; pos: number; score?: number };
/** パネルに出す語と近い語。composite は、語彙にない複合語を分けた語 */
type Panel = { word: Word; neighbors: Word[]; composite?: Word[] } | null;

// 点の色: 品詞（POS_NAMES の順）。色覚の違いがあっても見分けやすい Okabe-Ito の配色を、暗い背景向けに明るくしたもの。
// いちばん多い名詞は白っぽくして全体を星空らしく保ち、その他（記号・接尾辞など）は灰色で目立たせない
const COLORS = [
  [100, 185, 240], // 動詞: 空色
  [80, 210, 170], // 形容詞: 青緑
  [225, 145, 205], // 副詞など: 赤紫
  [235, 230, 215], // 名詞: 白
  [245, 170, 60], // 固有名詞: 橙
  [150, 150, 165], // その他: 灰
];
const posColor = (pos: number) => `rgb(${COLORS[pos] ?? COLORS[5]})`;

export default function Sky() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [msg, setMsg] = useState("");
  const [about, setAbout] = useState(false);
  const api = useRef<{ select: (w: Word, neighbors: Word[], fly: boolean) => void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let W = 0, H = 0, dpr = 1;
    let disposed = false;
    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    };
    resize();
    addEventListener("resize", resize);

    // 読み込んだ点（よく使われる順＝id の小さい順に並べておく）
    const pts: { x: number; y: number; id: number; pos: number; text: string }[] = [];
    const loaded = new Set<string>();
    const loadTile = async (key: string) => {
      if (loaded.has(key)) return;
      loaded.add(key);
      const list: [number, number, number, number, string][] = await fetch(`/api/tiles/${key}`).then((r) => r.json());
      for (const [x, y, id, pos, text] of list) pts.push({ x, y, id, pos, text });
      pts.sort((a, b) => a.id - b.id);
    };

    const fitScale = () => Math.min(W, H) * 0.46;
    const view = { x: 0, y: 0, s: 1 };
    const toScreen = (x: number, y: number) => [W / 2 + (x - view.x) * view.s, H / 2 + (y - view.y) * view.s];
    const toData = (sx: number, sy: number) => [view.x + (sx - W / 2) / view.s, view.y + (sy - H / 2) / view.s];
    const zoom = () => view.s / fitScale();
    const visibleCount = () => countAt(zoom());

    /** いまの拡大率と範囲で要るタイルを読む */
    const requestTiles = () => {
      const level = Math.min(MAX_LEVEL, Math.max(0, Math.ceil(Math.log2(Math.max(1, zoom()) * 1.1))));
      const [x0, y0] = toData(0, 0);
      const [x1, y1] = toData(W, H);
      for (let lv = 0; lv <= level; lv++) {
        for (let tx = tileIndex(x0, lv); tx <= tileIndex(x1, lv); tx++) {
          for (let ty = tileIndex(y0, lv); ty <= tileIndex(y1, lv); ty++) void loadTile(`${lv}/${tx}/${ty}`);
        }
      }
    };

    // 選んだ語と近い語（タイルを読む前でも位置が分かるように、API の結果をそのまま持つ）
    let marks: Word[] = [];
    let selected: Word | null = null;
    let lines: [Word, Word][] = [];
    /** 選んだ語の目印を薄くして消し始めた時刻（冒頭の「猫」を消すとき）。null なら消していない */
    let fadeStart: number | null = null;
    const FADE_MS = 800;
    // 直前のフレームで描いた点と名前の位置（タップでどの語を選ぶか決めるのに使う）
    let hitDots: { x: number; y: number; a: number; id: number }[] = [];
    let hitLabels: { x: number; y: number; w: number; h: number; id: number }[] = [];

    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = ctx.createRadialGradient(W / 2, H * 0.6, 0, W / 2, H * 0.6, Math.max(W, H));
      bg.addColorStop(0, "#081026");
      bg.addColorStop(1, "#02030a");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const z = zoom();
      // 目印を消している途中なら薄くし、消し終わったら外す
      const fade = fadeStart === null ? 1 : Math.max(0, 1 - (performance.now() - fadeStart) / FADE_MS);
      if (fadeStart !== null && fade === 0) {
        selected = null;
        marks = [];
        lines = [];
        fadeStart = null;
      }
      // 線
      ctx.globalAlpha = fade;
      ctx.lineWidth = 1.1;
      ctx.setLineDash([3, 5]);
      for (const [a, b] of lines) {
        const [ax, ay] = toScreen(a.x, a.y), [bx, by] = toScreen(b.x, b.y);
        ctx.strokeStyle = "rgba(200,210,235,0.45)";
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      hitDots = [];
      hitLabels = [];
      const vis = visibleCount();
      const markIds = new Set(marks.map((m) => m.id));
      const labelMax = 40 * z ** 1.7;
      const taken = new Set<string>();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const drawStar = (x: number, y: number, id: number, pos: number, text: string, hi: boolean) => {
        const [sx, sy] = toScreen(x, y);
        if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) return null;
        const fade = hi ? 1 : Math.min(1, Math.max(0, (vis * 1.2 - id) / (vis * 0.2)));
        if (fade <= 0) return null;
        const mag = Math.log10(id + 10);
        const r = Math.max(hi ? 2 : 0.6, 3.2 - mag * 0.7) * (0.85 + Math.min(z, 8) * 0.04);
        const tw = id < 400 ? 0.85 + 0.15 * Math.sin(t / 700 + id * 1.7) : 1;
        const a = Math.min(1, (1.25 - mag * 0.22) * fade * tw);
        const [cr, cg, cb] = COLORS[pos] ?? COLORS[5];
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
        hitDots.push({ x: sx, y: sy, a, id });
        if (!hi && id < labelMax) {
          const key = `${Math.floor(sx / 64)},${Math.floor(sy / 21)}`;
          if (!taken.has(key)) {
            taken.add(key);
            const size = Math.max(10, 14 - mag * 1.2);
            ctx.font = `500 ${size}px 'Hiragino Sans', 'Noto Sans JP', sans-serif`;
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${Math.min(1, a + 0.15) * fade})`;
            ctx.fillText(text, sx + r + 4, sy);
            hitLabels.push({ x: sx + r + 4, y: sy - size * 0.7, w: ctx.measureText(text).width, h: size * 1.4, id });
          }
        }
        return [sx, sy, r];
      };
      for (const p of pts) {
        if (p.id > vis * 1.2) break;
        if (!markIds.has(p.id)) drawStar(p.x, p.y, p.id, p.pos, p.text, false);
      }
      // 選んだ語の周り: 必ず描き、名前は重ならない所へ
      ctx.globalAlpha = fade;
      const boxes: { x: number; y: number; w: number; h: number }[] = [];
      for (const m of marks) {
        const s = drawStar(m.x, m.y, m.id, m.pos, m.text, true);
        if (!s) continue;
        const [sx, sy, r] = s;
        ctx.font = "700 14px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
        const w = ctx.measureText(m.text).width;
        const cands = [[sx + r + 5, sy - 9], [sx - r - 5 - w, sy - 9], [sx - w / 2, sy - r - 22], [sx - w / 2, sy + r + 4], [sx + r + 5, sy + 8], [sx + r + 5, sy - 26]];
        const spot =
          cands.map(([x, y]) => ({ x, y, w, h: 18 })).find((b) => !boxes.some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h)) ??
          { x: cands[0][0], y: cands[0][1], w, h: 18 };
        boxes.push(spot);
        hitLabels.push({ ...spot, id: m.id });
        ctx.fillStyle = "rgba(3,5,11,0.65)";
        ctx.fillRect(spot.x - 2, spot.y, spot.w + 4, spot.h);
        // 名前は、点と同じ品詞の色にする（凡例・パネルとそろえる）
        ctx.fillStyle = posColor(m.pos);
        ctx.textBaseline = "top";
        ctx.fillText(m.text, spot.x, spot.y + 1);
        ctx.textBaseline = "middle";
      }
      if (selected) {
        const [sx, sy] = toScreen(selected.x, selected.y);
        ctx.strokeStyle = posColor(selected.pos);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    // 視点を動かすアニメーション（遠くへは、いったん引いてから寄る）
    let anim: ((now: number) => void) | null = null;
    const flyTo = (x: number, y: number, s: number, ms = 1400) => {
      const from = { ...view };
      const t0 = performance.now();
      const dist = Math.hypot(x - from.x, y - from.y);
      const midS = Math.min(from.s, s, (Math.min(W, H) * 0.5) / Math.max(dist, 0.01));
      anim = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        const e = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
        view.x = from.x + (x - from.x) * e;
        view.y = from.y + (y - from.y) * e;
        const ls = p < 0.5 ? Math.log(from.s) + (Math.log(midS) - Math.log(from.s)) * (e * 2) : Math.log(midS) + (Math.log(s) - Math.log(midS)) * ((e - 0.5) * 2);
        view.s = Math.exp(ls);
        if (p >= 1) anim = null;
      };
    };

    let lastTiles = 0;
    const loop = (t: number) => {
      if (disposed) return;
      if (anim) anim(performance.now());
      if (t - lastTiles > 200) {
        lastTiles = t;
        requestTiles();
      }
      draw(t);
      requestAnimationFrame(loop);
    };

    /**
     * 語 w と近い語が画面の半分ほどに収まる拡大率。2 次元に写したときに遠くへ離れてしまった近い語
     * （ほかの近い語までの距離の中央値の 3 倍より遠いもの）は、引きすぎないよう計算から外す
     */
    const focusScale = (w: Word, near: Word[]) => {
      const ds = near.map((n) => Math.hypot(n.x - w.x, n.y - w.y)).sort((a, b) => a - b);
      const median = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
      let extent = 0;
      for (const n of near) {
        const d = Math.hypot(n.x - w.x, n.y - w.y);
        if (d <= median * 3) extent = Math.max(extent, Math.abs(n.x - w.x), Math.abs(n.y - w.y));
      }
      const s = (Math.min(W, H) * 0.3) / Math.max(extent, 0.0005);
      return Math.min(fitScale() * 400, Math.max(fitScale() * 12, s));
    };

    api.current = {
      select(w, neighbors, fly) {
        fadeStart = null;
        selected = w;
        marks = [w, ...neighbors];
        lines = neighbors.map((n) => [w, n]);
        if (fly) flyTo(w.x, w.y, focusScale(w, neighbors));
      },
    };

    // ドラッグ・ホイール・ピンチ・タップ
    const pointers = new Map<number, [number, number]>();
    let moved = 0, pinch = 0;
    const zoomAt = (f: number, sx: number, sy: number) => {
      const [dx, dy] = toData(sx, sy);
      view.s = Math.min(fitScale() * 600, Math.max(fitScale() * 0.5, view.s * f));
      view.x = dx - (sx - W / 2) / view.s;
      view.y = dy - (sy - H / 2) / view.s;
    };
    canvas.onpointerdown = (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      moved = 0;
      anim = null;
    };
    canvas.onpointermove = (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const cur: [number, number] = [e.clientX, e.clientY];
      pointers.set(e.pointerId, cur);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) zoomAt(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        pinch = d;
        moved += 10;
        return;
      }
      view.x -= (cur[0] - p[0]) / view.s;
      view.y -= (cur[1] - p[1]) / view.s;
      moved += Math.abs(cur[0] - p[0]) + Math.abs(cur[1] - p[1]);
    };
    canvas.onpointerup = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (moved >= 5 || pointers.size) return;
      // タップ: 押した所に名前があればその語、なければ 20px 以内の点の語（どちらも直前に描いたもの）。
      // 点は、ほとんど見えない薄い点が近くにあっても見えている点が選ばれるよう、距離を明るさで割って比べる
      const { clientX: cx, clientY: cy } = e;
      // 後から描いた（上に重なっている）名前を優先する
      let best = hitLabels.findLast((b) => cx >= b.x - 2 && cx <= b.x + b.w + 2 && cy >= b.y && cy <= b.y + b.h)?.id ?? null;
      if (best === null) {
        let bd = Infinity;
        for (const p of hitDots) {
          const d = Math.hypot(p.x - cx, p.y - cy);
          if (d > 20) continue;
          const score = d / (p.a + 0.1);
          if (score < bd) {
            bd = score;
            best = p.id;
          }
        }
      }
      if (best === null) {
        selected = null;
        marks = [];
        lines = [];
        setPanel(null);
        return;
      }
      fetch(`/api/neighbors?id=${best}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.error) return;
          api.current?.select(d.word, d.neighbors, false);
          setPanel({ word: d.word, neighbors: d.neighbors });
        });
    };
    canvas.onwheel = (e) => {
      e.preventDefault();
      anim = null;
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    };

    // 最初は「猫」の近くから始めて、ゆっくり引いて全体を見せる
    (async () => {
      const d = await fetch("/api/word?w=猫").then((r) => r.json());
      if (disposed) return;
      view.x = d.word.x;
      view.y = d.word.y;
      view.s = fitScale() * 40;
      api.current?.select(d.word, d.neighbors, false);
      requestAnimationFrame(loop);
      setTimeout(() => {
        flyTo(0, 0, fitScale(), 3000);
        // 引き始めたら「猫」の目印は薄くして消す（そのあいだに別の語を選んでいたら、そちらは残す）
        if (selected?.id === d.word.id) fadeStart = performance.now();
      }, 1500);
    })();

    return () => {
      disposed = true;
      removeEventListener("resize", resize);
    };
  }, []);

  const search = async (text: string) => {
    setMsg("");
    const d = await fetch(`/api/word?w=${encodeURIComponent(text)}`).then((r) => r.json());
    if (d.error) return setMsg(d.error);
    api.current?.select(d.word, d.neighbors, true);
    setPanel({ word: d.word, neighbors: d.neighbors, composite: d.composite });
  };

  const pick = (w: Word) => {
    fetch(`/api/neighbors?id=${w.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return;
        api.current?.select(d.word, d.neighbors, true);
        setPanel({ word: d.word, neighbors: d.neighbors });
      });
  };

  const posName = (p: number) => POS_NAMES[p] ?? "";

  return (
    <>
      <canvas ref={canvasRef} className="sky" />
      <header>
        <h1>
          <span>日本語語彙スカイサーベイ</span>
          <span>（β版）</span>
        </h1>
        <button className="link" onClick={() => setAbout(true)}>
          このデータについて
        </button>
      </header>
      {panel && (
        <div className="panel">
          {panel.composite && <div className="kind">{panel.composite.map((w) => w.text).join(" ＋ ")} に近い語</div>}
          <h2 style={{ color: posColor(panel.word.pos) }}>{panel.word.text}</h2>
          <dl>
            <dt>頻度順位</dt>
            <dd>#{panel.word.rank.toLocaleString()}</dd>
            <dt>品詞</dt>
            <dd>
              <b className="chip" style={{ background: posColor(panel.word.pos) }} />
              {posName(panel.word.pos)}
            </dd>
          </dl>
          <h3>意味の近い語</h3>
          {panel.neighbors.map((w) => (
            <button key={w.id} onClick={() => pick(w)}>
              <span>
                <b className="chip" style={{ background: posColor(w.pos) }} />
                {w.text}
              </span>
              <span className="score">{w.score?.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="legend">
        <span className="title">凡例</span>
        <br />
        色：品詞
        <br />
        {POS_NAMES.map((p, i) => (
          <span key={p}>
            <b className="chip" style={{ background: posColor(i) }} />
            {p}
            <br />
          </span>
        ))}
        明るさ: よく使われる語ほど明るい
      </div>
      {msg && <div className="msg">{msg}</div>}
      <div className="bar">
        <input
          placeholder="語で検索（例: 深夜ラジオ）"
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            const text = e.currentTarget.value.trim();
            if (text) void search(text);
          }}
        />
      </div>
      {about && (
        <div className="about" onClick={(e) => e.target === e.currentTarget && setAbout(false)}>
          <div className="box">
            <h2>このデータについて</h2>
            <h3>何を表しているか</h3>
            <p>
              日本語の単語を使われ方の近さで平面に並べたものです。各単語は、ウェブ上の大量の文章で前後に現れる語をもとに300次元のベクトルで表され、似た語に囲まれて使われる単語ほど向きが近くなります。300次元を2次元に写すときに歪みが出るため、遠く離れた点どうしの距離は必ずしも当てになりません。
            </p>
            <p>
              点の明るさは単語がよく使われる度合いを、色は品詞を表します。
            </p>
            <h3>ご注意</h3>
            <p>
              このデータは、ウェブでの言葉の使われ方を統計的にそのまま写したものです。そのため、偏りのある連想や、不快に感じられる言葉が含まれることがあります。そうした言葉は確認できる範囲で取り除いていますが、すべてを取り除けているとは限りません。お気づきの点があればお知らせください。
            </p>
            <h3>出典</h3>
            <p className="mono">
              単語ベクトル: chiVe（Works Applications, Apache License 2.0）
              <br />
              表記・品詞: SudachiDict（Works Applications, Apache License 2.0）
            </p>
            <p style={{ textAlign: "right", marginTop: 12 }}>
              <button className="link" onClick={() => setAbout(false)}>
                閉じる
              </button>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
