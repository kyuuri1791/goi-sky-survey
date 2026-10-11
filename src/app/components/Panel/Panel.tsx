import { posColor, posName } from "@/app/styles/pos.ts";
import ui from "@/app/styles/ui.module.css";
import type { Word, WordResult } from "@/shared/types.ts";
import styles from "./Panel.module.css";

export type PanelData = WordResult & { query: string };
export default function Panel({ panel, onPick }: { panel: PanelData; onPick: (w: Word) => void }) {
  const intent = new URL("https://x.com/intent/tweet");
  intent.searchParams.set("text", `「${panel.query}」の使われ方の近い語｜日本語語彙スカイサーベイ`);
  intent.searchParams.set("url", `${location.origin}/?w=${encodeURIComponent(panel.query)}`);

  return (
    <div className={styles.panel}>
      {panel.composite && <div className={styles.kind}>{panel.composite.map((w) => w.text).join(" ＋ ")} に近い語</div>}
      <div className={styles.head}>
        <h2 className={styles.word} style={{ color: posColor(panel.word.pos) }}>{panel.word.text}</h2>
        <a className={`${ui.button} ${styles.share}`} href={intent.href} target="_blank">
          Xで共有
        </a>
      </div>
      <dl className={styles.facts}>
        <dt className={styles.factLabel}>頻度順位</dt>
        <dd className={styles.factValue}>#{panel.word.rank.toLocaleString()}</dd>
        <dt className={styles.factLabel}>品詞</dt>
        <dd className={styles.factValue}>
          <b className={ui.chip} style={{ background: posColor(panel.word.pos) }} />
          {posName(panel.word.pos)}
        </dd>
      </dl>
      <h3 className={styles.heading}>使われ方の近い語</h3>
      {panel.neighbors.map((w) => (
        <button key={w.id} className={styles.neighbor} onClick={() => onPick(w)}>
          <span>
            <b className={ui.chip} style={{ background: posColor(w.pos) }} />
            {w.text}
          </span>
          <span className={styles.score}>{w.score?.toFixed(2)}</span>
        </button>
      ))}
    </div>
  );
}
