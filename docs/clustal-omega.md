# Clustal Omega Alignment Plan

The Sequence Alignment page should prefer the bundled browser runtime in `assets/vendor/clustalo/`. It is real Clustal Omega 1.2.4 compiled to WebAssembly, so GitHub Pages can run alignments without a server.

## Browser Runtime

- Runs entirely in the browser with Emscripten MEMFS.
- Inputs are written to a virtual FASTA file and passed to `clustalo` with `--infile=input.fa --outfmt=clu --threads=1`.
- Output is captured from stdout and rendered as CLUSTAL text.
- Current build uses a larger initial memory and stack because the default Emscripten memory settings crashed during real alignment calls.

## EBI Backup

If the bundled runtime becomes too heavy or fails on a browser we care about, use EMBL-EBI Job Dispatcher as the backup route for Clustal Omega. The service is documented at <https://www.ebi.ac.uk/jdispatcher/docs/> and includes programmatic access, but it should be treated as an external service with network dependence, fair-use constraints, and privacy/CORS considerations.

## Preloading Notes

Cookies are not useful for preloading. They are sent with HTTP requests and are size-limited; they do not keep WebAssembly, Pyodide, or Biopython initialized.

Useful preload mechanisms are:

- Browser HTTP cache, warmed with `<link rel="prefetch">` or an idle-time loader.
- A service worker cache for same-origin assets.
- A single-page app shell if we want Pyodide/Biopython to stay alive between tools.

For now, the tools index should prefetch the Clustal Omega JS/WASM and can idle-load Biopython if first-visit latency becomes annoying.
