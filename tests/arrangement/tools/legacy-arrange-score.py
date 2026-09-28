"""G08 comparative evaluation harness (docs/GOALS/G08_ARRANGEMENT_REALIZATION.md section 6a):
read-only invocation of `arrange_score.py`'s own Arranger over a real corpus wire-score, exactly
the same technique tests/playability/tools/arrange-score-baseline.py already uses for the G5a
baseline (fixture(), not a real corpus piece) - this script does the same thing for a REAL piece
passed in on stdin, so the G8a harness can sample more than one fixture per engine (the design
doc's own section 4 correction).

Reads one JSON object from stdin: {"score": {...wire score...}, "level": "...", "style": "..."}.
Prints one JSON object to stdout: {"notes": [...]} (arrange_score.py's own Arranger.arrange()
result, unmodified) or {"error": "..."} on failure. Never imports or mutates anything outside
`arrange_score.py`'s own public Arranger class.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))

from arrange_score import Arranger  # noqa: E402


def main():
    req = json.load(sys.stdin)
    try:
        result = Arranger({"score": req["score"], "arrangement": {"level": req["level"], "style": req["style"]}}).arrange()
        json.dump({"notes": result["notes"]}, sys.stdout)
    except Exception as exc:  # noqa: BLE001 - a harness never lets a legacy engine's own failure crash the comparison
        json.dump({"error": str(exc)}, sys.stdout)


if __name__ == "__main__":
    main()
