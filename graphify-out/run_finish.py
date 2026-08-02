import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = r"C:\Users\faruk\Desktop\minecraftmcp"


def main() -> None:
    from graphify.detect import save_manifest
    from graphify.cli import _stamped_manifest_files

    detect = json.loads(Path("graphify-out/.graphify_detect.json").read_text(encoding="utf-8"))
    extract = json.loads(Path("graphify-out/.graphify_extract.json").read_text(encoding="utf-8"))

    corpus = detect.get("all_files") or detect["files"]
    # Yalnizca cikti ureten dosyalar damgalanir. Dokumanlar bu kosuda semantik
    # cikarima girmedi; damgalanmamalari gerekiyor ki sonraki --update onlari
    # yeniden kuyruga alsin.
    manifest_files = _stamped_manifest_files(corpus, extract, Path(ROOT))

    sem_types = ("document", "paper", "image")
    dispatched = {f for t, fl in detect["files"].items() if t in sem_types for f in fl}
    stamped = {f for fl in manifest_files.values() for f in fl}
    cleared = dispatched - stamped

    scan = {f for fl in corpus.values() for f in fl}
    save_manifest(manifest_files, root=ROOT, scan_corpus=scan, clear_semantic=cleared or None)

    input_tok = extract.get("input_tokens", 0)
    output_tok = extract.get("output_tokens", 0)

    cost_path = Path("graphify-out/cost.json")
    cost = json.loads(cost_path.read_text(encoding="utf-8")) if cost_path.exists() else {
        "runs": [], "total_input_tokens": 0, "total_output_tokens": 0
    }
    cost["runs"].append({
        "date": datetime.now(timezone.utc).isoformat(),
        "input_tokens": input_tok,
        "output_tokens": output_tok,
        "files": detect.get("total_files", 0),
    })
    cost["total_input_tokens"] += input_tok
    cost["total_output_tokens"] += output_tok
    cost_path.write_text(json.dumps(cost, indent=2, ensure_ascii=False), encoding="utf-8")

    print("Bu kosu: {:,} input / {:,} output token".format(input_tok, output_tok))
    print("Semantik cikarim bekleyen dosya: {}".format(len(cleared)))


if __name__ == "__main__":
    main()
