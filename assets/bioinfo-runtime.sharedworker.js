"use strict";

const PYODIDE_VERSION = "0.28.3";
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PYODIDE_SCRIPT = PYODIDE_INDEX + "pyodide.js";
const ASSET_BASE = new URL("./", self.location.href);
const PY_MODULE_URL = new URL("py/biotools.py", ASSET_BASE).href;
const CLUSTALO_SCRIPT = new URL("vendor/clustalo/clustalo.js", ASSET_BASE).href;
const CLUSTALO_WASM_BASE = new URL("vendor/clustalo/", ASSET_BASE).href;

let pyodidePromise = null;
let clustalFactoryPromise = null;
let preloadPromise = null;
const ports = new Set();

function broadcast(message) {
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch (err) {
      ports.delete(port);
    }
  }
}

async function ensurePyodide() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      broadcast({ type: "status", status: "python-loading", message: "Loading" });
      if (!self.loadPyodide) importScripts(PYODIDE_SCRIPT);
      const pyodide = await self.loadPyodide({ indexURL: PYODIDE_INDEX });
      await pyodide.loadPackage("biopython");
      const codeResponse = await fetch(PY_MODULE_URL);
      if (!codeResponse.ok) throw new Error("Could not load the local Biopython tool module.");
      await pyodide.runPythonAsync(await codeResponse.text());
      broadcast({ type: "status", status: "python-ready", message: "Ready" });
      return pyodide;
    })().catch((err) => {
      pyodidePromise = null;
      throw err;
    });
  }
  return pyodidePromise;
}

async function loadClustalFactory() {
  if (!clustalFactoryPromise) {
    clustalFactoryPromise = (async () => {
      broadcast({ type: "status", status: "clustal-loading", message: "Loading" });
      if (!self.createClustalOmegaModule) importScripts(CLUSTALO_SCRIPT);
      if (!self.createClustalOmegaModule) {
        throw new Error("The Clustal Omega runtime loaded, but did not expose its module factory.");
      }
      broadcast({ type: "status", status: "clustal-ready", message: "Ready" });
      return self.createClustalOmegaModule;
    })().catch((err) => {
      clustalFactoryPromise = null;
      throw err;
    });
  }
  return clustalFactoryPromise;
}

async function preload() {
  if (!preloadPromise) {
    preloadPromise = Promise.allSettled([ensurePyodide(), loadClustalFactory()]).then((results) => {
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length) {
        throw new Error(failures.map((failure) => failure.reason && failure.reason.message ? failure.reason.message : String(failure.reason)).join("; "));
      }
      broadcast({ type: "status", status: "ready", message: "Ready" });
      return { ready: true };
    }).catch((err) => {
      preloadPromise = null;
      throw err;
    });
  }
  return preloadPromise;
}

async function runPythonTool(payload) {
  const pyodide = await ensurePyodide();
  const runner = pyodide.globals.get("run_tool");
  try {
    const raw = runner(payload.toolName, JSON.stringify(payload.payload || {}));
    const envelope = JSON.parse(raw);
    if (!envelope.ok) throw new Error(envelope.error || "Biopython returned an error.");
    return envelope.result;
  } finally {
    runner.destroy && runner.destroy();
  }
}

function parseFasta(text) {
  const records = [];
  let current = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(">")) {
      current = { name: line.slice(1).trim() || "Sequence " + (records.length + 1), parts: [] };
      records.push(current);
    } else {
      if (!current) {
        current = { name: "Sequence " + (records.length + 1), parts: [] };
        records.push(current);
      }
      current.parts.push(line.replace(/\s+/g, ""));
    }
  }
  const parsed = records.map((record) => ({ name: record.name, sequence: record.parts.join("").toUpperCase() })).filter((record) => record.sequence.length > 0);
  if (parsed.length < 2) throw new Error("Paste at least two FASTA sequences.");
  for (const record of parsed) {
    if (!/^[A-Z*.?-]+$/.test(record.sequence)) {
      throw new Error(record.name + " contains characters that are not valid sequence symbols.");
    }
  }
  return parsed;
}

function parseClustal(text) {
  const order = [];
  const chunks = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^CLUSTAL/i.test(trimmed)) continue;
    if (/^[*:.| ]+$/.test(trimmed)) continue;
    const match = line.match(/^(\S+)\s+([A-Za-z*.-]+)(?:\s+\d+)?\s*$/);
    if (!match) continue;
    const name = match[1];
    const chunk = match[2];
    if (!chunks.has(name)) {
      chunks.set(name, []);
      order.push(name);
    }
    chunks.get(name).push(chunk);
  }
  return order.map((name) => ({ name, sequence: chunks.get(name).join("") }));
}

async function runClustal(payload) {
  const input = String(payload.input || "");
  const sequenceType = payload.sequenceType || "auto";
  const outputOrder = payload.outputOrder || "input-order";
  const wrap = Math.max(20, Math.min(120, Number(payload.wrap) || 60));
  const inputRecords = parseFasta(input);
  const createModule = await loadClustalFactory();
  const stdout = [];
  const stderr = [];
  const module = await createModule({
    locateFile: (path) => new URL(path, CLUSTALO_WASM_BASE).href,
    print: (text) => stdout.push(text),
    printErr: (text) => stderr.push(text)
  });
  module.FS.writeFile("input.fa", input);
  const args = [
    "--infile=input.fa",
    "--outfmt=clu",
    "--wrap=" + wrap,
    "--threads=1",
    "--output-order=" + outputOrder
  ];
  if (sequenceType !== "auto") args.push("--seqtype=" + sequenceType);
  const status = module.callMain(args);
  const output = stdout.join("\n").trim();
  if (status !== 0 || !output) {
    throw new Error((stderr.join("\n") || "Clustal Omega did not return an alignment.").trim());
  }
  const alignedRecords = parseClustal(output);
  return {
    inputRecords,
    alignedRecords,
    output,
    alignmentLength: alignedRecords[0] ? alignedRecords[0].sequence.length : 0,
    sequenceType,
    outputOrder,
    wrap
  };
}

async function handleRequest(type, payload) {
  if (type === "ping") return { ready: Boolean(pyodidePromise || clustalFactoryPromise) };
  if (type === "preload") return preload();
  if (type === "run-python") return runPythonTool(payload || {});
  if (type === "run-clustal") return runClustal(payload || {});
  throw new Error("Unknown runtime request: " + type);
}

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.add(port);
  port.onmessage = async (messageEvent) => {
    const message = messageEvent.data || {};
    if (!message.id) return;
    try {
      const result = await handleRequest(message.type, message.payload);
      port.postMessage({ id: message.id, ok: true, result });
    } catch (err) {
      port.postMessage({ id: message.id, ok: false, error: err && err.message ? err.message : String(err) });
    }
  };
  port.start();
  port.postMessage({ type: "status", status: "connected", message: "Connected" });
};
