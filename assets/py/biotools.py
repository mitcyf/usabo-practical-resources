import io
import json
import re
import textwrap
from collections import OrderedDict

from Bio import AlignIO, Phylo, SeqIO
from Bio.Align import MultipleSeqAlignment
from Bio.Data import CodonTable
from Bio.Phylo.TreeConstruction import DistanceCalculator, DistanceTreeConstructor
from Bio.Restriction import AllEnzymes, RestrictionBatch
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord
from Bio.SeqUtils import MeltingTemp as mt

DNA_RE = re.compile(r"^[ACGTUNRYKMSWBDHV.\-]+$", re.I)


def wrap_text(text, line_length=70):
    return "\n".join(textwrap.wrap(str(text), line_length))


def payload_dict(payload_json):
    if not payload_json:
        return {}
    return json.loads(payload_json)


def clean_sequence_text(text, allow_gaps=False):
    sequence = re.sub(r"\s+", "", str(text or ""))
    sequence = re.sub(r"[0-9]", "", sequence).upper().replace("U", "T")
    if not sequence:
        raise ValueError("Sequence is empty.")
    if not DNA_RE.match(sequence):
        invalid = sorted(set(re.sub(r"[ACGTNRYKMSWBDHV.\-]", "", sequence)))
        raise ValueError("Sequence contains invalid nucleotide characters" + (": " + " ".join(invalid) if invalid else "."))
    if allow_gaps:
        return sequence.replace(".", "-")
    return sequence.replace(".", "").replace("-", "")


def parse_fasta_records(input_text, fallback_name="Sequence"):
    raw = str(input_text or "").strip()
    if not raw:
        raise ValueError("Input is empty.")
    records = list(SeqIO.parse(io.StringIO(raw), "fasta"))
    if records:
        return records
    seq = clean_sequence_text(raw, allow_gaps=True)
    return [SeqRecord(Seq(seq), id=fallback_name, name=fallback_name, description="")]


def first_sequence(input_text, fallback_name="Sequence", allow_gaps=False):
    records = parse_fasta_records(input_text, fallback_name)
    if len(records) != 1:
        raise ValueError("Paste exactly one sequence.")
    return records[0].id, clean_sequence_text(str(records[0].seq), allow_gaps=allow_gaps)


def translate_dna_to_protein(dna_sequence, genetic_code=1):
    name, dna = first_sequence(dna_sequence, "Input sequence")
    start_codon_index = dna.find("ATG")
    translated_from = 1
    if start_codon_index != -1:
        dna = dna[start_codon_index:]
        translated_from = start_codon_index + 1
    protein = str(Seq(dna).translate(table=int(genetic_code), to_stop=True))
    return {
        "name": name,
        "translated_from": translated_from,
        "coding_length": len(dna),
        "protein_length": len(protein),
        "protein": protein,
    }


def remove_contained_orfs(orfs):
    filtered = []
    for index, orf in enumerate(orfs):
        contained = False
        for other_index, other in enumerate(orfs):
            if index == other_index:
                continue
            if other["strand"] == orf["strand"] and other["frame"] == orf["frame"] and other["start"] <= orf["start"] and other["end"] >= orf["end"] and other["nt_length"] > orf["nt_length"]:
                contained = True
                break
        if not contained:
            filtered.append(orf)
    return filtered


def find_orfs(min_orf_length, genetic_code_type, fasta_sequence, strand_mode="forward", hide_contained=True):
    name, dna = first_sequence(fasta_sequence, "Input sequence")
    min_aa = int(min_orf_length)
    genetic_code_type = int(genetic_code_type)
    if min_aa < 1:
        raise ValueError("Minimum ORF length must be at least 1 amino acid.")
    CodonTable.unambiguous_dna_by_id[genetic_code_type]

    scans = [("+", dna)]
    if strand_mode == "both":
        scans.append(("-", str(Seq(dna).reverse_complement())))

    orfs = []
    for strand, scan_seq in scans:
        for frame in range(3):
            protein_sequence = Seq(scan_seq[frame:]).translate(table=genetic_code_type)
            orf_length = 0
            orf_start = 0
            in_orf = False
            for i, aa in enumerate(protein_sequence):
                if aa == "*" and in_orf:
                    if orf_length >= min_aa:
                        local_start = frame + orf_start * 3
                        local_end = frame + (i * 3 + 3)
                        if strand == "+":
                            start = local_start + 1
                            end = local_end
                        else:
                            start = len(dna) - local_end + 1
                            end = len(dna) - local_start
                        cds = str(scan_seq[local_start:local_end])
                        protein = str(protein_sequence[orf_start:i])
                        orfs.append({
                            "strand": strand,
                            "frame": frame + 1,
                            "start": start,
                            "end": end,
                            "size": orf_length,
                            "nt_length": len(cds),
                            "dna": cds,
                            "protein": protein,
                        })
                    in_orf = False
                    orf_length = 0
                elif aa == "M" and not in_orf:
                    in_orf = True
                    orf_start = i
                    orf_length = 1
                elif in_orf:
                    orf_length += 1

    if hide_contained:
        orfs = remove_contained_orfs(orfs)
    orfs.sort(key=lambda item: (-item["nt_length"], item["start"], item["strand"], item["frame"]))
    return {
        "name": name,
        "sequence_length": len(dna),
        "genetic_code": genetic_code_type,
        "minimum_aa_length": min_aa,
        "strand_mode": strand_mode,
        "hide_contained": bool(hide_contained),
        "orfs": orfs,
    }


def find_restriction_sites(dna_sequence, include_zero=False):
    name, dna = first_sequence(dna_sequence, "Input sequence")
    seq = Seq(dna)
    batch = RestrictionBatch(AllEnzymes)
    analysis = batch.search(seq)
    rows = []
    for enzyme, sites in analysis.items():
        count = len(sites)
        if count == 0 and not include_zero:
            continue
        try:
            recognition = enzyme.elucidate()
        except Exception:
            recognition = str(getattr(enzyme, "site", ""))
        rows.append({
            "enzyme": str(enzyme),
            "site": str(getattr(enzyme, "site", "")),
            "recognition": recognition,
            "count": count,
            "positions": list(sites),
        })
    rows.sort(key=lambda item: (-item["count"], item["enzyme"]))
    return {
        "name": name,
        "sequence_length": len(dna),
        "enzymes_checked": len(AllEnzymes),
        "enzymes_cutting": sum(1 for row in rows if row["count"] > 0),
        "total_sites": sum(row["count"] for row in rows),
        "sites": rows,
    }


def reverse_complement_tool(nucleotide_sequence):
    name, dna = first_sequence(nucleotide_sequence, "Input sequence", allow_gaps=False)
    rc = str(Seq(dna).reverse_complement())
    return {
        "name": name,
        "length": len(dna),
        "reverse_complement": rc,
    }


def calculate_tm(nucleotide_sequence):
    name, dna = first_sequence(nucleotide_sequence, "Input sequence", allow_gaps=False)
    tm_value = float(mt.Tm_NN(Seq(dna)))
    return {
        "name": name,
        "length": len(dna),
        "tm_celsius": tm_value,
    }


def align_codons(protein_alignment, nucleotide_sequences):
    protein_align = AlignIO.read(io.StringIO(str(protein_alignment or "")), "clustal")
    nucleotide_seqs = OrderedDict((record.id, str(record.seq)) for record in SeqIO.parse(io.StringIO(str(nucleotide_sequences or "")), "fasta"))
    if not nucleotide_seqs:
        raise ValueError("Enter nucleotide coding sequences in FASTA format.")

    aligned = []
    for protein_record in protein_align:
        record_id = protein_record.id
        if record_id not in nucleotide_seqs:
            raise ValueError(f"No nucleotide sequence was provided for {record_id}.")
        nucleotide_seq = nucleotide_seqs[record_id]
        codon_alignment = []
        codon_idx = 0
        for aa in protein_record.seq:
            if aa == "-":
                codon_alignment.append("---")
            else:
                codon = str(nucleotide_seq[codon_idx * 3:(codon_idx * 3) + 3])
                if len(codon) < 3:
                    codon = codon.ljust(3, "-")
                codon_alignment.append(codon)
                codon_idx += 1
        aligned.append({
            "id": record_id,
            "sequence": "".join(codon_alignment),
        })

    result = ""
    for row in aligned:
        result += f">{row['id']}\n{wrap_text(row['sequence'], 70)}\n\n"
    return {
        "records": aligned,
        "record_count": len(aligned),
        "alignment": result.strip(),
    }


def parse_rendered_alignment(alignment_text):
    records = []
    by_name = OrderedDict()
    for line in str(alignment_text or "").splitlines():
        if not line.strip():
            continue
        if re.match(r"^[\s|*.:]+$", line):
            continue
        match = re.match(r"^(.+?)(?:\t+|\s{2,})([A-Za-z*.\-]+)\s*$", line)
        if not match:
            continue
        label = match.group(1).strip()
        sequence = match.group(2).strip().replace("U", "T")
        if label not in by_name:
            by_name[label] = ""
        by_name[label] += sequence
    for index, (label, sequence) in enumerate(by_name.items(), start=1):
        safe_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", label).strip("_") or f"Sequence_{index}"
        records.append(SeqRecord(Seq(sequence), id=safe_id, name=safe_id, description=""))
    if len(records) < 2:
        raise ValueError("Enter a CLUSTAL alignment or rendered alignment block with at least two sequences.")
    lengths = {len(record.seq) for record in records}
    if len(lengths) != 1:
        raise ValueError("All aligned sequences must have the same length.")
    return MultipleSeqAlignment(records)


def parse_alignment(alignment_text):
    text = str(alignment_text or "").strip()
    if not text:
        raise ValueError("Alignment is empty.")
    if text.upper().startswith("CLUSTAL"):
        return AlignIO.read(io.StringIO(text), "clustal")
    return parse_rendered_alignment(text)


def clade_to_dict(clade):
    return {
        "name": clade.name or "",
        "branch_length": float(clade.branch_length or 0),
        "children": [clade_to_dict(child) for child in clade.clades],
    }


def build_phylogenetic_tree(alignment_string):
    alignment = parse_alignment(alignment_string)
    calculator = DistanceCalculator("identity")
    distance_matrix = calculator.get_distance(alignment)
    constructor = DistanceTreeConstructor()
    tree = constructor.nj(distance_matrix)
    newick_handle = io.StringIO()
    Phylo.write(tree, newick_handle, "newick")
    matrix = []
    for i, name in enumerate(distance_matrix.names):
        matrix.append({
            "name": name,
            "distances": [float(distance_matrix[i, j]) for j in range(len(distance_matrix.names))],
        })
    return {
        "sequence_count": len(alignment),
        "alignment_length": alignment.get_alignment_length(),
        "newick": newick_handle.getvalue().strip(),
        "tree": clade_to_dict(tree.root),
        "distance_names": list(distance_matrix.names),
        "distance_matrix": matrix,
    }


def run_tool(tool_name, payload_json):
    payload = payload_dict(payload_json)
    try:
        if tool_name == "dna-to-protein":
            result = translate_dna_to_protein(payload.get("sequence", ""), payload.get("genetic_code", 1))
        elif tool_name == "orf-finder":
            result = find_orfs(
                payload.get("min_orf_length", 1),
                payload.get("genetic_code", 1),
                payload.get("sequence", ""),
                payload.get("strand_mode", "forward"),
                payload.get("hide_contained", True),
            )
        elif tool_name == "restriction-mapper":
            result = find_restriction_sites(payload.get("sequence", ""), payload.get("include_zero", False))
        elif tool_name == "reverse-complement":
            result = reverse_complement_tool(payload.get("sequence", ""))
        elif tool_name == "tm-calculator":
            result = calculate_tm(payload.get("sequence", ""))
        elif tool_name == "codon-alignment":
            result = align_codons(payload.get("protein_alignment", ""), payload.get("nucleotide_sequences", ""))
        elif tool_name == "tree-builder":
            result = build_phylogenetic_tree(payload.get("alignment", ""))
        else:
            raise ValueError(f"Unknown tool: {tool_name}")
        return json.dumps({"ok": True, "result": result})
    except Exception as exc:
        return json.dumps({"ok": False, "error": str(exc)})
