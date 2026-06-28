#!/usr/bin/env bash
set -euo pipefail

BUILD_DIR="${BUILD_DIR:-/tmp/clustalo-wasm-build}"
EMSDK_DIR="${EMSDK_DIR:-/tmp/emsdk}"
CLUSTALO_REPO="https://github.com/hybsearch/clustalo.git"
CLUSTALO_COMMIT="156170778fac6f741eb31d2aabe930a837eccf68"
ARGTABLE_URL="http://prdownloads.sourceforge.net/argtable/argtable2-13.tar.gz"
ARGTABLE_SHA256="8f77e8a7ced5301af6e22f47302fdbc3b1ff41f2b83c43c77ae5ca041771ddbf"
OUT_DIR="${OUT_DIR:-assets/vendor/clustalo}"
REPO_ROOT="$(pwd)"

mkdir -p "$BUILD_DIR" "$REPO_ROOT/$OUT_DIR"

if [ ! -d "$EMSDK_DIR/.git" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
fi

"$EMSDK_DIR/emsdk" install 6.0.1
"$EMSDK_DIR/emsdk" activate 6.0.1
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null

cd "$BUILD_DIR"
curl -L -o argtable2-13.tar.gz "$ARGTABLE_URL"
echo "$ARGTABLE_SHA256  argtable2-13.tar.gz" | sha256sum -c -
rm -rf argtable2-13 sysroot
tar -xzf argtable2-13.tar.gz
cd argtable2-13
emconfigure ./configure --prefix="$BUILD_DIR/sysroot" --disable-shared --enable-static
emmake make -j2 CFLAGS='-g -O2 -include ctype.h'
emmake make install

cd "$BUILD_DIR"
rm -rf clustalo
git clone "$CLUSTALO_REPO" clustalo
cd clustalo
git checkout "$CLUSTALO_COMMIT"

emconfigure ./configure \
  --prefix="$BUILD_DIR/clustalo-install" \
  --disable-dependency-tracking \
  --without-openmp \
  CPPFLAGS="-I$BUILD_DIR/sysroot/include" \
  LDFLAGS="-L$BUILD_DIR/sysroot/lib" \
  LIBS='-largtable2'

touch aclocal.m4 configure Makefile.in src/Makefile.in \
  src/clustal/Makefile.in src/hhalign/Makefile.in \
  src/kmpp/Makefile.in src/squid/Makefile.in

emmake make -j2

cd src
em++ -O3 \
  -sSTACK_SIZE=8388608 \
  -sINITIAL_MEMORY=134217728 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createClustalOmegaModule \
  -sENVIRONMENT=web,worker,node \
  -sINVOKE_RUN=0 \
  -sEXIT_RUNTIME=0 \
  -sFORCE_FILESYSTEM=1 \
  -sEXPORTED_RUNTIME_METHODS='["callMain","FS"]' \
  -o "$REPO_ROOT/$OUT_DIR/clustalo.js" \
  main.o mymain.o ./.libs/libclustalo.a "$BUILD_DIR/sysroot/lib/libargtable2.a" -lm

cp "$BUILD_DIR/clustalo/COPYING" "$REPO_ROOT/$OUT_DIR/COPYING.clustal-omega"
cp "$BUILD_DIR/argtable2-13/COPYING" "$REPO_ROOT/$OUT_DIR/COPYING.argtable2"
sha256sum "$REPO_ROOT/$OUT_DIR/clustalo.js" "$REPO_ROOT/$OUT_DIR/clustalo.wasm"
