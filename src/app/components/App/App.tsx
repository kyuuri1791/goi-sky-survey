"use client";

// 画面全体: 地図（canvas）と、タイトル・パネル・凡例・検索欄。
// 地図は src/app/canvas/SkyMap.ts が描き、ここは語を引いてパネルに出したり、地図に飛ぶよう頼んだりする
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { SkyMap } from "@/app/canvas/SkyMap.ts";
import About from "@/app/components/About/About.tsx";
import Panel, { type PanelData } from "@/app/components/Panel/Panel.tsx";
import { POS_NAMES, posColor } from "@/app/styles/pos.ts";
import ui from "@/app/styles/ui.module.css";
import type { HomeView } from "@/shared/levels.ts";
import type { TilePoint, WordResult } from "@/shared/types.ts";
import styles from "./App.module.css";
import { CURATED_WORDS } from "./curated.ts";

/** 語を引く API（src/app/api）の答え。見つからなかったときや、読めなかったときは error に理由が入る */
type Lookup = WordResult | { error: string };

/** 語を引く。path は /api/word/語（検索。語彙にない複合語も引ける）か /api/neighbors/番号（星や近い語を押したとき） */
const fetchWord = async (path: string): Promise<Lookup> => {
  try {
    return await (await fetch(path)).json();
  } catch {
    return { error: "読み込めませんでした。少し待ってからもう一度お試しください" };
  }
};

export default function App({ home, intro, baseTile }: { home: HomeView; intro: WordResult; baseTile: TilePoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<SkyMap | null>(null);
  /** 最後に頼んだ語の番号。答えが前後して届いても、最後に頼んだ語だけを出す */
  const latest = useRef(0);
  const [panel, setPanel] = useState<PanelData | null>(null);
  const [msg, setMsg] = useState("");
  const [about, setAbout] = useState(false);
  /** 最初の範囲から外れているか（「全体を表示」ボタンを出すか） */
  const [away, setAway] = useState(false);

  /**
   * 引いた語を、地図でその語へ飛び、パネルに出す。n は頼んだときの番号、query は共有する URL に入れる文字（省くと語そのもの）。
   * 見つからなければ理由を出して false を返す
   */
  const show = (n: number, d: Lookup, query?: string) => {
    if (n !== latest.current) return false;
    setMsg("error" in d ? d.error : "");
    if ("error" in d) return false;
    mapRef.current?.select(d.word, d.neighbors, true);
    setPanel({ ...d, query: query ?? d.word.text });
    return true;
  };
  const open = async (request: Promise<Lookup>, query?: string) => {
    const n = ++latest.current;
    return show(n, await request, query);
  };

  /** 選んでいる語をやめる。home なら全体の表示に戻る（目印は薄くして消す）。そうでなければ目印をすぐ消す */
  const close = (home: boolean) => {
    latest.current++;
    if (home) mapRef.current?.goHome();
    else mapRef.current?.clear();
    setPanel(null);
  };

  const search = async (text: string) => {
    // 見つかったら入力欄から抜ける（Esc で全体に戻れるように。スマホではキーボードも閉じる）。見つからなければ打ち直せるよう残す
    if (await open(fetchWord(`/api/word/${encodeURIComponent(text)}`), text)) inputRef.current?.blur();
  };

  /** 一覧（src/app/components/App/curated.ts）からランダムに選んだ面白い語へ飛ぶ。今見ている語は選ばない */
  const surprise = () => {
    const pool = CURATED_WORDS.filter((w) => w !== panel?.query);
    void search(pool[Math.floor(Math.random() * pool.length)]);
  };

  const onTap = useEffectEvent((id: number | null) => (id === null ? close(false) : void open(fetchWord(`/api/neighbors/${id}`))));
  const showShared = useEffectEvent((n: number, d: Lookup, text: string) => void show(n, d, text));
  useEffect(() => {
    const map = new SkyMap(canvasRef.current!, home, baseTile, { onTap: (id) => onTap(id), onAwayChange: setAway });
    mapRef.current = map;
    // 共有された URL（/?w=語）から開いたときは、冒頭の演出をせず、全体からその語へ飛ぶ
    const shared = new URLSearchParams(location.search).get("w");
    if (shared) {
      map.showHome();
      const n = ++latest.current;
      void fetchWord(`/api/word/${encodeURIComponent(shared)}`).then((d) => showShared(n, d, shared));
    } else {
      // 最初は「猫」の近くから始めて、ゆっくり引いて全体を見せる
      // （「猫」と近い語はページに入れてあるので、サーバーの応答を待たずにすぐ出せる）
      map.playIntro(intro.word, intro.neighbors);
    }
    return () => {
      map.destroy();
      mapRef.current = null;
    };
  }, [home, intro, baseTile]);

  // Esc か Home キーでも全体に戻る（検索欄に入力しているときは除く）
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if ((e.key === "Escape" || e.key === "Home") && !(e.target instanceof HTMLInputElement)) close(true);
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  }, []);

  // 選んでいる語を URL に入れておく（/?w=語）。そのままアドレスを送れば、相手も同じ語から見られる
  useEffect(() => {
    const url = new URL(location.href);
    if (panel) url.searchParams.set("w", panel.query);
    else url.searchParams.delete("w");
    history.replaceState(null, "", url);
  }, [panel]);

  return (
    <>
      <canvas ref={canvasRef} className={styles.canvas} />
      <header className={styles.header}>
        <h1 className={styles.title}>
          <button className={styles.titleButton} title="全体を表示" onClick={() => close(true)}>
            <span className={styles.titlePart}>日本語語彙スカイサーベイ</span>
            <span className={styles.titlePart}>（β版）</span>
          </button>
        </h1>
        <nav className={styles.nav}>
          {away && (
            <button className={`${ui.button} ${styles.navButton}`} onClick={() => close(true)}>
              全体を表示
            </button>
          )}
          <button className={`${ui.button} ${styles.navButton}`} onClick={() => setAbout(true)}>
            このデータについて
          </button>
        </nav>
      </header>
      {panel && <Panel panel={panel} onPick={(w) => void open(fetchWord(`/api/neighbors/${w.id}`))} />}
      <div className={styles.legend}>
        <span className={styles.legendTitle}>凡例</span>
        <br />
        色：品詞
        <br />
        {POS_NAMES.map((p, i) => (
          <span key={p}>
            <b className={ui.chip} style={{ background: posColor(i) }} />
            {p}
            <br />
          </span>
        ))}
        明るさ: よく使われる語ほど明るい
      </div>
      {msg && <div className={styles.msg}>{msg}</div>}
      <div className={styles.bar}>
        <input
          className={styles.input}
          ref={inputRef}
          placeholder="語で検索（例: 深夜ラジオ）"
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            const text = e.currentTarget.value.trim();
            if (text) void search(text);
          }}
        />
        <button className={`${ui.button} ${styles.surprise}`} onClick={surprise}>
          面白い語<span className={styles.wide}>から始める</span>
          <span className={styles.narrow}>へ</span>
        </button>
      </div>
      {about && <About onClose={() => setAbout(false)} />}
    </>
  );
}
