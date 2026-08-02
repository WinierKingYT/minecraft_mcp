import json
from pathlib import Path

ROOT = r"C:\Users\faruk\Desktop\minecraftmcp"
DIRECTED = False


def main() -> None:
    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all
    from graphify.analyze import god_nodes, surprising_connections, suggest_questions
    from graphify.report import generate
    from graphify.export import to_json
    from graphify.diagnostics import diagnose_extraction, format_diagnostic_report

    ast = json.loads(Path("graphify-out/.graphify_ast.json").read_text(encoding="utf-8"))
    sem = json.loads(Path("graphify-out/.graphify_semantic.json").read_text(encoding="utf-8"))

    seen = {n["id"] for n in ast["nodes"]}
    merged_nodes = list(ast["nodes"])
    for n in sem["nodes"]:
        if n["id"] not in seen:
            merged_nodes.append(n)
            seen.add(n["id"])

    extraction = {
        "nodes": merged_nodes,
        "edges": ast["edges"] + sem["edges"],
        "hyperedges": sem.get("hyperedges", []),
        "input_tokens": sem.get("input_tokens", 0),
        "output_tokens": sem.get("output_tokens", 0),
    }
    Path("graphify-out/.graphify_extract.json").write_text(
        json.dumps(extraction, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("Merged: {} nodes, {} edges".format(len(merged_nodes), len(extraction["edges"])))

    detection = json.loads(Path("graphify-out/.graphify_detect.json").read_text(encoding="utf-8"))

    G = build_from_json(extraction, root=ROOT, directed=DIRECTED)
    if G.number_of_nodes() == 0:
        print("ERROR: Graph is empty - extraction produced no nodes.")
        raise SystemExit(1)

    communities = cluster(G)
    cohesion = score_all(G, communities)
    tokens = {"input": extraction["input_tokens"], "output": extraction["output_tokens"]}
    gods = god_nodes(G)
    surprises = surprising_connections(G, communities)
    labels = {cid: "Community " + str(cid) for cid in communities}
    questions = suggest_questions(G, communities, labels)

    wrote = to_json(G, communities, "graphify-out/graph.json")
    if not wrote:
        print("ERROR: refused to shrink graphify-out/graph.json (#479).")
        raise SystemExit(1)

    report = generate(
        G, communities, cohesion, labels, gods, surprises, detection, tokens, ROOT,
        suggested_questions=questions,
    )
    Path("graphify-out/GRAPH_REPORT.md").write_text(report, encoding="utf-8")

    analysis = {
        "communities": {str(k): v for k, v in communities.items()},
        "cohesion": {str(k): v for k, v in cohesion.items()},
        "gods": gods,
        "surprises": surprises,
        "questions": questions,
    }
    Path("graphify-out/.graphify_analysis.json").write_text(
        json.dumps(analysis, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(
        "Graph: {} nodes, {} edges, {} communities".format(
            G.number_of_nodes(), G.number_of_edges(), len(communities)
        )
    )

    # Step 4.5 - saglik kontrolu (read-only)
    summary = diagnose_extraction(extraction, directed=DIRECTED, root=ROOT)
    print(format_diagnostic_report(summary))
    flags = []
    for key, label in (
        ("dangling_endpoint_edges", "dangling-endpoint edges"),
        ("missing_endpoint_edges", "missing-endpoint edges"),
        ("self_loop_edges", "self-loop edges"),
        ("directed_same_endpoint_collapsed_edges", "collapsed (directed) edges"),
        ("undirected_same_endpoint_collapsed_edges", "collapsed (undirected) edges"),
    ):
        if summary.get(key, 0):
            flags.append("{} {}".format(summary[key], label))
    if flags:
        print("GRAPH HEALTH WARNING: " + "; ".join(flags))
    else:
        print("Graph health: OK (no dangling/missing/collapsed edges).")


if __name__ == "__main__":
    main()
