import json
from collections import Counter
from pathlib import Path


def main() -> None:
    analysis = json.loads(Path("graphify-out/.graphify_analysis.json").read_text(encoding="utf-8"))
    graph = json.loads(Path("graphify-out/graph.json").read_text(encoding="utf-8"))

    label_by_id = {n["id"]: n.get("label", n["id"]) for n in graph["nodes"]}
    communities = {int(k): v for k, v in analysis["communities"].items()}

    sizes = sorted(((cid, len(members)) for cid, members in communities.items()), key=lambda x: -x[1])
    print("toplam topluluk:", len(communities))
    print("boyut dagilimi:", Counter(n for _, n in sizes).most_common(8))
    print()

    for cid, size in sizes[:24]:
        members = communities[cid]
        names = [label_by_id.get(m, m) for m in members[:9]]
        print("C{:<4} n={:<4} {}".format(cid, size, ", ".join(names)))


if __name__ == "__main__":
    main()
