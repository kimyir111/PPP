"""Human-reviewed expectations applied when ``lint-corpus --init`` builds references.json.

Only facts a person checked belong here; everything else comes from the file.
"""

MANUAL_EXPECT = {
    # The file has fifths 0 and no <mode>, so a reader takes it as C major.
    # Für Elise is in A minor.
    "catalog/fur-elise": {"key": {"fifths": 0, "mode": "minor"}},
}

NOTES = {
    "catalog/fur-elise": "No <mode> in the file (reads as major); the piece is in A minor.",
    "micro/M21-five-four": "5/4 is not a metre toMusicXml can write today; kept to track it (§6.4).",
    "micro/M22-tempo-change": "120 qpm, then 80 from bar 5; expect.tempo_qpm is the opening tempo.",
}
