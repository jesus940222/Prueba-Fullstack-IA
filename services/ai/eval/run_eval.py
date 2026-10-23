"""Evaluación versionada. Sin AI_EVAL_REAL no llama al proveedor y no inventa latencia ni coste."""

import json
import os
from pathlib import Path


def main() -> None:
    dataset = json.loads(Path(__file__).with_name("dataset-v1.json").read_text(encoding="utf-8"))
    real = os.environ.get("AI_EVAL_REAL", "").lower() == "true" and bool(os.environ.get("OPENAI_API_KEY", "").strip())
    report = {
        "dataset": dataset["version"],
        "promptVersion": dataset["promptVersion"],
        "mode": "provider" if real else "not_run",
        "cases": len(dataset["cases"]),
        "latencyP50Ms": None,
        "latencyP95Ms": None,
        "meanCostUsd": None,
        "totalCostUsd": None,
        "note": "La evaluación real no se ejecutó. Las pruebas automáticas usan un proveedor controlado y no son estas cifras.",
    }
    if real:
        report["note"] = "La evaluación real quedó pendiente de un ejecutor con el proveedor. Este script no inventa sus cifras."
        report["mode"] = "pending_provider_run"
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
