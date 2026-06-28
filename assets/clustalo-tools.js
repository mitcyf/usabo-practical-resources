(() => {
  "use strict";

  const CURRENT_SCRIPT = document.currentScript;
  const ASSET_BASE = new URL("./", CURRENT_SCRIPT.src);
  const CLUSTALO_SCRIPT = new URL("vendor/clustalo/clustalo.js", ASSET_BASE).href;
  const CLUSTALO_WASM_BASE = new URL("vendor/clustalo/", ASSET_BASE).href;

  let loaderPromise = null;
  let latestText = "";

  function byId(id) {
    return document.getElementById(id);
  }

  function valueOf(id) {
    const element = byId(id);
    return element ? element.value : "";
  }

  function showMessage(text, type) {
    const box = byId("tool-message");
    if (!box) return;
    box.textContent = text || "";
    box.className = text ? "message " + type : "message";
  }

  function setDisabled(disabled) {
    for (const button of document.querySelectorAll("button")) button.disabled = disabled;
  }

  function showResults() {
    const section = byId("tool-results");
    if (section) section.style.display = "block";
  }

  function hideResults() {
    const section = byId("tool-results");
    if (section) section.style.display = "none";
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.createClustalOmegaModule) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load the Clustal Omega runtime."));
      document.head.appendChild(script);
    });
  }

  async function loadClustalOmega() {
    if (!loaderPromise) {
      loaderPromise = loadScript(CLUSTALO_SCRIPT);
    }
    await loaderPromise;
    if (!window.createClustalOmegaModule) {
      throw new Error("The Clustal Omega runtime loaded, but did not expose its module factory.");
    }
    return window.createClustalOmegaModule;
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

    const parsed = records.map((record) => ({
      name: record.name,
      sequence: record.parts.join("").toUpperCase()
    })).filter((record) => record.sequence.length > 0);

    if (parsed.length < 2) {
      throw new Error("Paste at least two FASTA sequences.");
    }

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

  function appendCell(row, value, tagName) {
    const cell = document.createElement(tagName || "td");
    cell.textContent = value == null ? "" : String(value);
    row.appendChild(cell);
    return cell;
  }

  function renderSummary(items) {
    const container = byId("alignment-summary");
    if (!container) return;
    container.textContent = "";
    for (const item of items) {
      const box = document.createElement("div");
      const label = document.createElement("div");
      const value = document.createElement("div");
      box.className = "summary-item";
      label.className = "label";
      value.className = "value";
      label.textContent = item.label;
      value.textContent = item.value;
      box.append(label, value);
      container.appendChild(box);
    }
  }

  function renderIdentityTable(records) {
    const container = byId("alignment-table");
    if (!container) return;
    container.textContent = "";
    if (records.length === 0) return;

    const reference = records[0].sequence;
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    const header = document.createElement("tr");

    for (const label of ["Sequence", "Aligned length", "Identity to first sequence"]) {
      appendCell(header, label, "th");
    }
    thead.appendChild(header);

    for (const record of records) {
      let matches = 0;
      let comparable = 0;
      for (let i = 0; i < reference.length && i < record.sequence.length; i++) {
        const a = reference[i];
        const b = record.sequence[i];
        if (a === "-" && b === "-") continue;
        comparable++;
        if (a === b) matches++;
      }
      const row = document.createElement("tr");
      const identity = comparable > 0 ? (matches / comparable) * 100 : 0;
      appendCell(row, record.name);
      appendCell(row, record.sequence.length);
      appendCell(row, identity.toFixed(2) + "%");
      tbody.appendChild(row);
    }

    table.append(thead, tbody);
    container.appendChild(table);
  }

  async function runAlignment() {
    const input = valueOf("alignment-input");
    const sequenceType = valueOf("align-seqtype") || "auto";
    const outputOrder = valueOf("align-output-order") || "input-order";
    const wrap = Math.max(20, Math.min(120, Number(valueOf("align-wrap")) || 60));

    parseFasta(input);

    showMessage("Loading Clustal Omega and aligning sequences.", "ok");
    setDisabled(true);

    try {
      const createModule = await loadClustalOmega();
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
      const alignmentLength = alignedRecords[0] ? alignedRecords[0].sequence.length : 0;

      byId("alignment-output").textContent = output;
      renderSummary([
        { label: "Method", value: "Clustal Omega 1.2.4" },
        { label: "Sequences", value: alignedRecords.length },
        { label: "Aligned length", value: alignmentLength },
        { label: "Sequence type", value: sequenceType === "auto" ? "Auto" : sequenceType }
      ]);
      renderIdentityTable(alignedRecords);

      latestText = output;
      showResults();
      showMessage("Alignment completed with Clustal Omega.", "ok");
    } catch (err) {
      hideResults();
      latestText = "";
      showMessage(err.message || String(err), "error");
    } finally {
      setDisabled(false);
    }
  }

  async function copyResults() {
    if (!latestText) {
      showMessage("No results to copy yet. Run the alignment first.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(latestText);
      showMessage("Results copied to clipboard.", "ok");
    } catch (err) {
      showMessage("Could not copy automatically. Select and copy the alignment manually.", "error");
    }
  }

  function clearTool() {
    const input = byId("alignment-input");
    if (input) input.value = "";
    latestText = "";
    hideResults();
    showMessage("", "");
    for (const id of ["alignment-summary", "alignment-output", "alignment-table"]) {
      const element = byId(id);
      if (element) element.textContent = "";
    }
  }

  function init() {
    const runButton = byId("run-tool");
    const clearButton = byId("clear-tool");
    const copyButton = byId("copy-results");
    if (runButton) runButton.addEventListener("click", runAlignment);
    if (clearButton) clearButton.addEventListener("click", clearTool);
    if (copyButton) copyButton.addEventListener("click", copyResults);
  }

  init();
})();
