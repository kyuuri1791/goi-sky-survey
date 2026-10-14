// 1 バイトに丸めたベクトルの内積を、16 バイトずつまとめて計算する(WebAssembly の SIMD)。npm run wasm で dots.wasm にする
#include <wasm_simd128.h>

/** 1 語のバイト数(300 次元の後ろを 0 で埋めて 16 の倍数にしたもの。pipeline/vectors.py の STRIDE と合わせる) */
#define STRIDE 304

static int sum4(v128_t x) {
  return wasm_i32x4_extract_lane(x, 0) + wasm_i32x4_extract_lane(x, 1) + wasm_i32x4_extract_lane(x, 2) + wasm_i32x4_extract_lane(x, 3);
}

/** q と、v に並んだ n 語それぞれとの内積を out に、各語の自分自身との内積(長さの 2 乗)を sq に書く */
__attribute__((export_name("dots"))) void dots(const signed char *q, const signed char *v, int n, int *out, int *sq) {
  for (int i = 0; i < n; i++) {
    const signed char *p = v + i * STRIDE;
    v128_t acc = wasm_i32x4_splat(0), self = wasm_i32x4_splat(0);
    for (int k = 0; k < STRIDE; k += 16) {
      v128_t a = wasm_v128_load(q + k), b = wasm_v128_load(p + k);
      v128_t al = wasm_i16x8_extend_low_i8x16(a), ah = wasm_i16x8_extend_high_i8x16(a);
      v128_t bl = wasm_i16x8_extend_low_i8x16(b), bh = wasm_i16x8_extend_high_i8x16(b);
      acc = wasm_i32x4_add(acc, wasm_i32x4_add(wasm_i32x4_dot_i16x8(al, bl), wasm_i32x4_dot_i16x8(ah, bh)));
      self = wasm_i32x4_add(self, wasm_i32x4_add(wasm_i32x4_dot_i16x8(bl, bl), wasm_i32x4_dot_i16x8(bh, bh)));
    }
    out[i] = sum4(acc);
    sq[i] = sum4(self);
  }
}
