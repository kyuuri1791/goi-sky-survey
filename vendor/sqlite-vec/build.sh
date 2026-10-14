#!/bin/sh
# sqlite-vec 0.1.9 に int8-cosine.patch を当てて、Linux x64 用の vec0.so を作る(sh vendor/sqlite-vec/build.sh)。
# 新しい glibc の関数に頼らないよう、Debian 12(glibc 2.36)の中でビルドする。SSE4.2 まで(x86-64-v2)の命令を使う
set -eu
cd "$(dirname "$0")"
docker run --rm -v "$PWD:/out" -w /tmp debian:bookworm-slim sh -c '
  set -eu
  apt-get update -qq && apt-get install -y -qq --no-install-recommends gcc libc6-dev libsqlite3-dev make gettext-base git ca-certificates patch >/dev/null
  git clone -q --depth 1 --branch v0.1.9 https://github.com/asg017/sqlite-vec.git src && cd src
  patch -p0 < /out/int8-cosine.patch
  make -s sqlite-vec.h
  gcc -fPIC -shared -O3 -march=x86-64-v2 sqlite-vec.c -o /out/vec0.so -lm
  chown "$(stat -c %u:%g /out)" /out/vec0.so
'
