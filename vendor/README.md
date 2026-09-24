# vendor/

Third-party files PPP serves itself, byte for byte as published (docs/GOALS/G04 §8.5, A29).

`.gitattributes` here turns off line-ending conversion (`* -text`), so a Windows checkout keeps the exact bytes and
the hashes below hold on every machine. `tests/engrave/vendor.test.js` checks them.

## vexflow-4.2.3.js

| | |
| --- | --- |
| What | VexFlow 4.2.3, the CommonJS/UMD build (`build/cjs/vexflow.js`): notation glyphs and note formatting |
| From | `https://cdn.jsdelivr.net/npm/vexflow@4.2.3/build/cjs/vexflow.js` (npm `vexflow@4.2.3`), the same URL the legacy renderer loads at runtime (`VEXFLOW_URL`, App 9209) |
| Header | `VexFlow 4.2.3   2023-08-16T07:06:43.824Z   62087494cafd5bf226201aab96c90a747c05a52c` |
| Size | 992,166 bytes |
| sha256 | `86855aa3f6e2202738d90807a1aa78c039d4264789e016a851c120a1bb8bbb73` |
| SRI | `sha384-HcSKHU8C+2rx18IlCMSlVWuygC4W9XRY8ebpaoE3Tg1iJO0g64QCxO2vO5HXIokW` |
| Licence | MIT, `LICENSE-vexflow.txt` (the package's own `LICENSE`) |

The build carries the outlines of its music fonts as data. Its default stack is Bravura, Gonville, Custom:

| Font | Licence | Notice |
| --- | --- | --- |
| Bravura (Steinberg Media Technologies GmbH) | SIL Open Font License 1.1 | `LICENSE-bravura-OFL.txt` - the OFL asks that the notice and licence travel with the font data, so they are here |
| Gonville (Simon Tatham) | its font files are released without restriction (Gonville `LICENCE`: "Use of the output font files is UNRESTRICTED") | none needed |
| Custom (VexFlow's own glyphs) | MIT, as VexFlow | `LICENSE-vexflow.txt` |

Not an upgrade path to VexFlow 5 (G04 §7.3 B, R3): 4.2.3 is pinned. G4a only vendors and verifies the file; nothing loads
it yet. The legacy renderer keeps loading the same version from the CDN until the engraving renderer replaces it (G4b+).
