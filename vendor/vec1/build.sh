#!/bin/sh
# SQLite の vec1(ベクトルの近傍検索)を、Linux x64 用の vec1.so にする(sh vendor/vec1/build.sh)。
# vec1.c は中身のハッシュで取ってくる(版 0.8)。ヘッダーは、パイプラインの Python と同じ SQLite 3.46 のものを使う。
# Debian 12 の中でビルドし、pthread の関数は古い glibc にもある版を使う(新しい glibc に頼らないように)。
# AVX2 のある CPU ではそれを使い、なければ使わない(vec1 の Makefile の vec1multi.so と同じ作り方)
set -eu
cd "$(dirname "$0")"
docker run --rm -i -v "$PWD:/out" -w /tmp -e VEC1=ef90ba7178fbb02a33165f40f3a9ca0893bb397c992a844e34d2f655e60743ba debian:bookworm-slim sh -s <<'EOF'
set -eu
apt-get update -qq && apt-get install -y -qq --no-install-recommends gcc libc6-dev curl unzip ca-certificates >/dev/null
curl -sSfL -o vec1.c "https://sqlite.org/src/raw/$VEC1"
curl -sSfL -o sqlite.zip https://sqlite.org/2024/sqlite-amalgamation-3460100.zip && unzip -qj sqlite.zip '*/sqlite3.h' '*/sqlite3ext.h'
cat > old.h <<'H'
__asm__(".symver pthread_create,pthread_create@GLIBC_2.2.5");
__asm__(".symver pthread_join,pthread_join@GLIBC_2.2.5");
H
gcc -DVEC1SIMD=SCALAR -c -O3 -DNDEBUG -fPIC -I. -include old.h vec1.c -o scalar.o
gcc -DVEC1SIMD=AVX2 -c -O3 -DNDEBUG -fPIC -I. -include old.h -mavx2 -mfma vec1.c -o avx2.o
gcc scalar.o avx2.o -shared -o /out/vec1.so -lm -lpthread
chown "$(stat -c %u:%g /out)" /out/vec1.so
EOF
