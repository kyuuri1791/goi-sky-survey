// 意味の近い語を探す索引（IVF-PQ）。pipeline/index.py で作った data/index.bin を使う。複合語の検索に使う。
//
// IVF: 語をグループに分けておき、問い合わせに近い nprobe グループの中だけ調べる
// PQ:  各語のベクトル（グループの中心からのずれ）を区切りごとの代表の番号（1 バイト × M）で持ち、
//      類似度を「区切りごとの表を引いて足すだけ」で見積もる
// すべてメモリの上で済ませる（デプロイ先ではファイルを拾い読みすると、初めて読む所ごとに遅くなるため）。
//
// index.bin の形式（リトルエンディアン）:
//   u32 × 8   マジック "IVQ1"、語数 n、次元 DIM、グループ数 NLIST、区切り数 M、代表の数 KS、予約 × 2
//   f32[NLIST × DIM]        グループの中心
//   f32[M × KS × DIM/M]     区切りごとの代表
//   u32[NLIST + 1]          グループごとの始まり（order の位置）
//   u32[n]                  グループ順に並べた語の番号
//   u8[n × M]               order の順の PQ の番号
import fs from "node:fs";

const MAGIC = 0x31515649;

export type Hit = { id: number; score: number };

export class IvfPq {
  readonly n: number;
  readonly dim: number;
  private readonly nlist: number;
  private readonly m: number;
  private readonly ks: number;
  private readonly sub: number;
  private readonly coarse: Float32Array;
  private readonly books: Float32Array;
  private readonly start: Uint32Array;
  private readonly order: Uint32Array;
  private readonly codes: Uint8Array;
  /** 語の番号 → order の位置と、入っているグループ */
  private readonly posOf: Uint32Array;
  private readonly listOf: Uint16Array;

  constructor(indexPath: string) {
    const buf = fs.readFileSync(indexPath);
    const bytes = buf.byteOffset % 4 === 0 ? buf : Buffer.from(buf);
    const h = new Uint32Array(bytes.buffer, bytes.byteOffset, 8);
    if (h[0] !== MAGIC) throw new Error("索引の形式が違います");
    [, this.n, this.dim, this.nlist, this.m, this.ks] = h;
    this.sub = this.dim / this.m;
    let off = bytes.byteOffset + 32;
    const take = <T>(make: (o: number) => T, size: number): T => {
      const v = make(off);
      off += size;
      return v;
    };
    this.coarse = take((o) => new Float32Array(bytes.buffer, o, this.nlist * this.dim), this.nlist * this.dim * 4);
    this.books = take((o) => new Float32Array(bytes.buffer, o, this.m * this.ks * this.sub), this.m * this.ks * this.sub * 4);
    this.start = take((o) => new Uint32Array(bytes.buffer, o, this.nlist + 1), (this.nlist + 1) * 4);
    this.order = take((o) => new Uint32Array(bytes.buffer, o, this.n), this.n * 4);
    this.codes = new Uint8Array(bytes.buffer, off, this.n * this.m);
    this.posOf = new Uint32Array(this.n);
    this.listOf = new Uint16Array(this.n);
    for (let c = 0; c < this.nlist; c++) {
      for (let j = this.start[c]; j < this.start[c + 1]; j++) {
        this.posOf[this.order[j]] = j;
        this.listOf[this.order[j]] = c;
      }
    }
  }

  /** 語 id のベクトル（グループの中心と、区切りごとの代表から組み立てた近似） */
  vector(id: number): Float32Array {
    const { dim, m, ks, sub } = this;
    const v = this.coarse.slice(this.listOf[id] * dim, (this.listOf[id] + 1) * dim);
    const o = this.posOf[id] * m;
    for (let mm = 0; mm < m; mm++) {
      const bo = (mm * ks + this.codes[o + mm]) * sub;
      for (let d = 0; d < sub; d++) v[mm * sub + d] += this.books[bo + d];
    }
    return v;
  }

  /**
   * q に意味の近い上位 k 語（PQ の見積もりで決める）。exclude の語は除く。nprobe: 調べるグループの数。
   * score は q との cos 類似度の見積もり
   */
  search(q: Float32Array, k: number, exclude: Set<number> = new Set(), nprobe = 32): Hit[] {
    const { dim, nlist, m, ks, sub } = this;
    // 1. 近いグループ
    const cs = new Float32Array(nlist);
    for (let c = 0; c < nlist; c++) {
      let s = 0;
      const o = c * dim;
      for (let d = 0; d < dim; d++) s += q[d] * this.coarse[o + d];
      cs[c] = s;
    }
    const lists = Array.from({ length: nlist }, (_, c) => c)
      .sort((a, b) => cs[b] - cs[a])
      .slice(0, nprobe);
    // 2. 区切りごとの表: q_m · 代表
    const lut = new Float32Array(m * ks);
    for (let mm = 0; mm < m; mm++) {
      for (let c = 0; c < ks; c++) {
        let s = 0;
        const bo = (mm * ks + c) * sub;
        for (let d = 0; d < sub; d++) s += q[mm * sub + d] * this.books[bo + d];
        lut[mm * ks + c] = s;
      }
    }
    // 3. 見積もりで上位 k 語を集める（小さい方から捨てる）
    const top: Hit[] = [];
    let worst = -Infinity;
    for (const c of lists) {
      for (let j = this.start[c]; j < this.start[c + 1]; j++) {
        const id = this.order[j];
        if (exclude.has(id)) continue;
        let s = cs[c];
        const o = j * m;
        for (let mm = 0; mm < m; mm++) s += lut[mm * ks + this.codes[o + mm]];
        if (top.length < k || s > worst) {
          top.push({ id, score: s });
          if (top.length > k * 4) {
            top.sort((a, b) => b.score - a.score);
            top.length = k;
            worst = top[k - 1].score;
          }
        }
      }
    }
    let qn = 0;
    for (let d = 0; d < dim; d++) qn += q[d] * q[d];
    qn = Math.sqrt(qn) || 1;
    return top
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ id, score }) => ({ id, score: score / qn }));
  }
}
