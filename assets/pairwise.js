(() => {
  const DNA_ALLOWED = /^[ACGTUNRYKMSWBDHV.-]+$/i;
  const MAX_CELLS = 6000000;

  const refBox = document.getElementById("usabo-ref-seq");
  const sampleBox = document.getElementById("usabo-sample-seq");
  const runButton = document.getElementById("usabo-run-align");
  const clearButton = document.getElementById("usabo-clear");
  const copyButton = document.getElementById("usabo-copy-results");
  const messageBox = document.getElementById("usabo-message");
  const resultsBox = document.getElementById("usabo-results");
  const summaryBox = document.getElementById("usabo-summary");
  const alignmentBox = document.getElementById("usabo-alignment");
  const variantsBox = document.getElementById("usabo-variants");

  if (!refBox || !sampleBox || !runButton) return;

  let latestResultsText = "";

  function showMessage(text, type) {
    messageBox.textContent = text;
    messageBox.className = "message " + type;
  }

  function clearMessage() {
    messageBox.textContent = "";
    messageBox.className = "message";
  }

  function parseFasta(input, fieldName) {
    const raw = input.trim();

    if (!raw) {
      throw new Error(fieldName + " is empty.");
    }

    const lines = raw.split(/\r?\n/);
    let header = "";
    const seqParts = [];
    let seenSequence = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith(">")) {
        if (seenSequence) {
          throw new Error(fieldName + " contains more than one FASTA sequence. Paste exactly one sequence in this box.");
        }
        header = trimmed.substring(1).trim() || fieldName;
      } else {
        seenSequence = true;
        seqParts.push(trimmed);
      }
    }

    if (!header) header = fieldName;

    let sequence = seqParts.join("")
      .replace(/\s+/g, "")
      .replace(/[0-9]/g, "")
      .toUpperCase()
      .replace(/U/g, "T");

    if (!sequence) {
      throw new Error(fieldName + " does not contain a sequence.");
    }

    if (!DNA_ALLOWED.test(sequence)) {
      throw new Error(fieldName + " contains invalid characters.");
    }

    sequence = sequence.replace(/[^ACGTNRYKMSWBDHV.-]/g, "");

    return { header, sequence };
  }

  function getScoringSettings() {
    const matchScore = Number(document.getElementById("usabo-match").value);
    const mismatchScore = Number(document.getElementById("usabo-mismatch").value);
    const gapScore = Number(document.getElementById("usabo-gap").value);
    const wrapWidth = Number(document.getElementById("usabo-wrap").value);

    if (![matchScore, mismatchScore, gapScore, wrapWidth].every(Number.isFinite)) {
      throw new Error("Scoring settings must be valid numbers.");
    }

    if (wrapWidth < 10) {
      throw new Error("Wrap width must be at least 10.");
    }

    return { matchScore, mismatchScore, gapScore, wrapWidth };
  }

  function needlemanWunsch(ref, sample, matchScore, mismatchScore, gapScore) {
    const m = ref.length;
    const n = sample.length;
    const cellCount = (m + 1) * (n + 1);

    if (cellCount > MAX_CELLS) {
      throw new Error("These sequences are too long for this browser tool. Try shorter sequences or a command-line aligner.");
    }

    const score = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
    const trace = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1));

    for (let i = 1; i <= m; i++) {
      score[i][0] = score[i - 1][0] + gapScore;
      trace[i][0] = 2;
    }

    for (let j = 1; j <= n; j++) {
      score[0][j] = score[0][j - 1] + gapScore;
      trace[0][j] = 3;
    }

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const diagScore = score[i - 1][j - 1] + (ref[i - 1] === sample[j - 1] ? matchScore : mismatchScore);
        const upScore = score[i - 1][j] + gapScore;
        const leftScore = score[i][j - 1] + gapScore;
        const best = Math.max(diagScore, upScore, leftScore);

        score[i][j] = best;
        if (best === diagScore) trace[i][j] = 1;
        else if (best === upScore) trace[i][j] = 2;
        else trace[i][j] = 3;
      }
    }

    const alignedRef = [];
    const alignedSample = [];
    let i = m;
    let j = n;

    while (i > 0 || j > 0) {
      const direction = trace[i][j];

      if (i > 0 && j > 0 && direction === 1) {
        alignedRef.push(ref[i - 1]);
        alignedSample.push(sample[j - 1]);
        i--;
        j--;
      } else if (i > 0 && (direction === 2 || j === 0)) {
        alignedRef.push(ref[i - 1]);
        alignedSample.push("-");
        i--;
      } else {
        alignedRef.push("-");
        alignedSample.push(sample[j - 1]);
        j--;
      }
    }

    return {
      alignedRef: alignedRef.reverse().join(""),
      alignedSample: alignedSample.reverse().join(""),
      score: score[m][n]
    };
  }

  function summarizeAlignment(alignedRef, alignedSample) {
    let matches = 0;
    let mismatches = 0;
    let gaps = 0;

    for (let i = 0; i < alignedRef.length; i++) {
      const a = alignedRef[i];
      const b = alignedSample[i];

      if (a === "-" || b === "-") gaps++;
      else if (a === b) matches++;
      else mismatches++;
    }

    const nonGapColumns = matches + mismatches;

    return {
      matches,
      mismatches,
      gaps,
      alignedLength: alignedRef.length,
      identityAll: alignedRef.length > 0 ? (matches / alignedRef.length) * 100 : 0,
      identityNoGaps: nonGapColumns > 0 ? (matches / nonGapColumns) * 100 : 0
    };
  }

  function makeAlignmentDisplay(refName, sampleName, alignedRef, alignedSample, wrapWidth) {
    const blocks = [];

    for (let start = 0; start < alignedRef.length; start += wrapWidth) {
      const refChunk = alignedRef.slice(start, start + wrapWidth);
      const sampleChunk = alignedSample.slice(start, start + wrapWidth);
      let midline = "";

      for (let i = 0; i < refChunk.length; i++) {
        const a = refChunk[i];
        const b = sampleChunk[i];

        if (a === b && a !== "-") midline += "|";
        else if (a === "-" || b === "-") midline += " ";
        else midline += ".";
      }

      blocks.push(refName + "\n" + refChunk + "\n" + midline + "\n" + sampleName + "\n" + sampleChunk);
    }

    return blocks.join("\n\n");
  }

  function getVariants(alignedRef, alignedSample) {
    const variants = [];
    let refPos = 0;

    for (let i = 0; i < alignedRef.length; i++) {
      const r = alignedRef[i];
      const s = alignedSample[i];

      if (r !== "-") refPos++;
      if (r === s) continue;

      if (r === "-") {
        variants.push({ position: "after " + refPos, reference: "-", sample: s, type: "insertion" });
      } else if (s === "-") {
        variants.push({ position: refPos, reference: r, sample: "-", type: "deletion" });
      } else {
        variants.push({ position: refPos, reference: r, sample: s, type: "substitution" });
      }
    }

    return variants;
  }

  function appendTextCell(row, value, cellTag) {
    const cell = document.createElement(cellTag || "td");
    cell.textContent = value;
    row.appendChild(cell);
  }

  function renderSummary(items) {
    summaryBox.textContent = "";

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
      summaryBox.appendChild(box);
    }
  }

  function renderVariants(variants) {
    variantsBox.textContent = "";

    if (variants.length === 0) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = "No differences detected.";
      p.appendChild(strong);
      variantsBox.appendChild(p);
      return;
    }

    const tableWrap = document.createElement("div");
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    const headerRow = document.createElement("tr");

    tableWrap.className = "table-wrap";

    for (const heading of ["Reference position", "Reference base", "Sample base", "Type"]) {
      appendTextCell(headerRow, heading, "th");
    }

    thead.appendChild(headerRow);

    for (const variant of variants) {
      const row = document.createElement("tr");
      appendTextCell(row, variant.position);
      appendTextCell(row, variant.reference);
      appendTextCell(row, variant.sample);
      appendTextCell(row, variant.type);
      tbody.appendChild(row);
    }

    table.append(thead, tbody);
    tableWrap.appendChild(table);
    variantsBox.appendChild(tableWrap);
  }

  function makeResultsText(ref, sample, result, summary, display, variants) {
    const lines = [
      "Pairwise alignment results",
      "Reference: " + ref.header,
      "Sample: " + sample.header,
      "Reference length: " + ref.sequence.replace(/-/g, "").length,
      "Sample length: " + sample.sequence.replace(/-/g, "").length,
      "Alignment score: " + result.score,
      "Percent identity: " + summary.identityAll.toFixed(2) + "%",
      "Percent identity excluding gaps: " + summary.identityNoGaps.toFixed(2) + "%",
      "Differences: " + variants.length,
      "",
      display
    ];

    if (variants.length > 0) {
      lines.push("", "Variant summary");
      for (const variant of variants) {
        lines.push(variant.position + "\t" + variant.reference + "\t" + variant.sample + "\t" + variant.type);
      }
    }

    return lines.join("\n");
  }

  function runAlignment() {
    clearMessage();

    try {
      const ref = parseFasta(refBox.value, "Reference FASTA");
      const sample = parseFasta(sampleBox.value, "Sample FASTA");
      const settings = getScoringSettings();
      const result = needlemanWunsch(ref.sequence, sample.sequence, settings.matchScore, settings.mismatchScore, settings.gapScore);
      const summary = summarizeAlignment(result.alignedRef, result.alignedSample);
      const variants = getVariants(result.alignedRef, result.alignedSample);
      const display = makeAlignmentDisplay(ref.header, sample.header, result.alignedRef, result.alignedSample, settings.wrapWidth);

      renderSummary([
        { label: "Reference", value: ref.header },
        { label: "Sample", value: sample.header },
        { label: "Reference length", value: ref.sequence.replace(/-/g, "").length },
        { label: "Sample length", value: sample.sequence.replace(/-/g, "").length },
        { label: "Alignment score", value: result.score },
        { label: "Aligned length", value: summary.alignedLength },
        { label: "Matches", value: summary.matches },
        { label: "Mismatches", value: summary.mismatches },
        { label: "Gap columns", value: summary.gaps },
        { label: "Percent identity", value: summary.identityAll.toFixed(2) + "%" },
        { label: "Percent identity excluding gaps", value: summary.identityNoGaps.toFixed(2) + "%" },
        { label: "Differences", value: variants.length }
      ]);

      alignmentBox.textContent = display;
      renderVariants(variants);
      latestResultsText = makeResultsText(ref, sample, result, summary, display, variants);

      resultsBox.style.display = "block";
      showMessage("Alignment completed.", "ok");
    } catch (err) {
      resultsBox.style.display = "none";
      latestResultsText = "";
      showMessage(err.message || String(err), "error");
    }
  }

  function clearAll() {
    refBox.value = "";
    sampleBox.value = "";
    resultsBox.style.display = "none";
    latestResultsText = "";
    clearMessage();
  }

  async function copyResults() {
    if (!latestResultsText) {
      showMessage("No results to copy yet. Run an alignment first.", "error");
      return;
    }

    try {
      await navigator.clipboard.writeText(latestResultsText);
      showMessage("Results copied to clipboard.", "ok");
    } catch (err) {
      const temp = document.createElement("textarea");
      temp.value = latestResultsText;
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

  runButton.addEventListener("click", runAlignment);
  clearButton.addEventListener("click", clearAll);
  copyButton.addEventListener("click", copyResults);
})();
