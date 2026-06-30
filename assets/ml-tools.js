(() => {
  "use strict";

  const STORAGE_KEY = "usabo.ml.workspace.v3";
  const DEFAULT_TOOL = "data-input";
  const CLEAR_DATA_TOOL = "clear-data";
  const REQUIRED_COLUMNS = [
    "biomass_sum",
    "bacterial_density",
    "VMR",
    "NN_index",
    "primary_root_length",
    "lateral_root_density",
    "root_hair_density",
    "root_browning_score",
    "leaf_area",
    "chlorophyll_index",
    "wilting_score",
    "SRG1_class",
    "image_brightness",
    "camera_batch"
  ];
  const POSITIVE_CLASS = "high-biomass";
  const NEGATIVE_CLASS = "low-biomass";
  const SVG_NS = "http://www.w3.org/2000/svg";

  const tools = new Set([
    "data-input",
    "summary-filtering",
    "scatterplot",
    "dataset-splitter",
    "regression-trainer",
    "classifier-evaluator",
    CLEAR_DATA_TOOL
  ]);
  const buttons = Array.from(document.querySelectorAll("[data-ml-tool]"));
  const workspace = document.querySelector("[data-ml-workspace]");
  if (!buttons.length || !workspace) return;

  let state = loadState();
  let dataset = null;
  let split = null;
  let loadError = "";

  rebuildFromCsv();

  function defaultState() {
    return {
      activeTool: DEFAULT_TOOL,
      csvText: "",
      ui: {
        filterColumn: "",
        filterValue: "All",
        filterMin: "",
        filterMax: "",
        scatterX: "",
        scatterY: "",
        scatterColor: "none",
        scatterTrend: false,
        scatterCorrelation: false,
        splitTarget: "",
        trainPercent: "",
        splitSeed: "",
        selectedFeatures: [],
        classifierModelId: "",
        classifierSet: "",
        classifierThreshold: ""
      },
      splitConfig: null,
      models: []
    };
  }

  function loadState() {
    const fresh = defaultState();
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return fresh;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return fresh;
      return {
        ...fresh,
        ...saved,
        ui: { ...fresh.ui, ...(saved.ui || {}) },
        models: Array.isArray(saved.models) ? saved.models : []
      };
    } catch (err) {
      return fresh;
    }
  }

  function saveState() {
    const payload = {
      activeTool: state.activeTool,
      csvText: state.csvText,
      ui: state.ui,
      splitConfig: state.splitConfig,
      models: state.models
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      // Local storage is helpful but not required for calculations.
    }
  }

  function rebuildFromCsv() {
    dataset = null;
    split = null;
    loadError = "";
    if (!state.csvText || !state.csvText.trim()) return;
    try {
      dataset = buildDataset(state.csvText);
      normalizeUiAfterDatasetLoad();
      if (state.splitConfig) split = createSplitFromConfig(state.splitConfig);
    } catch (err) {
      loadError = err.message || String(err);
    }
  }

  function normalizeUiAfterDatasetLoad() {
    if (!dataset) return;
    const numeric = dataset.numericColumns;
    if (state.ui.scatterY && !numeric.includes(state.ui.scatterY)) state.ui.scatterY = "";
    if (state.ui.scatterX && !numeric.includes(state.ui.scatterX)) state.ui.scatterX = "";
    if (state.ui.splitTarget && !numeric.includes(state.ui.splitTarget)) state.ui.splitTarget = "";
    if (state.ui.filterColumn && !dataset.columnNames.includes(state.ui.filterColumn)) state.ui.filterColumn = "";
    if (state.ui.scatterColor && state.ui.scatterColor !== "none" && !colorByColumns().includes(state.ui.scatterColor)) state.ui.scatterColor = "none";
    const possible = possibleFeatures();
    if (!Array.isArray(state.ui.selectedFeatures)) state.ui.selectedFeatures = [];
    state.ui.selectedFeatures = state.ui.selectedFeatures.filter((feature) => possible.includes(feature));
  }

  function activeId() {
    const hashId = window.location.hash.replace(/^#/, "");
    if (tools.has(hashId)) return hashId;
    if (tools.has(state.activeTool)) return state.activeTool;
    return DEFAULT_TOOL;
  }

  function setActiveTool(id) {
    state.activeTool = tools.has(id) ? id : DEFAULT_TOOL;
    if (window.location.hash.replace(/^#/, "") !== state.activeTool) {
      history.replaceState(null, "", "#" + state.activeTool);
    }
    saveState();
    render();
  }

  function render() {
    const id = activeId();
    state.activeTool = id;
    buttons.forEach((button) => {
      const active = button.dataset.mlTool === id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    workspace.classList.remove("blank-workspace");
    if (id === "data-input") renderDataInput();
    else if (id === "summary-filtering") renderSummaryFiltering();
    else if (id === "scatterplot") renderScatterplot();
    else if (id === "dataset-splitter") renderDatasetSplitter();
    else if (id === "regression-trainer") renderRegressionTrainer();
    else if (id === "classifier-evaluator") renderClassifierEvaluator();
    else renderClearData();
    saveState();
  }

  function renderShell(title) {
    workspace.innerHTML = "";
    const heading = document.createElement("div");
    heading.className = "tool-heading";
    const block = document.createElement("div");
    const h2 = document.createElement("h2");
    h2.textContent = title;
    block.appendChild(h2);
    heading.appendChild(block);
    workspace.appendChild(heading);
    return workspace;
  }

  function renderDataInput() {
    const root = renderShell("Data Input");
    const controls = document.createElement("div");
    controls.innerHTML = '<label for="ml-csv-input">CSV dataset</label><div class="file-drop-zone" data-csv-drop-zone tabindex="0"><strong>Drop CSV file here</strong><span>or click to choose a file</span><input data-csv-file-input type="file" accept=".csv,text/csv,text/plain"></div><textarea id="ml-csv-input" spellcheck="false"></textarea><div class="buttons"><button type="button" data-load-dataset>Load dataset</button></div><div class="message" data-input-message role="status" aria-live="polite"></div>';
    const textarea = controls.querySelector("textarea");
    textarea.value = state.csvText || "";
    const message = controls.querySelector("[data-input-message]");
    const dropZone = controls.querySelector("[data-csv-drop-zone]");
    const fileInput = controls.querySelector("[data-csv-file-input]");
    function loadCsvText(text) {
      state.csvText = text;
      state.splitConfig = null;
      state.models = [];
      rebuildFromCsv();
      saveState();
      renderDataInput();
    }
    function readCsvFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        textarea.value = String(reader.result || "");
        loadCsvText(textarea.value);
      };
      reader.onerror = () => showMessage(message, "Could not read that file.", "error");
      reader.readAsText(file);
    }
    controls.querySelector("[data-load-dataset]").addEventListener("click", () => loadCsvText(textarea.value));
    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener("change", () => readCsvFile(fileInput.files[0]));
    ["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragging");
    }));
    dropZone.addEventListener("drop", (event) => readCsvFile(event.dataTransfer.files[0]));

    const output = document.createElement("div");
    if (loadError) addMessage(output, loadError, "error");
    if (!dataset) {
      addMessage(output, "No dataset loaded.", "error");
    } else {
      addMetrics(output, [
        ["Rows", dataset.rows.length],
        ["Columns", dataset.columnNames.length],
        ["Numeric columns", dataset.numericColumns.length],
        ["Categorical columns", dataset.categoricalColumns.length]
      ]);
      renderRequiredStatus(output);
      addOutputBlock(output, "Detected columns", dataset.columnNames.join(", "));
      renderTable(output, "Preview", dataset.columnNames, dataset.rows.slice(0, 8).map((row) => dataset.columnNames.map((column) => row[column])));
    }

    root.appendChild(controls);
    root.appendChild(output);
  }


  function renderRequiredStatus(parent) {
    const missing = REQUIRED_COLUMNS.filter((column) => !dataset.requiredColumnStatus[column]);
    if (missing.length) addMessage(parent, "Missing expected columns: " + missing.join(", "), "error");
    else addMessage(parent, "All expected columns detected.", "ok");
  }

  function renderSummaryFiltering() {
    const root = renderShell("Summary and Filtering");
    if (!requireDataset(root)) return;

    const controls = document.createElement("div");
    const selectedColumn = dataset.columnNames.includes(state.ui.filterColumn) ? state.ui.filterColumn : "";
    const isNumericFilter = selectedColumn && dataset.numericColumns.includes(selectedColumn);
    const isCategoricalFilter = selectedColumn && !isNumericFilter;
    controls.innerHTML = '<div class="settings three"><div><label for="ml-filter-column">Filter column</label><select id="ml-filter-column"></select></div><div data-filter-extra-a></div><div data-filter-extra-b></div></div>';
    const columnSelect = controls.querySelector("#ml-filter-column");
    fillSelect(columnSelect, [""].concat(dataset.columnNames), selectedColumn, "None");
    const extraA = controls.querySelector("[data-filter-extra-a]");
    const extraB = controls.querySelector("[data-filter-extra-b]");

    if (isNumericFilter) {
      extraA.innerHTML = '<label for="ml-filter-min">Minimum</label><input id="ml-filter-min" type="number" step="any">';
      extraB.innerHTML = '<label for="ml-filter-max">Maximum</label><input id="ml-filter-max" type="number" step="any">';
      extraA.querySelector("input").value = state.ui.filterMin;
      extraB.querySelector("input").value = state.ui.filterMax;
      extraA.querySelector("input").addEventListener("change", (event) => { state.ui.filterMin = event.target.value; renderSummaryFiltering(); });
      extraB.querySelector("input").addEventListener("change", (event) => { state.ui.filterMax = event.target.value; renderSummaryFiltering(); });
    } else if (isCategoricalFilter) {
      extraA.innerHTML = '<label for="ml-filter-value">Filter value</label><select id="ml-filter-value"></select>';
      const valueOptions = ["All"].concat(uniqueColumnValues(selectedColumn));
      if (!valueOptions.includes(state.ui.filterValue)) state.ui.filterValue = "All";
      fillSelect(extraA.querySelector("select"), valueOptions, state.ui.filterValue || "All");
      extraA.querySelector("select").addEventListener("change", (event) => { state.ui.filterValue = event.target.value; renderSummaryFiltering(); });
      extraB.innerHTML = '<div class="tool-note">Categorical filter</div>';
    } else {
      extraA.innerHTML = '<div class="tool-note">No filter selected</div>';
    }

    columnSelect.addEventListener("change", () => {
      state.ui.filterColumn = columnSelect.value;
      state.ui.filterValue = "All";
      state.ui.filterMin = "";
      state.ui.filterMax = "";
      renderSummaryFiltering();
    });

    const output = document.createElement("div");
    const filtered = filteredRows();
    addMetrics(output, [
      ["Full dataset", dataset.rows.length],
      ["Filtered dataset", filtered.length],
      ["Filter column", selectedColumn || "None"]
    ]);
    summaryCategoricalColumns().forEach((column) => {
      const counts = countBy(filtered, column);
      renderTable(output, column + " Counts", [column, "Count"], Object.keys(counts).sort().map((key) => [key, counts[key]]));
    });
    renderTable(output, "Numeric Summary", ["Column", "Mean", "Std. dev.", "Min", "Max"], numericSummary(filtered));
    renderTable(output, "Filtered Preview", dataset.columnNames, filtered.slice(0, 10).map((row) => dataset.columnNames.map((column) => row[column])));

    root.appendChild(controls);
    root.appendChild(output);
  }


  function renderScatterplot() {
    const root = renderShell("Scatterplot");
    if (!requireDataset(root)) return;

    const controls = document.createElement("div");
    controls.innerHTML = '<div class="settings three"><div><label for="ml-scatter-x">X-axis</label><select id="ml-scatter-x"></select></div><div><label for="ml-scatter-y">Y-axis</label><select id="ml-scatter-y"></select></div><div><label for="ml-scatter-color">Color by</label><select id="ml-scatter-color"></select></div></div><div class="ml-check-row"><label><input id="ml-scatter-trend" type="checkbox"> Show trend line</label><label><input id="ml-scatter-correlation" type="checkbox"> Show correlation</label></div>';
    fillSelect(controls.querySelector("#ml-scatter-x"), [""].concat(dataset.numericColumns), state.ui.scatterX, "Choose column");
    fillSelect(controls.querySelector("#ml-scatter-y"), [""].concat(dataset.numericColumns), state.ui.scatterY, "Choose column");
    fillSelect(controls.querySelector("#ml-scatter-color"), ["none"].concat(colorByColumns()), state.ui.scatterColor || "none");
    controls.querySelector("#ml-scatter-trend").checked = !!state.ui.scatterTrend;
    controls.querySelector("#ml-scatter-correlation").checked = !!state.ui.scatterCorrelation;
    controls.querySelectorAll("select,input").forEach((control) => {
      control.addEventListener("change", () => {
        state.ui.scatterX = controls.querySelector("#ml-scatter-x").value;
        state.ui.scatterY = controls.querySelector("#ml-scatter-y").value;
        state.ui.scatterColor = controls.querySelector("#ml-scatter-color").value;
        state.ui.scatterTrend = controls.querySelector("#ml-scatter-trend").checked;
        state.ui.scatterCorrelation = controls.querySelector("#ml-scatter-correlation").checked;
        renderScatterplot();
      });
    });

    const output = document.createElement("div");
    const x = state.ui.scatterX;
    const y = state.ui.scatterY;
    if (!x || !y) {
      addMessage(output, "Choose X-axis and Y-axis columns.", "error");
    } else {
      const points = dataset.rows.map((row) => ({ row, x: numberValue(row, x), y: numberValue(row, y) })).filter((point) => isFinite(point.x) && isFinite(point.y));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const r = pearson(xs, ys);
      const relationship = relationshipText(r);
      addMetrics(output, [
        ["X-axis", x],
        ["Y-axis", y],
        ["Pearson r", formatNumber(r, 4)],
        ["Relationship", relationship]
      ]);
      const plot = document.createElement("div");
      plot.className = "ml-plot-wrap";
      plot.appendChild(makeScatterSvg(points, x, y, state.ui.scatterColor, !!state.ui.scatterTrend));
      output.appendChild(plot);
      if (state.ui.scatterTrend) {
        const fit = simpleLinearFit(xs, ys);
        addOutputBlock(output, "Simple Trend", "R^2 = " + formatNumber(fit.r2, 4) + "\nSlope = " + formatNumber(fit.slope, 4) + "\nIntercept = " + formatNumber(fit.intercept, 4));
      } else if (state.ui.scatterCorrelation) {
        addOutputBlock(output, "Correlation", "r = " + formatNumber(r, 4) + "\n" + relationship);
      }
    }

    root.appendChild(controls);
    root.appendChild(output);
  }


  function renderDatasetSplitter() {
    const root = renderShell("Dataset Splitter");
    if (!requireDataset(root)) return;

    const controls = document.createElement("div");
    controls.innerHTML = '<div class="settings three"><div><label for="ml-split-target">Target</label><select id="ml-split-target"></select></div><div><label for="ml-train-percent">Train %</label><input id="ml-train-percent" type="number" min="10" max="90" step="1"></div><div><label for="ml-split-seed">Random seed</label><input id="ml-split-seed" type="number" step="1"></div></div><h3>Input Features</h3><div class="feature-checklist" data-feature-list></div><div class="buttons"><button type="button" data-create-split>Create split</button></div><div class="message" data-split-message role="status" aria-live="polite"></div>';
    const targetSelect = controls.querySelector("#ml-split-target");
    fillSelect(targetSelect, [""].concat(dataset.numericColumns), state.ui.splitTarget, "Choose target");
    controls.querySelector("#ml-train-percent").value = state.ui.trainPercent;
    controls.querySelector("#ml-split-seed").value = state.ui.splitSeed;
    renderFeatureChecklist(controls.querySelector("[data-feature-list]"));
    targetSelect.addEventListener("change", () => {
      state.ui.splitTarget = targetSelect.value;
      state.ui.selectedFeatures = state.ui.selectedFeatures.filter((feature) => feature !== targetSelect.value);
      renderDatasetSplitter();
    });
    controls.querySelector("#ml-train-percent").addEventListener("change", (event) => { state.ui.trainPercent = event.target.value; });
    controls.querySelector("#ml-split-seed").addEventListener("change", (event) => { state.ui.splitSeed = event.target.value; });
    controls.querySelectorAll("[data-feature]").forEach((box) => box.addEventListener("change", () => collectSelectedFeatures(controls)));
    controls.querySelector("[data-create-split]").addEventListener("click", () => {
      collectSelectedFeatures(controls);
      state.ui.splitTarget = targetSelect.value;
      state.ui.trainPercent = controls.querySelector("#ml-train-percent").value;
      state.ui.splitSeed = controls.querySelector("#ml-split-seed").value;
      try {
        state.splitConfig = {
          target: state.ui.splitTarget,
          trainPercent: state.ui.trainPercent,
          seed: state.ui.splitSeed,
          selectedFeatures: state.ui.selectedFeatures.slice()
        };
        split = createSplitFromConfig(state.splitConfig);
        state.models = [];
        addMessage(controls.querySelector("[data-split-message]"), "Split created.", "ok");
        saveState();
        renderDatasetSplitter();
      } catch (err) {
        showMessage(controls.querySelector("[data-split-message]"), err.message || String(err), "error");
      }
    });

    const output = document.createElement("div");
    if (!split) {
      addMessage(output, "Create a split before training models.", "error");
    } else {
      const warnings = splitWarnings(split.selectedFeatures);
      warnings.forEach((warning) => addMessage(output, warning, "error"));
      addMetrics(output, [
        ["Training samples", split.trainRows.length],
        ["Validation samples", split.validationRows.length],
        ["Target", split.target],
        ["Encoded inputs", split.featureNames.length]
      ]);
      addOutputBlock(output, "Included Features", split.selectedFeatures.join(", "));
      addOutputBlock(output, "Encoded Columns", split.featureNames.join(", "));
      renderTable(output, "Training Preview", previewHeaders(split), previewRows(split.trainRows.slice(0, 6), split));
      renderTable(output, "Validation Preview", previewHeaders(split), previewRows(split.validationRows.slice(0, 6), split));
    }

    root.appendChild(controls);
    root.appendChild(output);
  }


  function renderRegressionTrainer() {
    const root = renderShell("Regression Trainer");
    if (!requireDataset(root)) return;
    if (!requireSplit(root)) return;

    const controls = document.createElement("div");
    controls.innerHTML = '<div class="buttons"><button type="button" data-train-model>Train regression model</button></div><div class="message" data-train-message role="status" aria-live="polite"></div>';
    controls.querySelector("[data-train-model]").addEventListener("click", () => {
      try {
        const model = trainCurrentModel();
        state.models.push(model);
        saveState();
        renderRegressionTrainer();
      } catch (err) {
        showMessage(controls.querySelector("[data-train-message]"), err.message || String(err), "error");
      }
    });

    const output = document.createElement("div");
    if (!state.models.length) addMessage(output, "No models trained yet.", "error");
    else renderModelDetails(output, latestModel());
    renderModelHistory(output);

    root.appendChild(controls);
    root.appendChild(output);
  }



  function renderClassifierEvaluator() {
    const root = renderShell("Classifier Evaluator");
    if (!requireDataset(root)) return;
    if (!requireSplit(root)) return;
    if (!state.models.length) {
      addMessage(root, "Train at least one regression model first.", "error");
      return;
    }

    if (state.ui.classifierModelId && !findModel(state.ui.classifierModelId)) state.ui.classifierModelId = "";
    const controls = document.createElement("div");
    controls.innerHTML = '<div class="settings three"><div><label for="ml-classifier-model">Model</label><select id="ml-classifier-model"></select></div><div><label for="ml-classifier-set">Dataset</label><select id="ml-classifier-set"><option value="">Choose dataset</option><option value="validation">Validation</option><option value="training">Training</option></select></div><div><label for="ml-classifier-threshold">Threshold</label><input id="ml-classifier-threshold" type="number" step="any"></div></div>';
    const modelSelect = controls.querySelector("#ml-classifier-model");
    fillSelect(modelSelect, [""].concat(state.models.map((model) => model.id)), state.ui.classifierModelId, "Choose model");
    controls.querySelector("#ml-classifier-set").value = state.ui.classifierSet;
    controls.querySelector("#ml-classifier-threshold").value = state.ui.classifierThreshold;
    controls.querySelectorAll("select,input").forEach((control) => control.addEventListener("change", () => {
      state.ui.classifierModelId = modelSelect.value;
      state.ui.classifierSet = controls.querySelector("#ml-classifier-set").value;
      state.ui.classifierThreshold = controls.querySelector("#ml-classifier-threshold").value;
      renderClassifierEvaluator();
    }));

    const output = document.createElement("div");
    const model = findModel(state.ui.classifierModelId);
    const evalSet = state.ui.classifierSet;
    const threshold = Number(state.ui.classifierThreshold);
    if (!model || !evalSet || state.ui.classifierThreshold === "" || !Number.isFinite(threshold)) {
      addMessage(output, "Choose a model, dataset, and numeric threshold.", "error");
    } else {
      const evaluation = evaluateClassifier(model, evalSet, threshold);
      addMetrics(output, [
        ["Threshold", threshold],
        ["Positive class", POSITIVE_CLASS],
        ["Accuracy", formatPercent(evaluation.accuracy)],
        ["Sensitivity", formatPercent(evaluation.sensitivity)],
        ["Specificity", formatPercent(evaluation.specificity)]
      ]);
      addOutputBlock(output, "Definition", "true high-biomass: true " + model.target + " > " + threshold + "\npredicted high-biomass: predicted " + model.target + " > " + threshold + "\nThe model predicts biomass, not probability.");
      renderTable(output, "Confusion Matrix", ["", "Predicted high-biomass", "Predicted low-biomass"], [
        ["True high-biomass", evaluation.tp, evaluation.fn],
        ["True low-biomass", evaluation.fp, evaluation.tn]
      ]);
      renderTable(output, "Threshold Comparison", ["Threshold", "Accuracy", "Sensitivity", "Specificity", "Predicted high-biomass"], thresholdComparisonValues(threshold).map((value) => {
        const e = evaluateClassifier(model, evalSet, value);
        return [value, formatPercent(e.accuracy), formatPercent(e.sensitivity), formatPercent(e.specificity), e.predictedHigh];
      }));
      renderTable(output, "Misclassified Samples", ["Row", "True biomass", "Predicted biomass", "True class", "Predicted class"], evaluation.misclassified.slice(0, 25).map((item) => [item.rowNumber, formatNumber(item.actual, 3), formatNumber(item.predicted, 3), item.actualClass, item.predictedClass]));
    }

    root.appendChild(controls);
    root.appendChild(output);
  }


  function renderClearData() {
    const root = renderShell("Clear Data");
    const box = document.createElement("div");
    box.innerHTML = '<div class="buttons"><button type="button" data-clear-ml-data>Clear data</button></div><div class="message" data-clear-message role="status" aria-live="polite"></div>';
    const message = box.querySelector("[data-clear-message]");
    box.querySelector("[data-clear-ml-data]").addEventListener("click", () => {
      if (!window.confirm("Clear saved Machine Learning Tools inputs, splits, models, and outputs?")) return;
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (err) { /* no-op */ }
      state = defaultState();
      dataset = null;
      split = null;
      loadError = "";
      showMessage(message, "Saved data cleared.", "ok");
      setTimeout(() => setActiveTool(DEFAULT_TOOL), 350);
    });
    root.appendChild(box);
  }

  function requireDataset(parent) {
    if (dataset) return true;
    addMessage(parent, loadError || "Load a dataset first.", "error");
    return false;
  }

  function requireSplit(parent) {
    if (split) return true;
    addMessage(parent, "Create a training/validation split first.", "error");
    return false;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (inQuotes && text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        row.push(value);
        value = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && text[i + 1] === "\n") i++;
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      } else {
        value += char;
      }
    }
    if (inQuotes) throw new Error("CSV has an unterminated quoted field.");
    if (value.length || row.length) {
      row.push(value);
      rows.push(row);
    }
    return rows.filter((candidate) => candidate.some((cell) => String(cell).trim() !== ""));
  }

  function buildDataset(text) {
    const parsedRows = parseCsv(text.trim());
    if (parsedRows.length < 2) throw new Error("CSV must include a header row and at least one data row.");
    const headers = parsedRows[0].map((header) => String(header).trim());
    if (headers.some((header) => !header)) throw new Error("CSV headers cannot be blank.");
    const duplicate = headers.find((header, index) => headers.indexOf(header) !== index);
    if (duplicate) throw new Error("Duplicate column header: " + duplicate);

    const status = {};
    REQUIRED_COLUMNS.forEach((column) => { status[column] = headers.includes(column); });
    const missing = REQUIRED_COLUMNS.filter((column) => !status[column]);
    if (missing.length) throw new Error("Dataset is missing expected columns: " + missing.join(", "));

    const rows = parsedRows.slice(1).map((cells, rowIndex) => {
      if (cells.length > headers.length) throw new Error("Row " + (rowIndex + 2) + " has more fields than the header row.");
      const row = {};
      headers.forEach((header, columnIndex) => {
        row[header] = cells[columnIndex] === undefined ? "" : String(cells[columnIndex]).trim();
      });
      row.__rowNumber = rowIndex + 2;
      return row;
    });

    const requiredNumeric = REQUIRED_COLUMNS.filter((column) => column !== "SRG1_class");
    for (const column of requiredNumeric) {
      for (const row of rows) {
        if (!isFiniteNumberString(row[column])) throw new Error("Column " + column + " contains a non-numeric value at CSV row " + row.__rowNumber + ".");
      }
    }

    const numericColumns = headers.filter((header) => header !== "seedling_id" && header !== "SRG1_class" && rows.every((row) => isFiniteNumberString(row[header])));
    const categoricalColumns = headers.filter((header) => !numericColumns.includes(header));
    return { rows, columnNames: headers, numericColumns, categoricalColumns, requiredColumnStatus: status };
  }

  function isFiniteNumberString(value) {
    if (value === null || value === undefined || String(value).trim() === "") return false;
    return Number.isFinite(Number(value));
  }

  function numberValue(row, column) {
    return Number(row[column]);
  }





  function filteredRows() {
    let rows = dataset.rows.slice();
    const column = dataset.columnNames.includes(state.ui.filterColumn) ? state.ui.filterColumn : "";
    if (!column) return rows;
    if (dataset.numericColumns.includes(column)) {
      const min = state.ui.filterMin === "" ? null : Number(state.ui.filterMin);
      const max = state.ui.filterMax === "" ? null : Number(state.ui.filterMax);
      rows = rows.filter((row) => {
        const value = numberValue(row, column);
        if (min !== null && value < min) return false;
        if (max !== null && value > max) return false;
        return true;
      });
    } else if (state.ui.filterValue && state.ui.filterValue !== "All") {
      rows = rows.filter((row) => row[column] === state.ui.filterValue);
    }
    return rows;
  }


  function countBy(rows, column) {
    const counts = {};
    rows.forEach((row) => {
      const key = row[column] || "blank";
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }

  function uniqueColumnValues(column) {
    return Array.from(new Set(dataset.rows.map((row) => row[column]).filter((value) => value !== ""))).sort();
  }

  function summaryCategoricalColumns() {
    return dataset.categoricalColumns.filter((column) => column !== "seedling_id" && column !== "SRG1_class" && uniqueColumnValues(column).length <= 30);
  }

  function colorByColumns() {
    return dataset.columnNames.filter((column) => column !== "seedling_id" && uniqueColumnValues(column).length > 1 && uniqueColumnValues(column).length <= 30);
  }

  function thresholdComparisonValues(threshold) {
    const values = [threshold - 20, threshold, threshold + 20].filter((value) => Number.isFinite(value));
    return Array.from(new Set(values)).sort((a, b) => a - b);
  }

  function numericSummary(rows) {
    return dataset.numericColumns.map((column) => {
      const values = rows.map((row) => numberValue(row, column)).filter(Number.isFinite);
      return [column, formatNumber(mean(values), 4), formatNumber(sampleStd(values), 4), formatNumber(min(values), 4), formatNumber(max(values), 4)];
    });
  }

  function possibleFeatures() {
    if (!dataset) return [];
    const target = state.ui.splitTarget;
    return dataset.columnNames.filter((column) => {
      if (column === target) return false;
      if (dataset.numericColumns.includes(column)) return true;
      return column !== "seedling_id" && uniqueColumnValues(column).length > 1 && uniqueColumnValues(column).length <= 30;
    });
  }




  function renderFeatureChecklist(parent) {
    const selected = new Set(Array.isArray(state.ui.selectedFeatures) ? state.ui.selectedFeatures : []);
    const features = possibleFeatures();
    if (!features.length) {
      const note = document.createElement("div");
      note.className = "tool-note";
      note.textContent = "No eligible input features for the selected target.";
      parent.appendChild(note);
      return;
    }
    features.forEach((feature) => {
      const label = document.createElement("label");
      label.className = "feature-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.feature = feature;
      input.checked = selected.has(feature);
      label.appendChild(input);
      const span = document.createElement("span");
      span.textContent = feature + featureTag(feature);
      label.appendChild(span);
      parent.appendChild(label);
    });
  }


  function featureTag(feature) {
    if (dataset && !dataset.numericColumns.includes(feature)) return " (one-hot)";
    return "";
  }


  function collectSelectedFeatures(scope) {
    state.ui.selectedFeatures = Array.from(scope.querySelectorAll("[data-feature]:checked")).map((input) => input.dataset.feature);
  }



  function splitWarnings(features) {
    const warnings = [];
    if (features.length < 2) warnings.push("Very few input features are selected.");
    return warnings;
  }


  function createSplitFromConfig(config) {
    if (!dataset) throw new Error("Load a dataset first.");
    const target = config.target || "";
    if (!target) throw new Error("Choose a target column.");
    if (!dataset.numericColumns.includes(target)) throw new Error("Target must be a numeric column.");
    const percent = Number(config.trainPercent);
    if (!Number.isFinite(percent) || percent < 10 || percent > 90) throw new Error("Enter a train percentage between 10 and 90.");
    if (config.seed === "" || config.seed === null || config.seed === undefined || !Number.isFinite(Number(config.seed))) throw new Error("Enter a numeric random seed.");
    const features = (config.selectedFeatures || []).filter((feature) => feature !== target && possibleFeatures().includes(feature));
    if (!features.length) throw new Error("Select at least one input feature.");
    const shuffled = shuffledIndices(dataset.rows.length, Number(config.seed));
    const trainCount = clamp(Math.round(dataset.rows.length * percent / 100), 1, dataset.rows.length - 1);
    const trainRows = shuffled.slice(0, trainCount).map((index) => dataset.rows[index]);
    const validationRows = shuffled.slice(trainCount).map((index) => dataset.rows[index]);
    const categories = {};
    features.forEach((feature) => {
      if (!dataset.numericColumns.includes(feature)) categories[feature] = uniqueColumnValues(feature);
    });
    const trainEncoded = encodeRows(trainRows, features, categories);
    const validationEncoded = encodeRows(validationRows, features, categories);
    return {
      target,
      selectedFeatures: features,
      trainPercent: percent,
      seed: Number(config.seed),
      trainRows,
      validationRows,
      categories,
      featureNames: trainEncoded.featureNames,
      trainX: trainEncoded.matrix,
      validationX: validationEncoded.matrix,
      trainY: trainRows.map((row) => numberValue(row, target)),
      validationY: validationRows.map((row) => numberValue(row, target))
    };
  }


  function encodeRows(rows, features, categories) {
    const featureNames = [];
    features.forEach((feature) => {
      if (categories[feature]) {
        categories[feature].forEach((category) => featureNames.push(feature + "_" + sanitizeName(category)));
      } else {
        featureNames.push(feature);
      }
    });
    const matrix = rows.map((row) => {
      const values = [];
      features.forEach((feature) => {
        if (categories[feature]) {
          categories[feature].forEach((category) => values.push(row[feature] === category ? 1 : 0));
        } else {
          values.push(numberValue(row, feature));
        }
      });
      return values;
    });
    return { featureNames, matrix };
  }


  function sanitizeName(value) {
    return String(value || "blank").replace(/[^A-Za-z0-9]+/g, "_");
  }

  function shuffledIndices(length, seed) {
    const rng = seededRandom(seed);
    const indices = Array.from({ length }, (_, index) => index);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const temp = indices[i];
      indices[i] = indices[j];
      indices[j] = temp;
    }
    return indices;
  }

  function trainCurrentModel() {
    if (!split) throw new Error("Create a split first.");
    const trainX = split.trainX.map((row) => row.slice());
    const validationX = split.validationX.map((row) => row.slice());
    const featureNames = split.featureNames.slice();
    const fitted = fitLinearRegression(trainX, split.trainY);
    const trainPred = predictRows(trainX, fitted);
    const validationPred = predictRows(validationX, fitted);
    const id = "Model " + (state.models.length + 1);
    return {
      id,
      target: split.target,
      selectedFeatures: split.selectedFeatures.slice(),
      featureNames,
      intercept: fitted.intercept,
      coefficients: fitted.coefficients,
      ridge: fitted.ridge,
      trainPredictions: trainPred,
      validationPredictions: validationPred,
      trainActual: split.trainY.slice(),
      validationActual: split.validationY.slice(),
      trainRowNumbers: split.trainRows.map((row) => row.__rowNumber),
      validationRowNumbers: split.validationRows.map((row) => row.__rowNumber),
      metrics: {
        trainR2: rSquared(split.trainY, trainPred),
        validationR2: rSquared(split.validationY, validationPred),
        trainRmse: rmse(split.trainY, trainPred),
        validationRmse: rmse(split.validationY, validationPred)
      }
    };
  }





  function fitLinearRegression(matrix, y) {
    if (!matrix.length) throw new Error("No training rows are available.");
    const p = matrix[0].length;
    const size = p + 1;
    const xtx = Array.from({ length: size }, () => new Array(size).fill(0));
    const xty = new Array(size).fill(0);
    matrix.forEach((row, index) => {
      const x = [1].concat(row);
      for (let i = 0; i < size; i++) {
        xty[i] += x[i] * y[index];
        for (let j = 0; j < size; j++) xtx[i][j] += x[i] * x[j];
      }
    });
    const lambdas = [0, 1e-10, 1e-8, 1e-6, 1e-4];
    for (const lambda of lambdas) {
      const a = xtx.map((row, i) => row.map((value, j) => value + (lambda && i === j && i > 0 ? lambda : 0)));
      const beta = solveLinearSystem(a, xty.slice());
      if (beta) return { intercept: beta[0], coefficients: beta.slice(1), ridge: lambda };
    }
    throw new Error("Linear regression could not solve the selected feature matrix.");
  }

  function solveLinearSystem(a, b) {
    const n = b.length;
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
      if (Math.abs(a[pivot][col]) < 1e-12) return null;
      if (pivot !== col) {
        const tempRow = a[col];
        a[col] = a[pivot];
        a[pivot] = tempRow;
        const tempB = b[col];
        b[col] = b[pivot];
        b[pivot] = tempB;
      }
      const divisor = a[col][col];
      for (let j = col; j < n; j++) a[col][j] /= divisor;
      b[col] /= divisor;
      for (let row = 0; row < n; row++) {
        if (row === col) continue;
        const factor = a[row][col];
        for (let j = col; j < n; j++) a[row][j] -= factor * a[col][j];
        b[row] -= factor * b[col];
      }
    }
    return b;
  }

  function predictRows(matrix, model) {
    return matrix.map((row) => model.intercept + row.reduce((sum, value, index) => sum + value * model.coefficients[index], 0));
  }

  function renderModelDetails(parent, model) {
    addMetrics(parent, [
      ["Model", model.id],
      ["Training R^2", formatNumber(model.metrics.trainR2, 4)],
      ["Validation R^2", formatNumber(model.metrics.validationR2, 4)],
      ["Training RMSE", formatNumber(model.metrics.trainRmse, 4)],
      ["Validation RMSE", formatNumber(model.metrics.validationRmse, 4)]
    ]);
    addOutputBlock(parent, "Intercept", formatNumber(model.intercept, 6));
    renderTable(parent, "Feature Weights", ["Feature", "Coefficient"], model.featureNames.map((name, index) => [name, formatNumber(model.coefficients[index], 6)]));
    renderTable(parent, "Validation Predicted vs True", ["Row", "True biomass", "Predicted biomass", "Residual"], model.validationActual.map((actual, index) => [model.validationRowNumbers[index], formatNumber(actual, 4), formatNumber(model.validationPredictions[index], 4), formatNumber(actual - model.validationPredictions[index], 4)]));
  }

  function renderModelHistory(parent) {
    if (!state.models.length) return;
    renderTable(parent, "Model History", ["Model", "Features", "Train R^2", "Validation R^2", "Train RMSE", "Validation RMSE"], state.models.map((model) => [
      model.id,
      model.selectedFeatures.join(", "),
      formatNumber(model.metrics.trainR2, 4),
      formatNumber(model.metrics.validationR2, 4),
      formatNumber(model.metrics.trainRmse, 4),
      formatNumber(model.metrics.validationRmse, 4)
    ]));
  }



  function latestModel() {
    return state.models[state.models.length - 1];
  }

  function findModel(id) {
    return state.models.find((model) => model.id === id) || null;
  }

  function evaluateClassifier(model, setName, threshold) {
    const actual = setName === "training" ? model.trainActual : model.validationActual;
    const predicted = setName === "training" ? model.trainPredictions : model.validationPredictions;
    const rows = setName === "training" ? model.trainRowNumbers : model.validationRowNumbers;
    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;
    let predictedHigh = 0;
    const misclassified = [];
    actual.forEach((value, index) => {
      const trueHigh = value > threshold;
      const predHigh = predicted[index] > threshold;
      if (predHigh) predictedHigh++;
      if (trueHigh && predHigh) tp++;
      else if (!trueHigh && predHigh) fp++;
      else if (!trueHigh && !predHigh) tn++;
      else fn++;
      if (trueHigh !== predHigh) {
        misclassified.push({
          rowNumber: rows[index],
          actual: value,
          predicted: predicted[index],
          actualClass: trueHigh ? POSITIVE_CLASS : NEGATIVE_CLASS,
          predictedClass: predHigh ? POSITIVE_CLASS : NEGATIVE_CLASS
        });
      }
    });
    const total = actual.length;
    return {
      tp,
      fp,
      tn,
      fn,
      predictedHigh,
      misclassified,
      accuracy: total ? (tp + tn) / total : NaN,
      sensitivity: tp + fn ? tp / (tp + fn) : NaN,
      specificity: tn + fp ? tn / (tn + fp) : NaN
    };
  }

  function previewHeaders(currentSplit) {
    return ["CSV row", currentSplit.target].concat(currentSplit.selectedFeatures);
  }

  function previewRows(rows, currentSplit) {
    return rows.map((row) => [row.__rowNumber, row[currentSplit.target]].concat(currentSplit.selectedFeatures.map((feature) => row[feature])));
  }

  function makeScatterSvg(points, xColumn, yColumn, colorBy, showTrend) {
    const width = 980;
    const height = 520;
    const margin = { top: 28, right: 160, bottom: 72, left: 78 };
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("class", "ml-plot");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", yColumn + " versus " + xColumn);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const xDomain = paddedDomain(xs);
    const yDomain = paddedDomain(ys);
    const xScale = (value) => margin.left + (value - xDomain[0]) / (xDomain[1] - xDomain[0]) * (width - margin.left - margin.right);
    const yScale = (value) => height - margin.bottom - (value - yDomain[0]) / (yDomain[1] - yDomain[0]) * (height - margin.top - margin.bottom);

    addSvgLine(svg, margin.left, height - margin.bottom, width - margin.right, height - margin.bottom, "ml-axis");
    addSvgLine(svg, margin.left, margin.top, margin.left, height - margin.bottom, "ml-axis");
    addSvgText(svg, width / 2, height - 24, xColumn, "ml-axis-label", "middle");
    addSvgText(svg, 20, height / 2, yColumn, "ml-axis-label", "middle", -90);
    for (let i = 0; i <= 5; i++) {
      const xValue = xDomain[0] + (xDomain[1] - xDomain[0]) * i / 5;
      const yValue = yDomain[0] + (yDomain[1] - yDomain[0]) * i / 5;
      const xPos = xScale(xValue);
      const yPos = yScale(yValue);
      addSvgLine(svg, xPos, height - margin.bottom, xPos, height - margin.bottom + 6, "ml-axis");
      addSvgText(svg, xPos, height - margin.bottom + 22, compactNumber(xValue), "ml-tick", "middle");
      addSvgLine(svg, margin.left - 6, yPos, margin.left, yPos, "ml-axis");
      addSvgText(svg, margin.left - 10, yPos + 4, compactNumber(yValue), "ml-tick", "end");
    }

    const palette = ["#1769aa", "#0f766e", "#b45309", "#6f42c1", "#9b1c1c", "#475569"];
    const groups = Array.from(new Set(points.map((point) => colorBy === "none" ? "all" : String(point.row[colorBy])))).sort();
    const colorFor = (group) => palette[Math.max(0, groups.indexOf(group)) % palette.length];
    points.forEach((point) => {
      const group = colorBy === "none" ? "all" : String(point.row[colorBy]);
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", xScale(point.x));
      circle.setAttribute("cy", yScale(point.y));
      circle.setAttribute("r", 4.2);
      circle.setAttribute("class", "ml-point");
      circle.setAttribute("fill", colorFor(group));
      svg.appendChild(circle);
    });
    if (showTrend && points.length > 1) {
      const fit = simpleLinearFit(xs, ys);
      const y1 = fit.intercept + fit.slope * xDomain[0];
      const y2 = fit.intercept + fit.slope * xDomain[1];
      addSvgLine(svg, xScale(xDomain[0]), yScale(y1), xScale(xDomain[1]), yScale(y2), "ml-trend-line");
    }
    if (colorBy !== "none") {
      addSvgText(svg, width - margin.right + 26, margin.top + 10, colorBy, "ml-axis-label", "start");
      groups.slice(0, 10).forEach((group, index) => {
        const y = margin.top + 34 + index * 22;
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", width - margin.right + 26);
        rect.setAttribute("y", y - 10);
        rect.setAttribute("width", 12);
        rect.setAttribute("height", 12);
        rect.setAttribute("fill", colorFor(group));
        svg.appendChild(rect);
        addSvgText(svg, width - margin.right + 44, y, group, "ml-tick", "start");
      });
    }
    return svg;
  }

  function addSvgLine(svg, x1, y1, x2, y2, className) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("class", className);
    svg.appendChild(line);
  }

  function addSvgText(svg, x, y, text, className, anchor, rotate) {
    const node = document.createElementNS(SVG_NS, "text");
    node.setAttribute("x", x);
    node.setAttribute("y", y);
    node.setAttribute("class", className);
    node.setAttribute("text-anchor", anchor || "start");
    if (rotate) node.setAttribute("transform", "rotate(" + rotate + " " + x + " " + y + ")");
    node.textContent = text;
    svg.appendChild(node);
  }

  function addMetrics(parent, items) {
    const grid = document.createElement("div");
    grid.className = "metric-grid";
    items.forEach(([label, value]) => {
      const box = document.createElement("div");
      box.className = "metric";
      const span = document.createElement("span");
      span.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = String(value);
      box.appendChild(span);
      box.appendChild(strong);
      grid.appendChild(box);
    });
    parent.appendChild(grid);
  }

  function addOutputBlock(parent, title, text) {
    const h3 = document.createElement("h3");
    h3.textContent = title;
    const block = document.createElement("div");
    block.className = "output-block";
    block.textContent = text;
    parent.appendChild(h3);
    parent.appendChild(block);
  }

  function addMessage(parent, text, type) {
    const box = document.createElement("div");
    box.className = "message " + type;
    box.textContent = text;
    parent.appendChild(box);
    return box;
  }

  function showMessage(box, text, type) {
    box.textContent = text;
    box.className = "message " + type;
  }

  function renderTable(parent, title, headers, rows) {
    const h3 = document.createElement("h3");
    h3.textContent = title;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "secondary compact-copy";
    copy.textContent = "Copy table";
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    headers.forEach((header) => appendCell(headRow, header, "th"));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    if (!rows.length) {
      const row = document.createElement("tr");
      const cell = appendCell(row, "No rows", "td");
      cell.colSpan = headers.length;
      tbody.appendChild(row);
    } else {
      rows.forEach((values) => {
        const row = document.createElement("tr");
        values.forEach((value) => appendCell(row, value, "td"));
        tbody.appendChild(row);
      });
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    copy.addEventListener("click", () => copyText(toTsv(headers, rows)));
    parent.appendChild(h3);
    parent.appendChild(copy);
    parent.appendChild(wrap);
  }

  function appendCell(row, value, tag) {
    const cell = document.createElement(tag);
    cell.textContent = value === null || value === undefined ? "" : String(value);
    row.appendChild(cell);
    return cell;
  }

  function toTsv(headers, rows) {
    return [headers].concat(rows).map((row) => row.map((value) => String(value === null || value === undefined ? "" : value).replace(/\t/g, " ")).join("\t")).join("\n");
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand("copy"); } catch (err) { /* no-op */ }
    document.body.removeChild(textarea);
  }

  function fillSelect(select, values, selected, blankLabel) {
    select.textContent = "";
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value === "" ? (blankLabel || "") : value;
      if (String(value) === String(selected)) option.selected = true;
      select.appendChild(option);
    });
  }

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
  }

  function sampleStd(values) {
    if (values.length < 2) return NaN;
    const m = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - m, 2), 0) / (values.length - 1));
  }

  function min(values) {
    return values.length ? Math.min(...values) : NaN;
  }

  function max(values) {
    return values.length ? Math.max(...values) : NaN;
  }

  function pearson(xs, ys) {
    if (xs.length !== ys.length || xs.length < 2) return NaN;
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let dx = 0;
    let dy = 0;
    xs.forEach((x, index) => {
      const a = x - mx;
      const b = ys[index] - my;
      num += a * b;
      dx += a * a;
      dy += b * b;
    });
    return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
  }

  function simpleLinearFit(xs, ys) {
    const r = pearson(xs, ys);
    const mx = mean(xs);
    const my = mean(ys);
    const varianceX = xs.reduce((sum, x) => sum + Math.pow(x - mx, 2), 0);
    const covariance = xs.reduce((sum, x, index) => sum + (x - mx) * (ys[index] - my), 0);
    const slope = varianceX ? covariance / varianceX : 0;
    const intercept = my - slope * mx;
    return { slope, intercept, r, r2: Number.isFinite(r) ? r * r : NaN };
  }

  function rSquared(actual, predicted) {
    const m = mean(actual);
    const ssTot = actual.reduce((sum, value) => sum + Math.pow(value - m, 2), 0);
    const ssRes = actual.reduce((sum, value, index) => sum + Math.pow(value - predicted[index], 2), 0);
    return ssTot ? 1 - ssRes / ssTot : NaN;
  }

  function rmse(actual, predicted) {
    return actual.length ? Math.sqrt(actual.reduce((sum, value, index) => sum + Math.pow(value - predicted[index], 2), 0) / actual.length) : NaN;
  }

  function relationshipText(r) {
    if (!Number.isFinite(r) || Math.abs(r) < 0.25) return "weak/no clear relationship";
    return r > 0 ? "positive relationship" : "negative relationship";
  }

  function paddedDomain(values) {
    const lo = min(values);
    const hi = max(values);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
    if (lo === hi) return [lo - 1, hi + 1];
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }

  function formatNumber(value, digits) {
    if (!Number.isFinite(Number(value))) return "NA";
    return Number(value).toFixed(digits === undefined ? 3 : digits);
  }

  function formatPercent(value) {
    return Number.isFinite(Number(value)) ? (Number(value) * 100).toFixed(1) + "%" : "NA";
  }

  function compactNumber(value) {
    if (!Number.isFinite(Number(value))) return "NA";
    const abs = Math.abs(value);
    if (abs >= 1000 || abs < 0.01) return Number(value).toExponential(1);
    return Number(value).toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2);
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function seededRandom(seed) {
    let t = (Number(seed) || 1) >>> 0;
    return function () {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }



  buttons.forEach((button) => {
    button.addEventListener("click", () => setActiveTool(button.dataset.mlTool));
  });
  window.addEventListener("hashchange", () => {
    state.activeTool = activeId();
    render();
  });
  render();
})();
