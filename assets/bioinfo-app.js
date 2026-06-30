(() => {
  "use strict";

  const CURRENT_SCRIPT = document.currentScript;
  const ASSET_BASE = new URL("./", CURRENT_SCRIPT.src);
  const SHARED_WORKER_URL = new URL("bioinfo-runtime.sharedworker.js", ASSET_BASE).href;
  const DEFAULT_TOOL = "sequence-alignment";
  const CLEAR_DATA_TOOL = "clear-data";
  const STORAGE_KEY = "usabo.bioinfo.workspace.v1";
  const RESULT_ROLES = ["summary", "table", "output", "alignment-output", "alignment-table", "tree-newick", "tree-diagram"];

  const TOOLS = [
    { id: "notepad", title: "Notepad" },
    { id: "codon-alignment", title: "Codon Alignment" },
    { id: "dna-to-protein", title: "DNA to Protein" },
    { id: "orf-finder", title: "ORF Finder" },
    { id: "restriction-mapper", title: "Restriction Mapper" },
    { id: "reverse-complement", title: "Reverse Complement" },
    { id: "sequence-editor", title: "Sequence Editor" },
    { id: "sequence-alignment", title: "Sequence Alignment" },
    { id: "tm-calculator", title: "Tm Calculator" },
    { id: "tree-builder", title: "Tree Builder" },
    { id: CLEAR_DATA_TOOL, title: "Clear Data" }
  ];

  const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.id, tool]));
  const app = document.getElementById("bioinfo-app");
  if (!app) return;

  const state = {
    activeTool: "",
    storedActiveTool: "",
    latestText: new Map(),
    formState: new Map(),
    resultState: new Map(),
    worker: null,
    workerPort: null,
    workerReady: false,
    workerFailed: false,
    requestId: 0,
    pending: new Map(),
    saveTimer: 0
  };

  function html(strings, ...values) {
    let output = "";
    strings.forEach((string, index) => {
      output += string;
      if (index < values.length) output += values[index];
    });
    return output;
  }

  function geneticCodeOptions() {
    return html`
      <option value="1">1 - The Standard Code</option>
      <option value="2">2 - The Vertebrate Mitochondrial Code</option>
      <option value="3">3 - The Yeast Mitochondrial Code</option>
      <option value="5">5 - The Invertebrate Mitochondrial Code</option>
    `;
  }

  function field(panel, name) {
    return panel.querySelector(`[data-field="${name}"]`);
  }

  function value(panel, name) {
    const element = field(panel, name);
    return element ? element.value : "";
  }

  function checked(panel, name) {
    const element = field(panel, name);
    return Boolean(element && element.checked);
  }

  function role(panel, name) {
    return panel.querySelector(`[data-role="${name}"]`);
  }

  function showMessage(panel, text, type) {
    const box = role(panel, "message");
    if (!box) return;
    box.textContent = text || "";
    box.className = text ? "message " + type : "message";
  }

  function showRuntimeStatus(text, type) {
    const box = app.querySelector("[data-runtime-status]");
    if (!box) return;
    box.textContent = text;
    box.dataset.status = type || "idle";
  }

  function setBusy(panel, busy) {
    panel.querySelectorAll("button, input, select, textarea").forEach((element) => {
      element.disabled = busy;
    });
  }

  function showResults(panel) {
    const section = role(panel, "results");
    if (section) section.style.display = "block";
  }

  function hideResults(panel) {
    const section = role(panel, "results");
    if (section) section.style.display = "none";
  }

  function clearResultAreas(panel) {
    hideResults(panel);
    showMessage(panel, "", "");
    RESULT_ROLES.forEach((name) => {
      const element = role(panel, name);
      if (element) element.textContent = "";
    });
  }

  function renderSummary(container, items) {
    if (!container) return;
    container.textContent = "";
    for (const item of items) {
      const box = document.createElement("div");
      const label = document.createElement("div");
      const valueBox = document.createElement("div");
      box.className = "summary-item";
      label.className = "label";
      valueBox.className = "value";
      label.textContent = item.label;
      valueBox.textContent = item.value;
      box.append(label, valueBox);
      container.appendChild(box);
    }
  }

  function appendCell(row, text, tagName) {
    const cell = document.createElement(tagName || "td");
    cell.textContent = text == null ? "" : String(text);
    row.appendChild(cell);
    return cell;
  }

  function renderTable(container, headers, rows) {
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
    headers.forEach((header) => appendCell(headerRow, header, "th"));
    thead.appendChild(headerRow);
    rows.forEach((rowData) => {
      const row = document.createElement("tr");
      rowData.forEach((item) => appendCell(row, item));
      tbody.appendChild(row);
    });
    table.append(thead, tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  function formatNumber(number, digits) {
    return Number(number).toFixed(digits == null ? 2 : digits);
  }

  function connectWorker() {
    if (state.workerFailed) return false;
    if (state.workerPort) return true;
    if (!("SharedWorker" in window)) return false;
    try {
      state.worker = new SharedWorker(SHARED_WORKER_URL);
      state.workerPort = state.worker.port;
      state.workerPort.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "status") {
          if (message.status === "ready") showRuntimeStatus(message.message || "Bioinformatics runtimes ready.", "ready");
          else if (message.status && message.status.endsWith("ready")) showRuntimeStatus(message.message || "Runtime ready.", "loading");
          else if (message.status === "connected") showRuntimeStatus("Loading", "loading");
          return;
        }
        const pending = state.pending.get(message.id);
        if (!pending) return;
        state.pending.delete(message.id);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new Error(message.error || "Shared runtime failed."));
      };
      state.workerPort.start();
      state.workerReady = true;
      return true;
    } catch (err) {
      state.workerFailed = true;
      state.workerReady = false;
      return false;
    }
  }

  function workerRequest(type, payload) {
    if (!connectWorker()) return Promise.reject(new Error("SharedWorker is unavailable."));
    const id = ++state.requestId;
    return new Promise((resolve, reject) => {
      state.pending.set(id, { resolve, reject });
      state.workerPort.postMessage({ id, type, payload });
    });
  }

  async function runPythonTool(toolName, payload) {
    if (!state.workerFailed && connectWorker()) {
      return workerRequest("run-python", { toolName, payload });
    }
    if (!window.USABOBioPythonTools || !window.USABOBioPythonTools.runTool) {
      throw new Error("Biopython runtime is not available.");
    }
    return window.USABOBioPythonTools.runTool(toolName, payload);
  }

  async function runClustal(payload) {
    if (!state.workerFailed && connectWorker()) {
      return workerRequest("run-clustal", payload);
    }
    if (!window.USABOClustalOmega || !window.USABOClustalOmega.align) {
      throw new Error("Clustal Omega runtime is not available.");
    }
    return window.USABOClustalOmega.align(payload.input, payload);
  }

  async function preloadRuntimes() {
    registerServiceWorker();
    showRuntimeStatus("Loading", "loading");
    try {
      if (connectWorker()) {
        await workerRequest("preload", {});
        showRuntimeStatus("Ready", "ready");
        return;
      }
      throw new Error("SharedWorker is unavailable.");
    } catch (err) {
      state.workerFailed = true;
      try {
        await Promise.allSettled([
          window.USABOBioPythonTools && window.USABOBioPythonTools.preload ? window.USABOBioPythonTools.preload() : Promise.resolve(),
          window.USABOClustalOmega && window.USABOClustalOmega.preload ? window.USABOClustalOmega.preload() : Promise.resolve()
        ]);
        showRuntimeStatus("Ready", "ready");
      } catch (fallbackErr) {
        showRuntimeStatus("Idle", "idle");
      }
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const swUrl = new URL("../../sw.js", window.location.href);
    navigator.serviceWorker.register(swUrl).catch(() => {});
  }

  function formSnapshot(panel) {
    const snapshot = {};
    panel.querySelectorAll("[data-field]").forEach((element) => {
      const name = element.dataset.field;
      if (element.type === "checkbox") snapshot[name] = element.checked;
      else snapshot[name] = element.value;
    });
    return snapshot;
  }

  function restoreForm(panel, snapshot) {
    if (!snapshot) return;
    panel.querySelectorAll("[data-field]").forEach((element) => {
      const name = element.dataset.field;
      if (!(name in snapshot)) return;
      if (element.type === "checkbox") element.checked = Boolean(snapshot[name]);
      else element.value = snapshot[name];
    });
  }

  function saveActiveForm() {
    const panel = role(app, "tool-panel");
    if (!panel || !state.activeTool || state.activeTool === CLEAR_DATA_TOOL) return;
    state.formState.set(state.activeTool, formSnapshot(panel));
  }

  function resultSnapshot(panel) {
    const section = role(panel, "results");
    const roles = {};
    RESULT_ROLES.forEach((name) => {
      const element = role(panel, name);
      if (element) roles[name] = element.innerHTML;
    });
    return {
      visible: Boolean(section && section.style.display !== "none"),
      roles
    };
  }

  function restoreResult(panel, snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    const roles = snapshot.roles && typeof snapshot.roles === "object" ? snapshot.roles : {};
    Object.entries(roles).forEach(([name, markup]) => {
      const element = role(panel, name);
      if (element) element.innerHTML = String(markup || "");
    });
    if (snapshot.visible) showResults(panel);
    else hideResults(panel);
  }

  function saveActiveResult() {
    const panel = role(app, "tool-panel");
    if (!panel || !state.activeTool || state.activeTool === CLEAR_DATA_TOOL) return;
    state.resultState.set(state.activeTool, resultSnapshot(panel));
  }

  function mapToObject(map) {
    const object = {};
    map.forEach((value, key) => {
      if (TOOL_MAP.has(key) && key !== CLEAR_DATA_TOOL) object[key] = value;
    });
    return object;
  }

  function loadWorkspaceState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return;

      if (TOOL_MAP.has(saved.activeTool)) state.storedActiveTool = saved.activeTool;

      Object.entries(saved.forms || {}).forEach(([id, snapshot]) => {
        if (TOOL_MAP.has(id) && snapshot && typeof snapshot === "object") state.formState.set(id, snapshot);
      });
      Object.entries(saved.results || {}).forEach(([id, snapshot]) => {
        if (TOOL_MAP.has(id) && snapshot && typeof snapshot === "object") state.resultState.set(id, snapshot);
      });
      Object.entries(saved.latestText || {}).forEach(([id, text]) => {
        if (TOOL_MAP.has(id)) state.latestText.set(id, String(text || ""));
      });
    } catch (err) {
      state.storedActiveTool = "";
    }
  }

  function saveWorkspaceState() {
    if (state.activeTool === CLEAR_DATA_TOOL) return;
    saveActiveForm();
    saveActiveResult();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        activeTool: state.activeTool,
        forms: mapToObject(state.formState),
        results: mapToObject(state.resultState),
        latestText: mapToObject(state.latestText)
      }));
    } catch (err) {
      // Storage may be unavailable or full; the tools should keep working without persistence.
    }
  }

  function scheduleWorkspaceSave() {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(saveWorkspaceState, 200);
  }

  function attachPersistence(panel) {
    panel.querySelectorAll("[data-field]").forEach((element) => {
      element.addEventListener("input", scheduleWorkspaceSave);
      element.addEventListener("change", scheduleWorkspaceSave);
    });
  }

  function clearSavedWorkspace(panel) {
    if (!window.confirm("Clear saved inputs and outputs for Bioinformatics Tools?")) return;
    window.clearTimeout(state.saveTimer);
    state.storedActiveTool = "";
    state.latestText.clear();
    state.formState.clear();
    state.resultState.clear();
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      // Storage may be unavailable; there is still no in-memory state left to restore.
    }
    showMessage(panel, "Saved data cleared.", "ok");
  }

  function toolShell(title, inputHtml, resultsHtml) {
    return html`
      <h2>${title}</h2>
      ${inputHtml}
      ${resultsHtml || ""}
    `;
  }

  function messageBlock() {
    return '<div data-role="message" class="message" role="status" aria-live="polite"></div>';
  }

  function standardButtons(runLabel) {
    return html`
      <div class="buttons">
        <button type="button" data-action="run">${runLabel}</button>
        <button type="button" class="secondary" data-action="clear">Clear</button>
        <button type="button" class="secondary" data-action="copy">Copy results</button>
      </div>
    `;
  }

  function resultsPanel(title, body) {
    return html`
      <section data-role="results" class="panel" style="display:none;" aria-label="${title}">
        <h3>${title}</h3>
        ${body}
      </section>
    `;
  }

  const templates = {
    "notepad": () => toolShell(
      "Notepad",
      html`<section class="panel"><textarea data-field="text" spellcheck="false" style="min-height:560px;"></textarea></section>`,
      ""
    ),
    "clear-data": () => toolShell(
      "Clear Data",
      html`<section class="panel"><div class="buttons"><button type="button" data-action="clear-data">Clear data</button></div>${messageBlock()}</section>`,
      ""
    ),
    "codon-alignment": () => toolShell(
      "Codon Alignment",
      html`<section class="panel">
        <div class="input-grid">
          <div><label>Protein alignment (CLUSTAL)</label><textarea data-field="proteinAlignment" spellcheck="false"></textarea></div>
          <div><label>Nucleotide coding sequences (FASTA)</label><textarea data-field="nucleotideSequences" spellcheck="false"></textarea></div>
        </div>
        ${standardButtons("Align codons")}
        ${messageBlock()}
      </section>`,
      resultsPanel("Results", '<div data-role="summary" class="summary-grid"></div><div data-role="output" class="output-block"></div><div data-role="table"></div>')
    ),
    "dna-to-protein": () => toolShell(
      "DNA to Protein",
      html`<section class="panel">
        <label>DNA sequence or FASTA</label>
        <textarea data-field="sequence" spellcheck="false"></textarea>
        <div class="settings two"><div><label>Genetic code</label><select data-field="geneticCode">${geneticCodeOptions()}</select></div></div>
        ${standardButtons("Translate")}
        ${messageBlock()}
      </section>`,
      resultsPanel("Results", '<div data-role="summary" class="summary-grid"></div><div data-role="output" class="output-block"></div><div data-role="table"></div>')
    ),
    "orf-finder": () => toolShell(
      "ORF Finder",
      html`<section class="panel">
        <label>DNA FASTA sequence</label>
        <textarea data-field="sequence" spellcheck="false"></textarea>
        <div class="settings three">
          <div><label>Minimum ORF length (aa)</label><input data-field="minOrfLength" type="number" value="30" min="1" step="1"></div>
          <div><label>Genetic code</label><select data-field="geneticCode">${geneticCodeOptions()}</select></div>
          <div><label>Strands</label><select data-field="strandMode"><option value="forward">Forward only</option><option value="both">Forward and reverse complement</option></select></div>
        </div>
        <div class="status-row"><label><input data-field="hideContained" type="checkbox" checked style="width:auto;margin-right:6px;"> Hide ORFs contained within longer ORFs in the same frame</label></div>
        ${standardButtons("Find ORFs")}
        ${messageBlock()}
      </section>`,
      resultsPanel("Candidate ORFs", '<div data-role="summary" class="summary-grid"></div><div data-role="table"></div>')
    ),
    "restriction-mapper": () => toolShell(
      "Restriction Mapper",
      html`<section class="panel">
        <label>DNA sequence or FASTA</label>
        <textarea data-field="sequence" spellcheck="false"></textarea>
        <div class="status-row"><label><input data-field="includeZero" type="checkbox" style="width:auto;margin-right:6px;"> Include enzymes with zero cut sites</label></div>
        ${standardButtons("Map restriction sites")}
        ${messageBlock()}
      </section>`,
      resultsPanel("Restriction Sites", '<div data-role="summary" class="summary-grid"></div><div data-role="table"></div>')
    ),
    "reverse-complement": () => toolShell(
      "Reverse Complement",
      html`<section class="panel"><label>DNA sequence or FASTA</label><textarea data-field="sequence" spellcheck="false"></textarea>${standardButtons("Generate reverse complement")}${messageBlock()}</section>`,
      resultsPanel("Results", '<div data-role="summary" class="summary-grid"></div><div data-role="output" class="output-block"></div><div data-role="table"></div>')
    ),
    "sequence-editor": () => toolShell(
      "Sequence Editor",
      html`<section class="panel sequence-editor-simple">
        <label>Enter sequence</label>
        <textarea data-field="sequence" spellcheck="false"></textarea>
        <h2>Selection Information:</h2>
        <h3 class="monospace">Length: <span data-role="selection-length"></span></h3>
        <h3 class="monospace">Start: <span data-role="selection-start"></span></h3>
        <h3 class="monospace">End: <span data-role="selection-end"></span></h3>
      </section>`,
      ""
    ),
    "sequence-alignment": () => toolShell(
      "Sequence Alignment",
      html`<section class="panel">
        <label>FASTA sequences</label>
        <textarea data-field="input" spellcheck="false"></textarea>
        <div class="settings">
          <div><label>Sequence type</label><select data-field="sequenceType"><option value="auto">Auto</option><option value="DNA">DNA</option><option value="RNA">RNA</option><option value="Protein">Protein</option></select></div>
          <div><label>Output order</label><select data-field="outputOrder"><option value="input-order">Input order</option><option value="tree-order">Tree order</option></select></div>
          <div><label>Wrap width</label><input data-field="wrap" type="number" value="60" min="20" max="120" step="10"></div>
        </div>
        ${standardButtons("Align sequences")}
        ${messageBlock()}
      </section>`,
      resultsPanel("Alignment", '<div data-role="summary" class="summary-grid"></div><div data-role="alignment-output" class="alignment-block"></div><h3>Comparison to Reference</h3><div data-role="alignment-table"></div>')
    ),
    "tm-calculator": () => toolShell(
      "Tm Calculator",
      html`<section class="panel"><label>DNA sequence or FASTA</label><textarea data-field="sequence" spellcheck="false"></textarea>${standardButtons("Calculate Tm")}${messageBlock()}</section>`,
      resultsPanel("Results", '<div data-role="summary" class="summary-grid"></div><div data-role="output" class="output-block"></div><div data-role="table"></div>')
    ),
    "tree-builder": () => toolShell(
      "Tree Builder",
      html`<section class="panel"><label>Rendered alignment</label><textarea data-field="alignment" spellcheck="false"></textarea>${standardButtons("Build tree")}${messageBlock()}</section>`,
      resultsPanel("Tree", '<div data-role="summary" class="summary-grid"></div><h3>Newick</h3><div data-role="tree-newick" class="output-block"></div><h3>Visual Diagram</h3><div data-role="tree-diagram" class="tree-diagram"></div>')
    )
  };

  function renderIdentityTable(panel, records) {
    const container = role(panel, "alignment-table");
    if (!container) return;
    container.textContent = "";
    if (!records.length) return;
    const reference = records[0].sequence;
    const rows = records.map((record) => {
      let matches = 0;
      let comparable = 0;
      for (let i = 0; i < reference.length && i < record.sequence.length; i++) {
        const a = reference[i];
        const b = record.sequence[i];
        if (a === "-" && b === "-") continue;
        comparable += 1;
        if (a === b) matches += 1;
      }
      return [record.name, record.sequence.length, (comparable ? (matches / comparable) * 100 : 0).toFixed(2) + "%"];
    });
    renderTable(container, ["Sequence", "Aligned length", "Identity to first sequence"], rows);
  }

  async function runCurrentTool(panel) {
    const id = state.activeTool;
    showMessage(panel, "", "");
    setBusy(panel, true);
    try {
      if (id === "codon-alignment") await runCodonAlignment(panel);
      else if (id === "dna-to-protein") await runDnaToProtein(panel);
      else if (id === "orf-finder") await runOrfFinder(panel);
      else if (id === "restriction-mapper") await runRestrictionMapper(panel);
      else if (id === "reverse-complement") await runReverseComplement(panel);
      else if (id === "sequence-alignment") await runSequenceAlignment(panel);
      else if (id === "tm-calculator") await runTmCalculator(panel);
      else if (id === "tree-builder") await runTreeBuilder(panel);
    } catch (err) {
      state.latestText.set(id, "");
      hideResults(panel);
      showMessage(panel, err.message || String(err), "error");
    } finally {
      setBusy(panel, false);
      saveWorkspaceState();
    }
  }

  async function runCodonAlignment(panel) {
    const result = await runPythonTool("codon-alignment", {
      protein_alignment: value(panel, "proteinAlignment"),
      nucleotide_sequences: value(panel, "nucleotideSequences")
    });
    renderSummary(role(panel, "summary"), [
      { label: "Records", value: result.record_count },
      { label: "Output", value: "Codon alignment" }
    ]);
    role(panel, "output").textContent = result.alignment;
    state.latestText.set(state.activeTool, ["Codon Alignment results", result.alignment].join("\n\n"));
    showResults(panel);
    showMessage(panel, "Codon alignment completed.", "ok");
  }

  async function runDnaToProtein(panel) {
    const result = await runPythonTool("dna-to-protein", {
      sequence: value(panel, "sequence"),
      genetic_code: Number(value(panel, "geneticCode") || 1)
    });
    renderSummary(role(panel, "summary"), [
      { label: "Sequence", value: result.name },
      { label: "Translated from", value: "nt " + result.translated_from },
      { label: "Coding length", value: result.coding_length + " nt" },
      { label: "Protein length", value: result.protein_length + " aa" }
    ]);
    role(panel, "output").textContent = result.protein;
    state.latestText.set(state.activeTool, ["DNA to Protein results", "Sequence: " + result.name, "Translated from nt " + result.translated_from, "Protein:", result.protein].join("\n"));
    showResults(panel);
    showMessage(panel, "Translation completed.", "ok");
  }

  async function runOrfFinder(panel) {
    const result = await runPythonTool("orf-finder", {
      sequence: value(panel, "sequence"),
      min_orf_length: Number(value(panel, "minOrfLength") || 1),
      genetic_code: Number(value(panel, "geneticCode") || 1),
      strand_mode: value(panel, "strandMode") || "forward",
      hide_contained: checked(panel, "hideContained")
    });
    renderSummary(role(panel, "summary"), [
      { label: "Sequence", value: result.name },
      { label: "Length", value: result.sequence_length + " nt" },
      { label: "Genetic code", value: result.genetic_code },
      { label: "Minimum length", value: result.minimum_aa_length + " aa" },
      { label: "Candidate ORFs", value: result.orfs.length }
    ]);
    renderTable(role(panel, "table"), ["ORF", "Strand", "Frame", "Start", "End", "Size", "DNA", "Protein"], result.orfs.map((orf, index) => [
      index + 1,
      orf.strand,
      orf.frame,
      orf.start,
      orf.end,
      orf.size + " aa / " + orf.nt_length + " nt",
      orf.dna,
      orf.protein
    ]));
    state.latestText.set(state.activeTool, [
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
    ].join("\n\n"));
    showResults(panel);
    showMessage(panel, "ORF search completed.", "ok");
  }

  async function runRestrictionMapper(panel) {
    const result = await runPythonTool("restriction-mapper", {
      sequence: value(panel, "sequence"),
      include_zero: checked(panel, "includeZero")
    });
    renderSummary(role(panel, "summary"), [
      { label: "Sequence", value: result.name },
      { label: "Length", value: result.sequence_length + " nt" },
      { label: "Enzymes checked", value: result.enzymes_checked },
      { label: "Enzymes cutting", value: result.enzymes_cutting },
      { label: "Total cut sites", value: result.total_sites }
    ]);
    renderTable(role(panel, "table"), ["Enzyme", "Recognition", "Cut sites", "Positions"], result.sites.map((site) => [
      site.enzyme,
      site.recognition || site.site,
      site.count,
      site.positions.join(", ")
    ]));
    state.latestText.set(state.activeTool, [
      "Restriction Mapper results",
      "Sequence: " + result.name,
      "Enzymes checked: " + result.enzymes_checked,
      "Enzymes cutting: " + result.enzymes_cutting,
      "",
      ...result.sites.map((site) => [site.enzyme, site.recognition || site.site, site.count, site.positions.join(", ")].join("\t"))
    ].join("\n"));
    showResults(panel);
    showMessage(panel, "Restriction map completed.", "ok");
  }

  async function runReverseComplement(panel) {
    const result = await runPythonTool("reverse-complement", { sequence: value(panel, "sequence") });
    renderSummary(role(panel, "summary"), [
      { label: "Sequence", value: result.name },
      { label: "Length", value: result.length + " nt" }
    ]);
    role(panel, "output").textContent = result.reverse_complement;
    state.latestText.set(state.activeTool, ["Reverse Complement results", "Sequence: " + result.name, "Length: " + result.length + " nt", result.reverse_complement].join("\n"));
    showResults(panel);
    showMessage(panel, "Reverse complement generated.", "ok");
  }

  async function runTmCalculator(panel) {
    const result = await runPythonTool("tm-calculator", { sequence: value(panel, "sequence") });
    renderSummary(role(panel, "summary"), [
      { label: "Sequence", value: result.name },
      { label: "Length", value: result.length + " nt" },
      { label: "Tm", value: formatNumber(result.tm_celsius, 2) + " deg C" }
    ]);
    role(panel, "output").textContent = formatNumber(result.tm_celsius, 4) + " deg C";
    state.latestText.set(state.activeTool, ["Tm Calculator results", "Sequence: " + result.name, "Length: " + result.length + " nt", "Tm: " + formatNumber(result.tm_celsius, 4) + " deg C"].join("\n"));
    showResults(panel);
    showMessage(panel, "Tm calculated with Biopython nearest-neighbor defaults.", "ok");
  }

  async function runSequenceAlignment(panel) {
    const result = await runClustal({
      input: value(panel, "input"),
      sequenceType: value(panel, "sequenceType") || "auto",
      outputOrder: value(panel, "outputOrder") || "input-order",
      wrap: Number(value(panel, "wrap") || 60)
    });
    role(panel, "alignment-output").textContent = result.output;
    renderSummary(role(panel, "summary"), [
      { label: "Method", value: "Clustal Omega 1.2.4" },
      { label: "Sequences", value: result.alignedRecords.length },
      { label: "Aligned length", value: result.alignmentLength },
      { label: "Sequence type", value: result.sequenceType === "auto" ? "Auto" : result.sequenceType }
    ]);
    renderIdentityTable(panel, result.alignedRecords);
    state.latestText.set(state.activeTool, result.output);
    showResults(panel);
    showMessage(panel, "Alignment completed with Clustal Omega.", "ok");
  }

  function treeLeaves(node, leaves) {
    if (!node.children || node.children.length === 0) {
      leaves.push(node);
      return;
    }
    node.children.forEach((child) => treeLeaves(child, leaves));
  }

  function renderTreeSvg(container, tree) {
    container.textContent = "";
    const leaves = [];
    treeLeaves(tree, leaves);
    const rowHeight = 46;
    const top = 34;
    const bottom = 30;
    const left = 28;
    const branchWidth = Math.max(320, Math.min(620, 160 + leaves.length * 58));
    const labelX = left + branchWidth + 24;
    const longestLabel = Math.max(8, ...leaves.map((leaf) => String(leaf.name || "Sequence").length));
    const width = labelX + longestLabel * 8 + 40;
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
        node.children.forEach((child) => decorate(child, node._depth + Math.max(0, Number(child.branch_length || 0))));
        node._y = node.children.reduce((sum, child) => sum + child._y, 0) / node.children.length;
      }
    }
    decorate(tree, 0);
    if (maxDepth === 0) maxDepth = 1;

    function x(node) {
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
      node.children.forEach((child) => {
        line(nodeX, child._y, x(child), child._y, "tree-branch");
        draw(child);
      });
    }
    draw(tree);

    leaves.forEach((leaf) => {
      const leafX = x(leaf);
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", leafX.toFixed(2));
      dot.setAttribute("cy", leaf._y.toFixed(2));
      dot.setAttribute("r", "3.5");
      dot.setAttribute("class", "tree-leaf-dot");
      svg.appendChild(dot);
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", (leafX + 12).toFixed(2));
      text.setAttribute("y", (leaf._y + 4).toFixed(2));
      text.setAttribute("class", "tree-leaf-label");
      text.textContent = leaf.name || "Sequence";
      svg.appendChild(text);
    });
    container.appendChild(svg);
  }

  async function runTreeBuilder(panel) {
    const result = await runPythonTool("tree-builder", { alignment: value(panel, "alignment") });
    renderSummary(role(panel, "summary"), [
      { label: "Sequences", value: result.sequence_count },
      { label: "Alignment length", value: result.alignment_length },
      { label: "Method", value: "Neighbor joining" },
      { label: "Distance", value: "Identity" }
    ]);
    role(panel, "tree-newick").textContent = result.newick;
    renderTreeSvg(role(panel, "tree-diagram"), result.tree);
    state.latestText.set(state.activeTool, result.newick);
    showResults(panel);
    showMessage(panel, "Tree built with Biopython.", "ok");
  }

  async function copyLatest(panel) {
    const text = state.latestText.get(state.activeTool) || "";
    if (!text) {
      showMessage(panel, "No results to copy yet. Run the tool first.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showMessage(panel, "Results copied to clipboard.", "ok");
    } catch (err) {
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.setAttribute("readonly", "");
      temp.style.position = "fixed";
      temp.style.left = "-9999px";
      document.body.appendChild(temp);
      temp.select();
      try {
        document.execCommand("copy");
        showMessage(panel, "Results copied to clipboard.", "ok");
      } catch (copyErr) {
        showMessage(panel, "Could not copy automatically. Select and copy the results manually.", "error");
      } finally {
        document.body.removeChild(temp);
      }
    }
  }

  function clearStandardTool(panel) {
    panel.querySelectorAll("textarea[data-field]").forEach((textarea) => {
      textarea.value = "";
    });
    state.latestText.set(state.activeTool, "");
    clearResultAreas(panel);
    saveWorkspaceState();
  }

  function initSequenceEditor(panel) {
    const sequenceArea = field(panel, "sequence");
    const lengthDisplay = role(panel, "selection-length");
    const startDisplay = role(panel, "selection-start");
    const endDisplay = role(panel, "selection-end");

    function updateSelection() {
      const selectedTextBefore = sequenceArea.value.substring(0, sequenceArea.selectionStart);
      const newlineCount = (selectedTextBefore.match(/\n/g) || []).length;
      const selectedText = sequenceArea.value.substring(sequenceArea.selectionStart, sequenceArea.selectionEnd).replace(/\n/g, "");
      const length = selectedText.length;
      const start = sequenceArea.selectionStart - newlineCount;
      const end = start + length - 1;

      lengthDisplay.textContent = String(length);
      startDisplay.textContent = String(start);
      endDisplay.textContent = String(end);
    }

    sequenceArea.addEventListener("mouseup", updateSelection);
    sequenceArea.addEventListener("keyup", updateSelection);
  }

  function attachToolEvents(panel) {
    if (state.activeTool === CLEAR_DATA_TOOL) {
      const clear = panel.querySelector("[data-action='clear-data']");
      if (clear) clear.addEventListener("click", () => clearSavedWorkspace(panel));
      return;
    }
    if (state.activeTool === "sequence-editor") {
      initSequenceEditor(panel);
      return;
    }
    if (state.activeTool === "notepad") {
      const textArea = field(panel, "text");
      const updateHeading = () => {
        const title = textArea.value.split(/\r?\n/)[0].slice(0, 28) || "Notepad";
        const heading = panel.querySelector("h2");
        if (heading) heading.textContent = title === "Notepad" ? "Notepad" : "Notepad: " + title;
      };
      textArea.addEventListener("input", updateHeading);
      updateHeading();
      return;
    }
    const run = panel.querySelector("[data-action='run']");
    const clear = panel.querySelector("[data-action='clear']");
    const copy = panel.querySelector("[data-action='copy']");
    if (run) run.addEventListener("click", () => runCurrentTool(panel));
    if (clear) clear.addEventListener("click", () => clearStandardTool(panel));
    if (copy) copy.addEventListener("click", () => copyLatest(panel));
  }

  function renderTool(toolId, options) {
    const id = TOOL_MAP.has(toolId) ? toolId : DEFAULT_TOOL;
    const opts = options || {};
    if (!opts.skipSave) {
      saveActiveForm();
      saveActiveResult();
    }
    state.activeTool = id;
    const panel = role(app, "tool-panel");
    panel.innerHTML = templates[id]();
    restoreForm(panel, state.formState.get(id));
    attachToolEvents(panel);
    restoreResult(panel, state.resultState.get(id));
    attachPersistence(panel);
    app.querySelectorAll("[data-tool-link]").forEach((button) => {
      const selected = button.dataset.toolLink === id;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-current", selected ? "page" : "false");
    });
    if (!opts.skipHash) {
      const url = new URL(window.location.href);
      url.hash = id;
      history.replaceState(null, "", url);
    }
    saveWorkspaceState();
    if (!opts.noFocus) panel.focus({ preventScroll: true });
  }

  function initialToolFromHash() {
    const hash = window.location.hash.replace(/^#/, "").trim();
    if (TOOL_MAP.has(hash)) return hash;
    return TOOL_MAP.has(state.storedActiveTool) ? state.storedActiveTool : DEFAULT_TOOL;
  }

  function renderAppShell() {
    app.innerHTML = html`
      <div class="app-layout">
        <aside class="tool-sidebar" aria-label="Bioinformatics tools">
          <div class="runtime-strip"><span data-runtime-status data-status="idle">Runtime</span></div>
          <div class="tool-nav" data-role="tool-nav"></div>
        </aside>
        <section class="tool-workspace" data-role="tool-panel" tabindex="-1"></section>
      </div>
    `;
    const nav = role(app, "tool-nav");
    TOOLS.forEach((tool) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool-tab";
      button.dataset.toolLink = tool.id;
      const title = document.createElement("span");
      title.textContent = tool.title;
      button.append(title);
      button.addEventListener("click", () => renderTool(tool.id));
      nav.appendChild(button);
    });
    renderTool(initialToolFromHash(), { skipSave: true, skipHash: true, noFocus: true });
  }

  window.addEventListener("hashchange", () => {
    const id = initialToolFromHash();
    if (id !== state.activeTool) renderTool(id, { skipHash: true });
  });

  function flushWorkspaceSave() {
    window.clearTimeout(state.saveTimer);
    saveWorkspaceState();
  }

  window.addEventListener("beforeunload", flushWorkspaceSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushWorkspaceSave();
  });

  loadWorkspaceState();
  renderAppShell();
  if ("requestIdleCallback" in window) window.requestIdleCallback(preloadRuntimes, { timeout: 2000 });
  else window.setTimeout(preloadRuntimes, 800);
})();
