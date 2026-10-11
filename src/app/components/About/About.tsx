import ui from "@/app/styles/ui.module.css";
import styles from "./About.module.css";

export default function About({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.box}>
        <h2 className={styles.title}>このデータについて</h2>
        <h3 className={styles.heading}>何を表しているか</h3>
        <p className={styles.text}>
          日本語の単語を使われ方の近さで平面に並べたものです。各単語は、ウェブ上の大量の文章で前後に現れる語をもとに300次元のベクトルで表され、似た語に囲まれて使われる単語ほど向きが近くなります。300次元を2次元に写すときに歪みが出るため、遠く離れた点どうしの距離は必ずしも当てになりません。
        </p>
        <p className={styles.text}>
          点の明るさは単語がよく使われる度合いを、色は品詞を表します。
        </p>
        <h3 className={styles.heading}>ご注意</h3>
        <p className={styles.text}>
          このデータは、ウェブでの言葉の使われ方を統計的にそのまま写したものです。そのため、偏りのある連想や、不快に感じられる言葉が含まれることがあります。そうした言葉は確認できる範囲で取り除いていますが、すべてを取り除けているとは限りません。お気づきの点があればお知らせください。
        </p>
        <h3 className={styles.heading}>出典</h3>
        <p className={styles.credits}>
          単語ベクトル: chiVe（Works Applications, Apache License 2.0）
          <br />
          表記・品詞: SudachiDict（Works Applications, Apache License 2.0）
        </p>
        <p className={styles.actions}>
          <button className={ui.button} onClick={onClose}>
            閉じる
          </button>
        </p>
      </div>
    </div>
  );
}
