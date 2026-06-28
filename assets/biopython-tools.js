(() => {
  "use strict";

  const PYODIDE_VERSION = "0.28.3";
  const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
  const PYODIDE_SCRIPT = PYODIDE_INDEX + "pyodide.js";
  const CURRENT_SCRIPT = document.currentScript;
  const ASSET_BASE = new URL("./", CURRENT_SCRIPT.src);
  const PY_MODULE_URL = new URL("py/biotools.py", ASSET_BASE).href;

  let runtimePromise = null;
  let latestText = "";

  function byId(id) {
    return document.getElementById(id);
  }

  function valueOf(id) {
    const element = byId(id);
    return element ? element.value : "";
  }

  function checked(id) {
    const element = byId(id);
    return Boolean(element && element.checked);
  }

  function setDisabled(disabled) {
    for (const button of document.querySelectorAll("button")) button.disabled = disabled;
  }

  function showMessage(text, type) {
    const box = byId("tool-message");
    if (!box) return;
    box.textContent = text || "";
    box.className = text ? "message " + type : "message";
  }

  function clearMessage() {
    showMessage("", "");
  }

  function showResults() {
    const section = byId("tool-results");
    if (section) section.style.display = "block";
  }

  function hideResults() {
    const section = byId("tool-results");
    if (section) section.style.display = "none";
  }

  function clearOutputs() {
    latestText = "";
    hideResults();
    clearMessage();
    for (const id of ["summary", "result-table", "output", "tree-diagram", "tree-newick"]) {
      const element = byId(id);
      if (element) element.textContent = "";
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.loadPyodide) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load Pyodide from the CDN."));
      document.head.appendChild(script);
    });
  }

  async function ensureRuntime() {
    if (runtimePromise) return runtimePromise;
    runtimePromise = (async () => {
      showMessage("Loading browser Python and Biopython. First load can take a little while.", "ok");
      await loadScript(PYODIDE_SCRIPT);
      const pyodide = await window.loadPyodide({ indexURL: PYODIDE_INDEX });
      await pyodide.loadPackage("biopython");
      const codeResponse = await fetch(PY_MODULE_URL, { cache: "no-cache" });
      if (!codeResponse.ok) throw new Error("Could not load the local Biopython tool module.");
      await pyodide.runPythonAsync(await codeResponse.text());
      clearMessage();
      return pyodide;
    })();
    return runtimePromise;
  }

  async function runPythonTool(toolName, payload) {
    setDisabled(true);
    try {
      const pyodide = await ensureRuntime();
      const runner = pyodide.globals.get("run_tool");
      const raw = runner(toolName, JSON.stringify(payload || {}));
      runner.destroy && runner.destroy();
      const envelope = JSON.parse(raw);
      if (!envelope.ok) throw new Error(envelope.error || "Biopython returned an error.");
      return envelope.result;
    } finally {
      setDisabled(false);
    }
  }

  function appendCell(row, value, tagName) {
    const cell = document.createElement(tagName || "td");
    cell.textContent = value == null ? "" : String(value);
    row.appendChild(cell);
    return cell;
  }

  function renderSummary(items) {
    const container = byId("summary");
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

  function renderTable(headers, rows) {
    const container = byId("result-table");
    if (!container) return;
    container.textContent = "";
    if (!rows.length) {
      container.textContent = "No rows to display.";
      return;
    }
    const wrap = document.createElement("div");
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    const headerRow = document.createElement("tr");
    wrap.className = "table-wrap";
    for (const header of headers) appendCell(headerRow, header, "th");
    thead.appendChild(headerRow);
    for (const rowData of rows) {
      const row = document.createElement("tr");
      for (const value of rowData) appendCell(row, value);
      tbody.appendChild(row);
    }
    table.append(thead, tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  function writeOutput(text) {
    const output = byId("output");
    if (output) output.textContent = text || "";
  }

  async function copyLatest() {
    if (!latestText) {
      showMessage("No results to copy yet. Run the tool first.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(latestText);
      showMessage("Results copied to clipboard.", "ok");
    } catch (err) {
      const temp = document.createElement("textarea");
      temp.value = latestText;
      temp.setAttribute("readonly", "");
      temp.style.position = "fixed";
      temp.style.left = "-9999px";
      document.body.appendChild(temp);
      temp.select();
      try {
        document.execCommand("copy");
        showMessage("Results copied to clipboard.", "ok");
      } catch (copyErr) {
        showMessage("Could not copy automatically. Select and copy the results manually.", "error");
      } finally {
        document.body.removeChild(temp);
      }
    }
  }

  function clearTextareas() {
    for (const textarea of document.querySelectorAll("textarea")) textarea.value = "";
    clearOutputs();
  }

  function preloadRuntimeWhenIdle() {
    if (!CURRENT_SCRIPT || CURRENT_SCRIPT.dataset.preload !== "idle") return;
    const preload = () => ensureRuntime().catch(() => {
      runtimePromise = null;
    });
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(preload, { timeout: 5000 });
    } else {
      window.setTimeout(preload, 1500);
    }
  }

  function formatNumber(value, digits) {
    return Number(value).toFixed(digits == null ? 2 : digits);
  }

  async function runDnaToProtein() {
    const result = await runPythonTool("dna-to-protein", {
      sequence: valueOf("sequence-input"),
      genetic_code: Number(valueOf("genetic-code") || 1)
    });
    renderSummary([
      { label: "Sequence", value: result.name },
      { label: "Translated from", value: "nt " + result.translated_from },
      { label: "Coding length", value: result.coding_length + " nt" },
      { label: "Protein length", value: result.protein_length + " aa" }
    ]);
    writeOutput(result.protein);
    latestText = ["DNA to Protein results", "Sequence: " + result.name, "Translated from nt " + result.translated_from, "Protein:", result.protein].join("\n");
    showResults();
    showMessage("Translation completed.", "ok");
  }

  async function runReverseComplement() {
    const result = await runPythonTool("reverse-complement", { sequence: valueOf("sequence-input") });
    renderSummary([
      { label: "Sequence", value: result.name },
      { label: "Length", value: result.length + " nt" }
    ]);
    writeOutput(result.reverse_complement);
    latestText = ["Reverse Complement results", "Sequence: " + result.name, "Length: " + result.length + " nt", result.reverse_complement].join("\n");
    showResults();
    showMessage("Reverse complement generated.", "ok");
  }

  async function runTmCalculator() {
    const result = await runPythonTool("tm-calculator", { sequence: valueOf("sequence-input") });
    renderSummary([
      { label: "Sequence", value: result.name },
      { label: "Length", value: result.length + " nt" },
      { label: "Tm", value: formatNumber(result.tm_celsius, 2) + " °C" }
    ]);
    writeOutput(formatNumber(result.tm_celsius, 4) + " °C");
    latestText = ["Tm Calculator results", "Sequence: " + result.name, "Length: " + result.length + " nt", "Tm: " + formatNumber(result.tm_celsius, 4) + " °C"].join("\n");
    showResults();
    showMessage("Tm calculated with Bio.SeqUtils.MeltingTemp.Tm_NN.", "ok");
  }

  async function runCodonAlignment() {
    const result = await runPythonTool("codon-alignment", {
      protein_alignment: valueOf("protein-alignment"),
      nucleotide_sequences: valueOf("nucleotide-sequences")
    });
    renderSummary([
      { label: "Records", value: result.record_count },
      { label: "Output", value: "Codon alignment" }
    ]);
    writeOutput(result.alignment);
    latestText = ["Codon Alignment results", result.alignment].join("\n\n");
    showResults();
    showMessage("Codon alignment completed.", "ok");
  }

  async function runOrfFinder() {
    const result = await runPythonTool("orf-finder", {
      sequence: valueOf("sequence-input"),
      min_orf_length: Number(valueOf("min-orf-length") || 1),
      genetic_code: Number(valueOf("genetic-code") || 1),
      strand_mode: valueOf("strand-mode") || "forward",
      hide_contained: checked("hide-contained")
    });
    renderSummary([
      { label: "Sequence", value: result.name },
      { label: "Length", value: result.sequence_length + " nt" },
      { label: "Genetic code", value: result.genetic_code },
      { label: "Minimum length", value: result.minimum_aa_length + " aa" },
      { label: "Candidate ORFs", value: result.orfs.length }
    ]);
    renderTable(["ORF", "Strand", "Frame", "Start", "End", "Size", "DNA", "Protein"], result.orfs.map((orf, index) => [
      index + 1,
      orf.strand,
      orf.frame,
      orf.start,
      orf.end,
      orf.size + " aa / " + orf.nt_length + " nt",
      orf.dna,
      orf.protein
    ]));
    latestText = [
      "ORF Finder results",
      "Sequence: " + result.name,
      "Candidate ORFs: " + result.orfs.length,
      "",
      ...result.orfs.map((orf, index) => [
        "ORF " + (index + 1),
        "Strand: " + orf.strand,
        "Frame: " + orf.frame,
        "Start: " + orf.start,
        "End: " + orf.end,
        "Size: " + orf.size + " aa / " + orf.nt_length + " nt",
        "DNA: " + orf.dna,
        "Protein: " + orf.protein
      ].join("\n"))
    ].join("\n\n");
    showResults();
    showMessage("ORF search completed with Biopython translation.", "ok");
  }

  async function runRestrictionMapper() {
    const result = await runPythonTool("restriction-mapper", {
      sequence: valueOf("sequence-input"),
      include_zero: checked("include-zero")
    });
    renderSummary([
      { label: "Sequence", value: result.name },
      { label: "Length", value: result.sequence_length + " nt" },
      { label: "Enzymes checked", value: result.enzymes_checked },
      { label: "Enzymes cutting", value: result.enzymes_cutting },
      { label: "Total cut sites", value: result.total_sites }
    ]);
    renderTable(["Enzyme", "Recognition", "Cut sites", "Positions"], result.sites.map((site) => [
      site.enzyme,
      site.recognition || site.site,
      site.count,
      site.positions.join(", ")
    ]));
    latestText = [
      "Restriction Mapper results",
      "Sequence: " + result.name,
      "Enzymes checked: " + result.enzymes_checked,
      "Enzymes cutting: " + result.enzymes_cutting,
      "",
      ...result.sites.map((site) => [site.enzyme, site.recognition || site.site, site.count, site.positions.join(", ")].join("\t"))
    ].join("\n");
    showResults();
    showMessage("Restriction map completed with Bio.Restriction.AllEnzymes.", "ok");
  }

  function treeLeaves(node, leaves) {
    if (!node.children || node.children.length === 0) {
      leaves.push(node);
      return;
    }
    for (const child of node.children) treeLeaves(child, leaves);
  }

  function renderTreeSvg(tree) {
    const container = byId("tree-diagram");
    if (!container) return;
    container.textContent = "";
    const leaves = [];
    treeLeaves(tree, leaves);
    const rowHeight = 46;
    const top = 34;
    const bottom = 30;
    const left = 28;
    const branchWidth = Math.max(280, Math.min(560, 120 + leaves.length * 56));
    const labelX = left + branchWidth + 24;
    const width = labelX + Math.max(180, Math.max(...leaves.map((leaf) => String(leaf.name || "Sequence").length)) * 8 + 30);
    const height = top + bottom + Math.max(1, leaves.length - 1) * rowHeight;
    let maxDepth = 0;
    let leafIndex = 0;

    function decorate(node, depth) {
      node._depth = Math.max(0, depth || 0);
      maxDepth = Math.max(maxDepth, node._depth);
      if (!node.children || node.children.length === 0) {
        node._y = top + leafIndex * rowHeight;
        leafIndex += 1;
      } else {
        for (const child of node.children) decorate(child, node._depth + Math.max(0, Number(child.branch_length || 0)));
        node._y = node.children.reduce((sum, child) => sum + child._y, 0) / node.children.length;
      }
    }
    decorate(tree, 0);
    if (maxDepth === 0) maxDepth = 1;

    function x(node) {
      if (!node.children || node.children.length === 0) return left + branchWidth;
      return left + (node._depth / maxDepth) * branchWidth;
    }

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "tree-svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Neighbor-joining phylogenetic tree");

    function line(x1, y1, x2, y2, className) {
      const element = document.createElementNS(ns, "line");
      element.setAttribute("x1", x1.toFixed(2));
      element.setAttribute("y1", y1.toFixed(2));
      element.setAttribute("x2", x2.toFixed(2));
      element.setAttribute("y2", y2.toFixed(2));
      element.setAttribute("class", className || "tree-branch");
      svg.appendChild(element);
    }

    function draw(node) {
      if (!node.children || node.children.length === 0) return;
      const nodeX = x(node);
      const childYs = node.children.map((child) => child._y);
      line(nodeX, Math.min(...childYs), nodeX, Math.max(...childYs), "tree-branch tree-branch-vertical");
      for (const child of node.children) {
        line(nodeX, child._y, x(child), child._y, "tree-branch");
        draw(child);
      }
    }
    draw(tree);

    for (const leaf of leaves) {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", String(left + branchWidth));
      dot.setAttribute("cy", leaf._y.toFixed(2));
      dot.setAttribute("r", "3.5");
      dot.setAttribute("class", "tree-leaf-dot");
      svg.appendChild(dot);
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", labelX);
      text.setAttribute("y", (leaf._y + 4).toFixed(2));
      text.setAttribute("class", "tree-leaf-label");
      text.textContent = leaf.name || "Sequence";
      svg.appendChild(text);
    }
    container.appendChild(svg);
  }

  async function runTreeBuilder() {
    const result = await runPythonTool("tree-builder", { alignment: valueOf("alignment-input") });
    renderSummary([
      { label: "Sequences", value: result.sequence_count },
      { label: "Alignment length", value: result.alignment_length },
      { label: "Method", value: "Neighbor joining" },
      { label: "Distance", value: "Identity" }
    ]);
    const newick = byId("tree-newick");
    if (newick) newick.textContent = result.newick;
    renderTreeSvg(result.tree);
    latestText = result.newick;
    showResults();
    showMessage("Tree built with Bio.Phylo.TreeConstruction.", "ok");
  }

  function setupButtons(runFn) {
    const run = byId("run-tool");
    const clear = byId("clear-tool");
    const copy = byId("copy-results");
    if (run) run.addEventListener("click", async () => {
      clearMessage();
      try {
        await runFn();
      } catch (err) {
        latestText = "";
        hideResults();
        showMessage(err.message || String(err), "error");
      }
    });
    if (clear) clear.addEventListener("click", clearTextareas);
    if (copy) copy.addEventListener("click", copyLatest);
  }

  function setupNotepad() {
    const textArea = byId("text-input");
    const title = byId("notepad-title");
    if (!textArea || !title) return;
    textArea.addEventListener("input", () => {
      const firstLine = textArea.value.split(/\r?\n/)[0].slice(0, 28) || "Untitled";
      document.title = "Notepad: " + firstLine;
      title.textContent = "Notepad: " + firstLine;
    });
    window.addEventListener("beforeunload", (event) => {
      if (!textArea.value.trim()) return;
      event.preventDefault();
      event.returnValue = "Changes may not be saved";
    });
  }

  window.USABOBioPythonTools = { preload: ensureRuntime };
  preloadRuntimeWhenIdle();

  const tool = document.body.dataset.pyTool;
  const runners = {
    "dna-to-protein": runDnaToProtein,
    "reverse-complement": runReverseComplement,
    "tm-calculator": runTmCalculator,
    "codon-alignment": runCodonAlignment,
    "orf-finder": runOrfFinder,
    "restriction-mapper": runRestrictionMapper,
    "tree-builder": runTreeBuilder
  };

  if (tool === "notepad") setupNotepad();
  else if (runners[tool]) setupButtons(runners[tool]);
})();
