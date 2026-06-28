# Clustal Omega WebAssembly Runtime

This directory contains Clustal Omega 1.2.4 compiled to WebAssembly for the browser Sequence Alignment tool.

## Artifacts

- `clustalo.js` - Emscripten module loader.
- `clustalo.wasm` - Clustal Omega executable compiled to WebAssembly.
- `COPYING.clustal-omega` - Clustal Omega GPL license text from the source tree.
- `COPYING.argtable2` - argtable2 LGPL license text from the dependency source tree.

## Build Inputs

- Clustal Omega source mirror: `https://github.com/hybsearch/clustalo.git`
- Source commit used here: `156170778fac6f741eb31d2aabe930a837eccf68`
- argtable2 source: `http://prdownloads.sourceforge.net/argtable/argtable2-13.tar.gz`
- argtable2 sha256: `8f77e8a7ced5301af6e22f47302fdbc3b1ff41f2b83c43c77ae5ca041771ddbf`
- Emscripten SDK: `6.0.1`

The original Clustal Omega package recipe historically pointed to `http://www.clustal.org/omega/clustal-omega-1.2.4.tar.gz`, but that URL returned non-source HTML during this build, so the GitHub source mirror above was used.

## Artifact Checksums

- `clustalo.js`: `63534800c4d443932e083574f41e421d12b17ed8eb25c55c5aa2b35560ff37a3`
- `clustalo.wasm`: `4031554bfe9e857b774868b1f1a56da490abf676b6b0718021a12e65a3b29d3c`
