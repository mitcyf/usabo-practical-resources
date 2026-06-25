(() => {
  "use strict";

  const DNA_ALLOWED = /^[ACGTNRYKMSWBDHV.-]+$/i;
  const PROTEIN_ALLOWED = /^[ABCDEFGHIKLMNPQRSTVWXYZ*.-]+$/i;
  const MAX_ALIGNMENT_CELLS = 8000000;

  const IUPAC = {
    A: "A", C: "C", G: "G", T: "T", U: "T",
    R: "[AG]", Y: "[CT]", K: "[GT]", M: "[AC]", S: "[GC]", W: "[AT]",
    B: "[CGT]", D: "[AGT]", H: "[ACT]", V: "[ACG]", N: "[ACGT]"
  };

  const COMPLEMENT = {
    A: "T", T: "A", U: "A", C: "G", G: "C", R: "Y", Y: "R", K: "M", M: "K",
    S: "S", W: "W", B: "V", V: "B", D: "H", H: "D", N: "N", "-": "-", ".": "."
  };

  const CODON_TABLE = {
    TTT: "F", TTC: "F", TTA: "L", TTG: "L", TCT: "S", TCC: "S", TCA: "S", TCG: "S",
    TAT: "Y", TAC: "Y", TGT: "C", TGC: "C", TGG: "W", CTT: "L", CTC: "L", CTA: "L", CTG: "L",
    CCT: "P", CCC: "P", CCA: "P", CCG: "P", CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
    CGT: "R", CGC: "R", CGA: "R", CGG: "R", ATT: "I", ATC: "I", ATA: "I", ATG: "M",
    ACT: "T", ACC: "T", ACA: "T", ACG: "T", AAT: "N", AAC: "N", AAA: "K", AAG: "K",
    AGT: "S", AGC: "S", AGA: "R", AGG: "R", GTT: "V", GTC: "V", GTA: "V", GTG: "V",
    GCT: "A", GCC: "A", GCA: "A", GCG: "A", GAT: "D", GAC: "D", GAA: "E", GAG: "E",
    GGT: "G", GGC: "G", GGA: "G", GGG: "G"
  };

  const GENETIC_CODES = {
    standard: {
      name: "Standard",
      startCodons: ["ATG"],
      stopCodons: ["TAA", "TAG", "TGA"],
      overrides: {}
    },
    bacterial: {
      name: "Bacterial, Archaeal, Plant Plastid",
      startCodons: ["ATG", "GTG", "TTG"],
      stopCodons: ["TAA", "TAG", "TGA"],
      overrides: {}
    },
    "vertebrate-mito": {
      name: "Vertebrate Mitochondrial",
      startCodons: ["ATG", "ATA"],
      stopCodons: ["TAA", "TAG", "AGA", "AGG"],
      overrides: { ATA: "M", TGA: "W", AGA: "*", AGG: "*" }
    }
  };

  const ENZYMES = [
    { name: "EcoRI", site: "G^AATTC" },
    { name: "BamHI", site: "G^GATCC" },
    { name: "HindIII", site: "A^AGCTT" },
    { name: "XhoI", site: "C^TCGAG" },
    { name: "PstI", site: "CTGCA^G" },
    { name: "SmaI", site: "CCC^GGG" },
    { name: "KpnI", site: "GGTAC^C" },
    { name: "SacI", site: "GAGCT^C" },
    { name: "SalI", site: "G^TCGAC" },
    { name: "NdeI", site: "CA^TATG" },
    { name: "NcoI", site: "C^CATGG" },
    { name: "NotI", site: "GC^GGCCGC" },
    { name: "SpeI", site: "A^CTAGT" },
    { name: "XbaI", site: "T^CTAGA" },
    { name: "BglII", site: "A^GATCT" },
    { name: "HaeIII", site: "GG^CC" },
    { name: "AluI", site: "AG^CT" },
    { name: "MspI", site: "C^CGG" },
    { name: "HinfI", site: "G^ANTC" },
    { name: "TaqI", site: "T^CGA" },
    { name: "MboI", site: "^GATC" },
    { name: "DpnI", site: "GA^TC" },
    { name: "SphI", site: "GCATG^C" },
    { name: "AgeI", site: "A^CCGGT" },
    { name: "ApaI", site: "GGGCC^C" },
    { name: "BstEII", site: "G^GTNACC" }
  ];

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
    box.textContent = text;
    box.className = "message " + type;
  }

  function clearMessage() {
    const box = byId("tool-message");
    if (!box) return;
    box.textContent = "";
    box.className = "message";
  }

  function showResults() {
    const section = byId("tool-results");
    if (section) section.style.display = "block";
  }

  function hideResults() {
    const section = byId("tool-results");
    if (section) section.style.display = "none";
  }

  function stripSequenceText(text) {
    return String(text || "").replace(/\s+/g, "").replace(/[0-9]/g, "").toUpperCase();
  }

  function cleanDna(text, fieldName, options = {}) {
    let sequence = stripSequenceText(text).replace(/U/g, "T");
    if (!sequence) throw new Error(fieldName + " is empty.");
    if (!DNA_ALLOWED.test(sequence)) throw new Error(fieldName + " contains invalid nucleotide characters.");
    if (options.allowGaps) sequence = sequence.replace(/\./g, "-");
    else sequence = sequence.replace(/[.-]/g, "");
    if (!sequence) throw new Error(fieldName + " does not contain nucleotide bases.");
    return sequence;
  }

  function cleanAlignmentSequence(text, fieldName, keepGaps) {
    const raw = stripSequenceText(text);
    if (!raw) throw new Error(fieldName + " is empty.");
    const dnaCandidate = raw.replace(/U/g, "T");
    if (DNA_ALLOWED.test(dnaCandidate)) return keepGaps ? dnaCandidate.replace(/\./g, "-") : dnaCandidate.replace(/[.-]/g, "");
    if (PROTEIN_ALLOWED.test(raw)) return keepGaps ? raw.replace(/\./g, "-") : raw.replace(/[.-]/g, "");
    throw new Error(fieldName + " contains characters that are not valid DNA or protein sequence symbols.");
  }

  function parseFastaRecords(input, fallbackPrefix) {
    const raw = String(input || "").trim();
    if (!raw) throw new Error("Input is empty.");

    const records = [];
    const anonymous = [];
    let name = "";
    let parts = [];
    let fastaMode = false;

    function pushRecord() {
      if (!name && parts.length === 0) return;
      records.push({ name: name || fallbackPrefix || "Sequence " + (records.length + 1), rawSequence: parts.join("") });
      name = "";
      parts = [];
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith(">")) {
        fastaMode = true;
        pushRecord();
        name = trimmed.slice(1).trim() || (fallbackPrefix || "Sequence " + (records.length + 1));
      } else if (fastaMode) {
        parts.push(trimmed);
      } else {
        anonymous.push(trimmed);
      }
    }

    if (fastaMode) {
      pushRecord();
    } else {
      records.push({ name: fallbackPrefix || "Sequence 1", rawSequence: anonymous.join("") });
    }

    return records;
  }

  function renderSummary(containerId, items) {
    const container = byId(containerId);
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

  function appendCell(row, value, tagName) {
    const cell = document.createElement(tagName || "td");
    cell.textContent = value;
    row.appendChild(cell);
    return cell;
  }

  function renderTable(containerId, headers, rows) {
    const container = byId(containerId);
    if (!container) return;
    container.textContent = "";

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

  async function copyText(text) {
    if (!text) {
      showMessage("No results to copy yet. Run the tool first.", "error");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showMessage("Results copied to clipboard.", "ok");
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
        showMessage("Results copied to clipboard.", "ok");
      } catch (copyErr) {
        showMessage("Could not copy automatically. Select and copy the results manually.", "error");
      } finally {
        document.body.removeChild(temp);
      }
    }
  }

  function setupCopy(getLatest) {
    const button = byId("copy-results");
    if (button) button.addEventListener("click", () => copyText(getLatest()));
  }

  function reverseComplement(sequence) {
    return sequence.split("").reverse().map((base) => COMPLEMENT[base] || "N").join("");
  }

  function translateCodon(codon, code) {
    if (Object.prototype.hasOwnProperty.call(code.overrides, codon)) return code.overrides[codon];
    if (code.stopCodons.includes(codon)) return "*";
    return CODON_TABLE[codon] || "X";
  }

  function translateCds(cds, code) {
    const aminoAcids = [];
    for (let i = 0; i <= cds.length - 3; i += 3) {
      const codon = cds.slice(i, i + 3);
      let aminoAcid = translateCodon(codon, code);
      if (i === 0 && code.startCodons.includes(codon)) aminoAcid = "M";
      aminoAcids.push(aminoAcid);
      if (aminoAcid === "*") break;
    }
    return aminoAcids.join("");
  }

  function removeContainedOrfs(orfs) {
    return orfs.filter((orf, index) => !orfs.some((other, otherIndex) => (
      otherIndex !== index &&
      other.strand === orf.strand &&
      other.frame === orf.frame &&
      other.start <= orf.start &&
      other.end >= orf.end &&
      other.length > orf.length
    )));
  }

  function findOrfs(sequence, minLength, codeKey) {
    const code = GENETIC_CODES[codeKey] || GENETIC_CODES.standard;
    const scans = [
      { strand: "+", sequence },
      { strand: "-", sequence: reverseComplement(sequence) }
    ];
    const orfs = [];

    for (const scan of scans) {
      for (let frame = 0; frame < 3; frame++) {
        for (let i = frame; i <= scan.sequence.length - 3; i += 3) {
          const codon = scan.sequence.slice(i, i + 3);
          if (!code.startCodons.includes(codon)) continue;

          for (let j = i; j <= scan.sequence.length - 3; j += 3) {
            const current = scan.sequence.slice(j, j + 3);
            if (!code.stopCodons.includes(current)) continue;

            const cds = scan.sequence.slice(i, j + 3);
            if (cds.length >= minLength) {
              let start;
              let end;
              if (scan.strand === "+") {
                start = i + 1;
                end = j + 3;
              } else {
                start = sequence.length - (j + 3) + 1;
                end = sequence.length - i;
              }
              orfs.push({
                strand: scan.strand,
                frame: frame + 1,
                start,
                end,
                length: cds.length,
                cds,
                protein: translateCds(cds, code)
              });
            }
            break;
          }
        }
      }
    }

    return removeContainedOrfs(orfs).sort((a, b) => b.length - a.length || a.start - b.start);
  }

  function initOrfFinder() {
    let latest = "";
    setupCopy(() => latest);

    byId("clear-tool").addEventListener("click", () => {
      byId("orf-input").value = "";
      hideResults();
      latest = "";
      clearMessage();
    });

    byId("run-tool").addEventListener("click", () => {
      clearMessage();
      try {
        const records = parseFastaRecords(valueOf("orf-input"), "Input sequence");
        if (records.length !== 1) throw new Error("Paste exactly one FASTA sequence for ORF finding.");
        const sequence = cleanDna(records[0].rawSequence, "Input sequence", { allowGaps: false });
        const minLength = Number(valueOf("orf-min-length"));
        if (!Number.isFinite(minLength) || minLength < 3) throw new Error("Minimum ORF length must be at least 3 nucleotides.");
        const codeKey = valueOf("orf-code") || "standard";
        const code = GENETIC_CODES[codeKey] || GENETIC_CODES.standard;
        const orfs = findOrfs(sequence, minLength, codeKey);

        renderSummary("orf-summary", [
          { label: "Sequence", value: records[0].name },
          { label: "Length", value: sequence.length + " nt" },
          { label: "Genetic code", value: code.name },
          { label: "Start codons", value: code.startCodons.join(", ") },
          { label: "Stop codons", value: code.stopCodons.join(", ") },
          { label: "Candidate ORFs", value: orfs.length }
        ]);

        renderTable("orf-table", ["ORF", "Strand", "Frame", "Start", "End", "Length", "Coding DNA sequence", "Protein"],
          orfs.map((orf, index) => [index + 1, orf.strand, orf.frame, orf.start, orf.end, orf.length + " nt", orf.cds, orf.protein]));

        if (orfs.length === 0) {
          byId("orf-table").textContent = "No ORFs were found with the current settings.";
        }

        latest = [
          "ORF Finder results",
          "Sequence: " + records[0].name,
          "Length: " + sequence.length + " nt",
          "Genetic code: " + code.name,
          "Minimum ORF length: " + minLength + " nt",
          "Candidate ORFs: " + orfs.length,
          ""
        ].concat(orfs.map((orf, index) => [
          "ORF " + (index + 1),
          "Strand: " + orf.strand,
          "Frame: " + orf.frame,
          "Start: " + orf.start,
          "End: " + orf.end,
          "Length: " + orf.length + " nt",
          "CDS: " + orf.cds,
          "Protein: " + orf.protein
        ].join("\n"))).join("\n\n");

        showResults();
        showMessage("ORF search completed.", "ok");
      } catch (err) {
        hideResults();
        latest = "";
        showMessage(err.message || String(err), "error");
      }
    });
  }

  function recognitionPattern(site) {
    return site.split("").map((base) => IUPAC[base] || base).join("");
  }

  function findRestrictionSites(sequence) {
    const hits = [];
    for (const enzyme of ENZYMES) {
      const cutIndex = enzyme.site.indexOf("^");
      const recognition = enzyme.site.replace("^", "");
      const regex = new RegExp("^" + recognitionPattern(recognition) + "$");
      const starts = [];
      const cuts = [];

      for (let i = 0; i <= sequence.length - recognition.length; i++) {
        const windowSequence = sequence.slice(i, i + recognition.length);
        if (regex.test(windowSequence)) {
          starts.push(i + 1);
          cuts.push(i + cutIndex);
        }
      }

      if (starts.length > 0) {
        hits.push({ enzyme, recognition, starts, cuts, count: starts.length });
      }
    }
    return hits.sort((a, b) => a.enzyme.name.localeCompare(b.enzyme.name));
  }

  function initRestrictionMapper() {
    let latest = "";
    setupCopy(() => latest);

    byId("clear-tool").addEventListener("click", () => {
      byId("restriction-input").value = "";
      hideResults();
      latest = "";
      clearMessage();
    });

    byId("run-tool").addEventListener("click", () => {
      clearMessage();
      try {
        const records = parseFastaRecords(valueOf("restriction-input"), "Input sequence");
        if (records.length !== 1) throw new Error("Paste exactly one DNA sequence for restriction mapping.");
        const sequence = cleanDna(records[0].rawSequence, "Input sequence", { allowGaps: false });
        const hits = findRestrictionSites(sequence);

        renderSummary("restriction-summary", [
          { label: "Sequence", value: records[0].name },
          { label: "Length", value: sequence.length + " nt" },
          { label: "Enzymes checked", value: ENZYMES.length },
          { label: "Enzymes cutting", value: hits.length },
          { label: "Total cut sites", value: hits.reduce((sum, hit) => sum + hit.count, 0) }
        ]);

        renderTable("restriction-table", ["Enzyme", "Recognition site", "Cut sites", "Recognition starts", "Cut coordinates"],
          hits.map((hit) => [hit.enzyme.name, hit.enzyme.site, hit.count, hit.starts.join(", "), hit.cuts.join(", ")]));

        if (hits.length === 0) {
          byId("restriction-table").textContent = "No listed restriction enzymes cut this sequence.";
        }

        latest = [
          "Restriction Mapper results",
          "Sequence: " + records[0].name,
          "Length: " + sequence.length + " nt",
          "Enzymes checked: " + ENZYMES.length,
          "Enzymes cutting: " + hits.length,
          ""
        ].concat(hits.map((hit) => hit.enzyme.name + "\t" + hit.enzyme.site + "\t" + hit.count + "\tstarts " + hit.starts.join(", ") + "\tcuts " + hit.cuts.join(", "))).join("\n");

        showResults();
        showMessage("Restriction map completed.", "ok");
      } catch (err) {
        hideResults();
        latest = "";
        showMessage(err.message || String(err), "error");
      }
    });
  }

  function formatNumberedSequence(sequence, lineWidth) {
    const width = Math.max(10, Number(lineWidth) || 60);
    const lines = [];
    const pad = String(sequence.length).length;
    for (let start = 0; start < sequence.length; start += width) {
      lines.push(String(start + 1).padStart(pad, " ") + "  " + sequence.slice(start, start + width));
    }
    return lines.join("\n");
  }

  function initSequenceEditor() {
    let latest = "";
    setupCopy(() => latest);

    function runSelection() {
      clearMessage();
      try {
        const records = parseFastaRecords(valueOf("editor-input"), "Input sequence");
        if (records.length !== 1) throw new Error("Paste exactly one DNA sequence for the editor.");
        const sequence = cleanDna(records[0].rawSequence, "Input sequence", { allowGaps: false });
        const start = Number(valueOf("editor-start"));
        const end = Number(valueOf("editor-end"));
        const lineWidth = Number(valueOf("editor-line-width")) || 60;

        if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error("Start and end positions must be whole numbers.");
        if (start < 1 || end < start || end > sequence.length) throw new Error("Select a valid 1-based region within the sequence.");

        const selected = sequence.slice(start - 1, end);
        renderSummary("editor-summary", [
          { label: "Sequence", value: records[0].name },
          { label: "Full length", value: sequence.length + " nt" },
          { label: "Start", value: start },
          { label: "End", value: end },
          { label: "Selected length", value: selected.length + " nt" }
        ]);

        byId("editor-viewer").textContent = formatNumberedSequence(sequence, lineWidth);
        byId("editor-selected").textContent = selected;
        latest = [
          "Sequence Editor selection",
          "Sequence: " + records[0].name,
          "Start: " + start,
          "End: " + end,
          "Length: " + selected.length + " nt",
          "Sequence:",
          selected
        ].join("\n");

        showResults();
        showMessage("Selection reported.", "ok");
      } catch (err) {
        hideResults();
        latest = "";
        showMessage(err.message || String(err), "error");
      }
    }

    byId("run-tool").addEventListener("click", runSelection);
    byId("clear-tool").addEventListener("click", () => {
      byId("editor-input").value = "";
      byId("editor-start").value = "1";
      byId("editor-end").value = "1";
      hideResults();
      latest = "";
      clearMessage();
    });

    byId("use-highlighted").addEventListener("click", () => {
      clearMessage();
      try {
        const input = byId("editor-input");
        const selectedRaw = input.value.slice(input.selectionStart, input.selectionEnd);
        const selected = cleanDna(selectedRaw, "Highlighted text", { allowGaps: false });
        const records = parseFastaRecords(input.value, "Input sequence");
        if (records.length !== 1) throw new Error("Paste exactly one DNA sequence for the editor.");
        const sequence = cleanDna(records[0].rawSequence, "Input sequence", { allowGaps: false });
        const index = sequence.indexOf(selected);
        if (index === -1) throw new Error("The highlighted text was not found in the cleaned sequence.");
        byId("editor-start").value = index + 1;
        byId("editor-end").value = index + selected.length;
        runSelection();
      } catch (err) {
        showMessage(err.message || String(err), "error");
      }
    });
  }

  function needlemanWunsch(seqA, seqB, matchScore, mismatchScore, gapScore) {
    const m = seqA.length;
    const n = seqB.length;
    if ((m + 1) * (n + 1) > MAX_ALIGNMENT_CELLS) {
      throw new Error("These sequences are too long for the browser alignment tool.");
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
        const diag = score[i - 1][j - 1] + (seqA[i - 1] === seqB[j - 1] ? matchScore : mismatchScore);
        const up = score[i - 1][j] + gapScore;
        const left = score[i][j - 1] + gapScore;
        const best = Math.max(diag, up, left);
        score[i][j] = best;
        trace[i][j] = best === diag ? 1 : best === up ? 2 : 3;
      }
    }

    const alignedA = [];
    const alignedB = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      const direction = trace[i][j];
      if (i > 0 && j > 0 && direction === 1) {
        alignedA.push(seqA[i - 1]);
        alignedB.push(seqB[j - 1]);
        i--;
        j--;
      } else if (i > 0 && (direction === 2 || j === 0)) {
        alignedA.push(seqA[i - 1]);
        alignedB.push("-");
        i--;
      } else {
        alignedA.push("-");
        alignedB.push(seqB[j - 1]);
        j--;
      }
    }

    return {
      alignedA: alignedA.reverse().join(""),
      alignedB: alignedB.reverse().join(""),
      score: score[m][n]
    };
  }

  function decomposeAgainstReference(alignedRef, alignedSeq, refLength) {
    const insertions = Array.from({ length: refLength + 1 }, () => []);
    const bases = new Array(refLength);
    let refIndex = 0;

    for (let i = 0; i < alignedRef.length; i++) {
      if (alignedRef[i] === "-") {
        insertions[refIndex].push(alignedSeq[i]);
      } else {
        bases[refIndex] = alignedSeq[i];
        refIndex++;
      }
    }

    return { insertions, bases };
  }

  function buildStarAlignment(records, matchScore, mismatchScore, gapScore) {
    const ref = records[0].sequence;

    if (records.length === 2) {
      const result = needlemanWunsch(ref, records[1].sequence, matchScore, mismatchScore, gapScore);
      return { aligned: [result.alignedA, result.alignedB], score: result.score };
    }

    const decomposed = [];
    const maxInsertions = new Array(ref.length + 1).fill(0);
    let totalScore = 0;

    for (let i = 1; i < records.length; i++) {
      const result = needlemanWunsch(ref, records[i].sequence, matchScore, mismatchScore, gapScore);
      totalScore += result.score;
      const parts = decomposeAgainstReference(result.alignedA, result.alignedB, ref.length);
      decomposed.push(parts);
      for (let pos = 0; pos < parts.insertions.length; pos++) {
        maxInsertions[pos] = Math.max(maxInsertions[pos], parts.insertions[pos].length);
      }
    }

    const alignedRef = [];
    for (let pos = 0; pos <= ref.length; pos++) {
      alignedRef.push("-".repeat(maxInsertions[pos]));
      if (pos < ref.length) alignedRef.push(ref[pos]);
    }

    const aligned = [alignedRef.join("")];
    for (const parts of decomposed) {
      const row = [];
      for (let pos = 0; pos <= ref.length; pos++) {
        row.push(parts.insertions[pos].join(""));
        row.push("-".repeat(maxInsertions[pos] - parts.insertions[pos].length));
        if (pos < ref.length) row.push(parts.bases[pos] || "-");
      }
      aligned.push(row.join(""));
    }

    return { aligned, score: totalScore };
  }

  function consensusLine(aligned) {
    const length = aligned[0].length;
    let consensus = "";
    for (let col = 0; col < length; col++) {
      const chars = aligned.map((sequence) => sequence[col]);
      if (chars.includes("-")) consensus += " ";
      else consensus += chars.every((char) => char === chars[0]) ? "|" : ".";
    }
    return consensus;
  }

  function formatAlignment(records, aligned, wrapWidth) {
    const labelWidth = Math.min(20, Math.max(8, ...records.map((record) => record.name.length)));
    const consensus = consensusLine(aligned);
    const blocks = [];
    for (let start = 0; start < aligned[0].length; start += wrapWidth) {
      const lines = [];
      for (let i = 0; i < records.length; i++) {
        const label = records[i].name.slice(0, labelWidth).padEnd(labelWidth, " ");
        lines.push(label + "  " + aligned[i].slice(start, start + wrapWidth));
      }
      lines.push(" ".repeat(labelWidth) + "  " + consensus.slice(start, start + wrapWidth));
      blocks.push(lines.join("\n"));
    }
    return blocks.join("\n\n");
  }

  function compareToReference(refAligned, seqAligned) {
    let matches = 0;
    let mismatches = 0;
    let insertions = 0;
    let deletions = 0;
    for (let i = 0; i < refAligned.length; i++) {
      const a = refAligned[i];
      const b = seqAligned[i];
      if (a === "-" && b === "-") continue;
      if (a === "-") insertions++;
      else if (b === "-") deletions++;
      else if (a === b) matches++;
      else mismatches++;
    }
    const columns = matches + mismatches + insertions + deletions;
    return {
      matches,
      mismatches,
      insertions,
      deletions,
      identity: columns ? (matches / columns) * 100 : 0
    };
  }

  function initSequenceAlignment() {
    let latest = "";
    setupCopy(() => latest);

    byId("clear-tool").addEventListener("click", () => {
      byId("alignment-input").value = "";
      hideResults();
      latest = "";
      clearMessage();
    });

    byId("run-tool").addEventListener("click", () => {
      clearMessage();
      try {
        const records = parseFastaRecords(valueOf("alignment-input"), "Sequence").map((record, index) => ({
          name: record.name || "Sequence " + (index + 1),
          sequence: cleanAlignmentSequence(record.rawSequence, record.name || "Sequence " + (index + 1), false)
        }));
        if (records.length < 2) throw new Error("Enter at least two FASTA sequences to align.");

        const matchScore = Number(valueOf("align-match"));
        const mismatchScore = Number(valueOf("align-mismatch"));
        const gapScore = Number(valueOf("align-gap"));
        const wrapWidth = Number(valueOf("align-wrap")) || 60;
        if (![matchScore, mismatchScore, gapScore, wrapWidth].every(Number.isFinite)) throw new Error("Alignment settings must be valid numbers.");

        const result = buildStarAlignment(records, matchScore, mismatchScore, gapScore);
        const display = formatAlignment(records, result.aligned, wrapWidth);
        const stats = records.map((record, index) => {
          if (index === 0) return [record.name, "100.00%"];
          const comparison = compareToReference(result.aligned[0], result.aligned[index]);
          return [record.name, comparison.identity.toFixed(2) + "%"];
        });

        renderSummary("alignment-summary", [
          { label: "Sequences", value: records.length },
          { label: "Reference", value: records[0].name },
          { label: "Aligned length", value: result.aligned[0].length },
          { label: "Alignment score", value: result.score }
        ]);
        byId("alignment-output").textContent = display;
        renderTable("alignment-table", ["Sequence", "% match vs reference"], stats);

        latest = [
          "Sequence Alignment results",
          "Sequences: " + records.length,
          "Reference: " + records[0].name,
          "Aligned length: " + result.aligned[0].length,
          "Alignment score: " + result.score,
          "",
          display,
          "",
          "Comparison to reference",
          "Sequence\t% match",
          ...stats.map((row) => row.join("\t"))
        ].join("\n");

        showResults();
        showMessage("Alignment completed.", "ok");
      } catch (err) {
        hideResults();
        latest = "";
        showMessage(err.message || String(err), "error");
      }
    });
  }

  function distanceBetween(seqA, seqB) {
    let differences = 0;
    let comparable = 0;
    for (let i = 0; i < seqA.length; i++) {
      const a = seqA[i];
      const b = seqB[i];
      if (a === "-" && b === "-") continue;
      comparable++;
      if (a !== b) differences++;
    }
    return comparable ? differences / comparable : 1;
  }

  function pairKey(a, b) {
    return a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id;
  }

  function buildUpgma(records) {
    let clusters = records.map((record, index) => ({
      id: "L" + index,
      label: record.name,
      size: 1,
      height: 0,
      children: []
    }));
    const distances = new Map();

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        distances.set(pairKey(clusters[i], clusters[j]), distanceBetween(records[i].sequence, records[j].sequence));
      }
    }

    let nextId = 1;
    while (clusters.length > 1) {
      let bestI = 0;
      let bestJ = 1;
      let bestDistance = distances.get(pairKey(clusters[0], clusters[1]));

      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const distance = distances.get(pairKey(clusters[i], clusters[j]));
          if (distance < bestDistance) {
            bestDistance = distance;
            bestI = i;
            bestJ = j;
          }
        }
      }

      const a = clusters[bestI];
      const b = clusters[bestJ];
      const merged = {
        id: "N" + nextId,
        label: "Cluster " + nextId,
        size: a.size + b.size,
        height: bestDistance / 2,
        children: [a, b]
      };
      nextId++;

      const remaining = clusters.filter((_, index) => index !== bestI && index !== bestJ);
      for (const other of remaining) {
        const distance = ((distances.get(pairKey(a, other)) * a.size) + (distances.get(pairKey(b, other)) * b.size)) / (a.size + b.size);
        distances.set(pairKey(merged, other), distance);
      }
      clusters = remaining.concat(merged);
    }

    return clusters[0];
  }

  function safeNewickLabel(label) {
    return String(label || "Sequence").trim().replace(/[^A-Za-z0-9_.-]+/g, "_") || "Sequence";
  }

  function newickSubtree(node) {
    if (!node.children.length) return safeNewickLabel(node.label);
    return "(" + node.children.map((child) => newickSubtree(child) + ":" + Math.max(node.height - child.height, 0).toFixed(4)).join(",") + ")";
  }

  function renderTreeNode(node, parentHeight) {
    const wrapper = document.createElement("div");
    const label = document.createElement("div");
    wrapper.className = "tree-node";
    label.className = "tree-label";
    label.appendChild(document.createTextNode(node.children.length ? node.label : node.label));
    if (parentHeight !== null) {
      const branch = document.createElement("span");
      branch.textContent = "branch " + Math.max(parentHeight - node.height, 0).toFixed(4);
      label.appendChild(branch);
    }
    wrapper.appendChild(label);

    if (node.children.length) {
      const children = document.createElement("div");
      children.className = "tree-children";
      for (const child of node.children) children.appendChild(renderTreeNode(child, node.height));
      wrapper.appendChild(children);
    }
    return wrapper;
  }

  function initTreeBuilder() {
    let latest = "";
    setupCopy(() => latest);

    byId("clear-tool").addEventListener("click", () => {
      byId("tree-input").value = "";
      hideResults();
      latest = "";
      clearMessage();
    });

    byId("run-tool").addEventListener("click", () => {
      clearMessage();
      try {
        const records = parseFastaRecords(valueOf("tree-input"), "Sequence").map((record, index) => ({
          name: record.name || "Sequence " + (index + 1),
          sequence: cleanAlignmentSequence(record.rawSequence, record.name || "Sequence " + (index + 1), true)
        }));
        if (records.length < 2) throw new Error("Enter at least two aligned FASTA sequences.");
        const length = records[0].sequence.length;
        if (records.some((record) => record.sequence.length !== length)) {
          throw new Error("Tree Builder expects an existing alignment: all sequences must have the same length.");
        }

        const tree = buildUpgma(records);
        const newick = newickSubtree(tree) + ";";
        renderSummary("tree-summary", [
          { label: "Sequences", value: records.length },
          { label: "Alignment length", value: length },
          { label: "Method", value: "UPGMA" }
        ]);
        byId("tree-newick").textContent = newick;
        const diagram = byId("tree-diagram");
        diagram.textContent = "";
        diagram.appendChild(renderTreeNode(tree, null));

        latest = [
          "Tree Builder results",
          "Sequences: " + records.length,
          "Alignment length: " + length,
          "Method: UPGMA",
          "Newick:",
          newick
        ].join("\n");

        showResults();
        showMessage("Tree built.", "ok");
      } catch (err) {
        hideResults();
        latest = "";
        showMessage(err.message || String(err), "error");
      }
    });
  }

  const tool = document.body ? document.body.dataset.tool : "";
  if (tool === "orf-finder") initOrfFinder();
  if (tool === "restriction-mapper") initRestrictionMapper();
  if (tool === "sequence-editor") initSequenceEditor();
  if (tool === "sequence-alignment") initSequenceAlignment();
  if (tool === "tree-builder") initTreeBuilder();
})();
