import json
import re
from collections import Counter
from pathlib import Path

ROOT = r"C:\Users\faruk\Desktop\minecraftmcp"
DIRECTED = False

# Elle adlandirilan buyuk topluluklar.
MANUAL = {
    0: "Error Catalog Codes",
    1: "Bridge Boot Identity",
    2: "Bridge Auth and Endpoints",
    3: "Gradle Supply-Chain Validation",
    4: "Bridge Request Schema",
    5: "Compatibility Profile and Smoke",
    6: "JSON Schema Primitives",
    7: "Capability Risk Enums",
    8: "Bridge Response Schema",
    9: "Bridge HTTP Client",
    10: "Schema Field Descriptors",
    11: "Root Package Manifest",
    12: "Bridge Endpoint Tests",
    13: "Tool Error Schema",
    14: "Evidence Model",
    15: "Config Numeric Bounds",
    16: "IPC Contract Types",
    17: "TypeScript Build Config",
    18: "MCP Server Package",
    19: "Run Supervisor Package",
    20: "Build Plan and Modes",
    21: "Logging and Supervisor Client",
    22: "Scenario DSL Schema",
    23: "Supervisor Endpoint and Startup",
}


def derive_label(members, node_by_id):
    """Kucuk topluluklar icin baskin kaynak dosyadan ad turetir."""
    stems = Counter()
    for node_id in members:
        node = node_by_id.get(node_id)
        if not node:
            continue
        src = node.get("source_file") or ""
        stem = Path(src).stem if src else ""
        if stem:
            stems[stem] += 1
    if not stems:
        return None
    stem = stems.most_common(1)[0][0]
    words = re.split(r"[-_.]", stem)
    return " ".join(w.capitalize() for w in words if w)[:40]


def main() -> None:
    from graphify.build import build_from_json
    from graphify.analyze import suggest_questions
    from graphify.report import generate

    extraction = json.loads(Path("graphify-out/.graphify_extract.json").read_text(encoding="utf-8"))
    detection = json.loads(Path("graphify-out/.graphify_detect.json").read_text(encoding="utf-8"))
    analysis = json.loads(Path("graphify-out/.graphify_analysis.json").read_text(encoding="utf-8"))
    graph = json.loads(Path("graphify-out/graph.json").read_text(encoding="utf-8"))

    node_by_id = {n["id"]: n for n in graph["nodes"]}

    G = build_from_json(extraction, root=ROOT, directed=DIRECTED)
    communities = {int(k): v for k, v in analysis["communities"].items()}
    cohesion = {int(k): v for k, v in analysis["cohesion"].items()}
    tokens = {"input": extraction.get("input_tokens", 0), "output": extraction.get("output_tokens", 0)}

    labels = {}
    for cid, members in communities.items():
        if cid in MANUAL:
            labels[cid] = MANUAL[cid]
        else:
            labels[cid] = derive_label(members, node_by_id) or ("Community " + str(cid))

    questions = suggest_questions(G, communities, labels)

    report = generate(
        G, communities, cohesion, labels, analysis["gods"], analysis["surprises"],
        detection, tokens, ROOT, suggested_questions=questions,
    )
    Path("graphify-out/GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    Path("graphify-out/.graphify_labels.json").write_text(
        json.dumps({str(k): v for k, v in labels.items()}, ensure_ascii=False), encoding="utf-8"
    )
    print("Report updated with {} community labels ({} manual, {} derived)".format(
        len(labels), len(MANUAL), len(labels) - len(MANUAL)
    ))


if __name__ == "__main__":
    main()
