// 意味の近い語を探す索引（IVF-PQ）。pipeline/index.py で作った data/index.bin と data/rerank-*.bin を使う。
//
// IVF: 語をグループに分けておき、問い合わせに近い nprobe グループの中だけ調べる
// PQ:  各語のベクトル（グループの中心からのずれ）を区切りごとの代表の番号（1 バイト × M）で持ち、
//      類似度を「区切りごとの表を引いて足すだけ」で見積もる
// 見積もりで上位 rerank 件に残った候補だけ、1 バイトに丸めたベクトル（rerank-*.bin）をファイルから読んで計算し直す。
//
// index.bin の形式（リトルエンディアン）:
//   u32 × 8   マジック "IVQ1"、語数 n、次元 DIM、グループ数 NLIST、区切り数 M、代表の数 KS、予約 × 2
//   f32[NLIST × DIM]        グループの中心
//   f32[M × KS × DIM/M]     区切りごとの代表
//   u32[NLIST + 1]          グループごとの始まり（order の位置）
//   u32[n]                  グループ順に並べた語の番号
//   u8[n × M]               order の順の PQ の番号
// rerank-*.bin: 語ごとに f32 倍率 ＋ i8 × DIM。前から順に分けてある（どのファイルも、最後以外は同じ語数）
import fs from "node:fs";

const MAGIC = 0x31515649;

export type Hit = { id: number; score: number };

/** ファイルを最後まで読み流す。1 MB の入れ物を使い回すので、ファイルが大きくてもメモリは増えない */
async function warmUp(paths: string[]) {
  const buf = Buffer.alloc(1 << 20);
  for (const p of paths) {
    const fh = await fs.promises.open(p);
    try {
      while ((await fh.read(buf, 0, buf.length, null)).bytesRead > 0);
    } finally {
      await fh.close();
    }
  }
}

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
  private readonly rerankFds: number[];
  /** 並べ直し用の 1 ファイルあたりの語数 */
  private readonly perFile: number;
  private readonly row: Buffer;

  constructor(indexPath: string, rerankPaths: string[]) {
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
    this.row = Buffer.alloc(4 + this.dim);
    this.rerankFds = rerankPaths.map((p) => fs.openSync(p, "r"));
    this.perFile = fs.statSync(rerankPaths[0]).size / this.row.length;
    // デプロイ先ではファイルの各部分を初めて読むときに遅く、拾い読みする検索が最初だけ 1 秒以上かかる。
    // 起動したら裏で一度最後まで読み流しておく（読んだ中身は捨てるので、メモリはほとんど増えない）
    warmUp(rerankPaths).catch(() => {}); // 失敗しても検索はできる（最初だけ遅いまま）ので無視する
  }

  /** 語 id の並べ直し用の行（倍率と丸めたベクトル）を this.row に読む */
  private readRow(id: number) {
    const f = Math.floor(id / this.perFile);
    fs.readSync(this.rerankFds[f], this.row, 0, this.row.length, (id - f * this.perFile) * this.row.length);
  }

  /** 語 id のベクトル（1 バイトに丸めたものを戻す） */
  vector(id: number): Float32Array {
    this.readRow(id);
    const s = this.row.readFloatLE(0);
    const v = new Float32Array(this.dim);
    for (let d = 0; d < this.dim; d++) v[d] = this.row.readInt8(4 + d) * s;
    return v;
  }

  /**
   * q に意味の近い上位 k 語。exclude の語は除く。
   * nprobe: 調べるグループの数、rerank: 計算し直す候補の数（測定では nprobe 32・候補 100 で上位 10 語の 92% が一致）
   */
  search(q: Float32Array, k: number, exclude: Set<number> = new Set(), nprobe = 32, rerank = 100): Hit[] {
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
    // 3. 見積もりで候補を集める（小さい方から捨てる）
    const cand: Hit[] = [];
    let worst = -Infinity;
    for (const c of lists) {
      for (let j = this.start[c]; j < this.start[c + 1]; j++) {
        const id = this.order[j];
        if (exclude.has(id)) continue;
        let s = cs[c];
        const o = j * m;
        for (let mm = 0; mm < m; mm++) s += lut[mm * ks + this.codes[o + mm]];
        if (cand.length < rerank || s > worst) {
          cand.push({ id, score: s });
          if (cand.length > rerank * 2) {
            cand.sort((a, b) => b.score - a.score);
            cand.length = rerank;
            worst = cand[rerank - 1].score;
          }
        }
      }
    }
    cand.sort((a, b) => b.score - a.score);
    cand.length = Math.min(cand.length, rerank);
    // 4. 計算し直す
    let qn = 0;
    for (let d = 0; d < dim; d++) qn += q[d] * q[d];
    qn = Math.sqrt(qn) || 1;
    const out = cand.map(({ id }) => {
      this.readRow(id);
      const s = this.row.readFloatLE(0);
      let t = 0;
      for (let d = 0; d < dim; d++) t += q[d] * this.row.readInt8(4 + d);
      return { id, score: (t * s) / qn };
    });
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, k);
  }
}
