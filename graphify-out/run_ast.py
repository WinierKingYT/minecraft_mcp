import json
from pathlib import Path

ROOT = Path(r"C:\Users\faruk\Desktop\minecraftmcp")


def main() -> None:
    from graphify.extract import collect_files, extract

    detect = json.loads(Path("graphify-out/.graphify_detect.json").read_text(encoding="utf-8"))

    code_files = []
    for f in detect.get("files", {}).get("code", []):
        p = Path(f)
        code_files.extend(collect_files(p) if p.is_dir() else [p])

    if code_files:
        result = extract(code_files, cache_root=ROOT)
        Path("graphify-out/.graphify_ast.json").write_text(
            json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print("AST: {} nodes, {} edges".format(len(result["nodes"]), len(result["edges"])))
    else:
        Path("graphify-out/.graphify_ast.json").write_text(
            json.dumps({"nodes": [], "edges": [], "input_tokens": 0, "output_tokens": 0}),
            encoding="utf-8",
        )
        print("No code files")

    # Kod-only yol: semantik dosya boş yazılır ki Part C birleştirmesi girdisini bulsun.
    sem = Path("graphify-out/.graphify_semantic.json")
    if not sem.exists():
        sem.write_text(
            json.dumps(
                {"nodes": [], "edges": [], "hyperedges": [], "input_tokens": 0, "output_tokens": 0}
            ),
            encoding="utf-8",
        )
        print("semantic: bos (kod-only)")


# Windows'ta multiprocessing alt surecleri ana modulu yeniden import eder;
# bu koruma olmadan sonsuz spawn dongusune girer.
if __name__ == "__main__":
    main()
