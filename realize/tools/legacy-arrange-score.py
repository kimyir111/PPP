"""G08 (G8a) comparative harness - legacy engine 1/3: arrange_score.py, run over REAL corpus
files (not just its own single test fixture - docs/GOALS/G08 §4's correction: the G5a
baseline covered one fixture only). Read-only: this script only imports and calls
`Arranger`, never edits arrange_score.py (docs/GOALS/G08 §5).

Reads one JSON object from stdin: {"jobs": [{"id", "score", "style", "level"}, ...]} - each
`score` already in arrange_score.py's own wire-score shape (measures/notes/tempo/sections),
built by realize/tools/harness.js from a real ScoreGraph via the SAME scoregraph/legacy-score.js
`toScore()` tests/playability/arranger-baseline.test.js already uses for this engine's
legacy-baseline comparisons.

Writes one JSON object to stdout: {"results": [{"id", "notes", "tempo", "error"?}, ...]}.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from arrange_score import Arranger  # noqa: E402


def main():
    payload = json.load(sys.stdin)
    out = []
    for job in payload.get("jobs", []):
        try:
            result = Arranger({"score": job["score"], "arrangement": {"level": job["level"], "style": job.get("style", "balanced")}}).arrange()
            out.append({"id": job["id"], "notes": result["notes"], "tempo": job["score"].get("tempo", 80)})
        except Exception as e:  # noqa: BLE001 - a legacy-engine crash is itself a real, reportable finding
            out.append({"id": job["id"], "error": str(e)})
    json.dump({"results": out}, sys.stdout)


if __name__ == "__main__":
    main()
