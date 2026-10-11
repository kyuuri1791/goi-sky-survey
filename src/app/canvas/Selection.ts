// 選んだ語と近い語（地図の目印）。目印を薄くして消している途中かどうかも持つ
import type { Word } from "@/shared/types.ts";

/** 目印を薄くして消すのにかける時間 */
const FADE_MS = 800;

export class Selection {
  /** 選んだ語（タイルを読む前でも位置が分かるように、API の結果をそのまま持つ）。null なら選んでいない */
  word: Word | null = null;
  neighbors: Word[] = [];
  /** 目印を薄くして消し始めた時刻。null なら消していない */
  private fadeStart: number | null = null;

  set(w: Word, neighbors: Word[]) {
    this.fadeStart = null;
    this.word = w;
    this.neighbors = neighbors;
  }

  clear() {
    this.word = null;
    this.neighbors = [];
    this.fadeStart = null;
  }

  /** 目印を薄くして消し始める（何も選んでいなければ何もしない） */
  fadeOut() {
    if (this.word) this.fadeStart = performance.now();
  }

  /** 目印の濃さ（1 ならそのまま）。消し終わっていたら目印を外す */
  opacity() {
    const fade = this.fadeStart === null ? 1 : Math.max(0, 1 - (performance.now() - this.fadeStart) / FADE_MS);
    if (fade === 0) this.clear();
    return fade;
  }

  /** 選んだ語と近い語（選んでいなければ空） */
  get marks(): Word[] {
    return this.word ? [this.word, ...this.neighbors] : [];
  }
}
