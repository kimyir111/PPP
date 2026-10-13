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

The build carries the glyph outlines of five music fonts as data (each a `fontFamily:"…"` table in the file). Its
default stack is Bravura, Gonville, Custom; Petaluma and Leland are loaded into it too (`F.load("Petaluma", …)`,
`F.load("Leland", …)`), so their data travels with it whether or not PPP selects them:

| Font (data in the build) | Licence | Notice |
| --- | --- | --- |
| Bravura (Steinberg Media Technologies GmbH), `generatedOn` 2022-12-18 | SIL Open Font License 1.1 | `LICENSE-bravura-OFL.txt` - the OFL asks that the notice and licence travel with the font data, so they are here |
| Petaluma (Steinberg Media Technologies GmbH), `generatedOn` 2022-12-18 | SIL Open Font License 1.1 | `LICENSE-petaluma-OFL.txt`, the font's own `redist/OFL.txt` (github.com/steinbergmedia/petaluma), byte for byte |
| Leland (MuseScore BVBA), `generatedOn` 2022-12-19 | SIL Open Font License 1.1 | `LICENSE-leland-OFL.txt`, the font's own `LICENSE.txt` (github.com/MuseScoreFonts/Leland), byte for byte; its copyright line is the current file's year |
| Gonville (Simon Tatham), as `GonvilleSmufl` | its font files are released without restriction (Gonville `LICENCE`: "Use of the output font files is UNRESTRICTED") | none needed |
| Custom (VexFlow's own glyphs) | MIT, as VexFlow | `LICENSE-vexflow.txt` |

It also carries three text-font tables used to measure words (`Arial`, `serif`, `PetalumaScript`): advance widths and
bounding boxes only, no outlines (checked: no outline field in any of their glyph entries). No text is drawn from them.
PetalumaScript is part of the Petaluma family and is covered by the Petaluma notice above.

The notices were fetched from the fonts' own repositories on 2026-09-25 (fixer, G04 §32.12);
`tests/engrave/vendor.test.js` checks that every outline font in the build has its row here.

`engrave/outlines.js` (G4c) carries the Bravura outlines of the glyphs the engraving layout uses (66), taken unchanged
from this build by `tests/engrave/tools/make-outlines.js` (`--check` in CI) so the SVG backend draws without loading
VexFlow; the Bravura notice above (`LICENSE-bravura-OFL.txt`) covers them, and the file's header says so.

Not an upgrade path to VexFlow 5 (G04 §7.3 B, R3): 4.2.3 is pinned. G4a only vendors and verifies the file; nothing loads
it yet. The legacy renderer keeps loading the same version from the CDN until the engraving renderer replaces it (G4b+).

## react-18.3.1/

React and ReactDOM 18.3.1, the UMD production builds, served by PPP so that the page does not stop when unpkg.com is unreachable
(docs/GOALS/G13_PRODUCTIZATION.md G13-D2, G13-1). The page loads them with two plain `<script>` tags before `support.js`, as
`./vendor/react-18.3.1/<file>?h=<12 hex of the sha256>` (server.js answers a matching `?h=` `immutable`, gzip); `support.js`
(generated, not edited) then finds React and does not fetch it. They are the files `support.js` pins and checks (`REACT_URL` /
`REACT_SRI`, `REACT_DOM_URL` / `REACT_DOM_SRI`), so the proof of identity is that pin: `tests/engrave/vendor-react.test.js`
checks the sha384 of each file against the constants in `support.js`, so a pin and a file cannot drift apart.

| File | From | Size | sha256 | SRI (sha384) |
| --- | --- | --- | --- | --- |
| `react-18.3.1/react.production.min.js` | `https://unpkg.com/react@18.3.1/umd/react.production.min.js` (npm `react@18.3.1`) | 10,751 bytes | `d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd` | `sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z` |
| `react-18.3.1/react-dom.production.min.js` | `https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js` (npm `react-dom@18.3.1`) | 131,835 bytes | `35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d` | `sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1` |

Licence: MIT (Copyright (c) Facebook, Inc. and its affiliates), `react-18.3.1/LICENSE-react.txt` and
`react-18.3.1/LICENSE-react-dom.txt`, each the package's own `LICENSE` byte for byte (unpkg.com/react@18.3.1/LICENSE and
unpkg.com/react-dom@18.3.1/LICENSE; the two files happen to be identical). Neither package has a NOTICE file.

**The way back (`PPP.cdn`, G13-D3).** `?cdn=1` in the address (this visit), or `localStorage['ppp.cdn'] = '1'` (this device; `PPP.cdn = 1`
in the console writes it), makes the page drop the vendored React and load the pinned unpkg copies, exactly as before G13-1. `?cdn=0`
is "vendored" for one visit even when a `1` is stored. Any other value is no choice, and no choice is the default: vendored. This
switch is removed one release after G13-1 has been live (G13-D3). A page whose vendored files fail to load has no React either, and
`support.js` then loads the unpkg ones on its own.

To change the version: move the pins in `support.js` first (it is generated), then replace the folder, the two `?h=` values in the app
head and this table; the test says which of them is out of step.

## fonts/

The Latin fonts of the page, and the music font, served by PPP itself so that no text waits for another site and the page has them offline
(docs/GOALS/G13_PRODUCTIZATION.md G13-4b). Each file is the woff2 that Google Fonts serves for the family (fonts.googleapis.com/css2, fetched with a
Chrome 153 user agent on 2026-10-08), **byte for byte** (no subsetting or other change is made here: the SIL Open Font License allows redistribution,
and a modified font may not keep a Reserved Font Name). The page declares them in a `<style>` in its head with the same weights, styles and
`unicode-range`s as Google's own stylesheet (`font-display: swap`), so a file is fetched only when a character of its range is on the page.
Only the `latin` and `latin-ext` pieces (and `music`) are here: Figtree and Instrument Serif have no others on Google Fonts; JetBrains Mono also has
cyrillic, cyrillic-ext, greek and vietnamese, which are not kept (the mono face only draws bar numbers, hint letters and times: those characters fall
back to the system monospace). **Korean, Japanese and Chinese text is not here**: Noto Sans KR / JP / SC stay on Google Fonts, asked for after the page
has loaded (U7 in the G13 doc is undecided).

| File | Family, style, subset | Google Fonts URL | Size | sha256 |
| --- | --- | --- | --- | --- |
| `fonts/figtree-v9-latin.woff2` | Figtree 400-700 (one variable file, declared once per weight 400/500/600/700), latin | `https://fonts.gstatic.com/s/figtree/v9/_Xms-HUzqDCFdgfMm4S9DQ.woff2` | 20,156 bytes | `4ba7d3d096695818fe0686be4f1e82c6b05134e18a22260336130335027462dd` |
| `fonts/figtree-v9-latin-ext.woff2` | Figtree, latin-ext | `https://fonts.gstatic.com/s/figtree/v9/_Xms-HUzqDCFdgfMm4q9DbZs.woff2` | 10,280 bytes | `bf7828e2c258cffcfa50a048ee388a36b95bc16b452e8d36fa797635dbe15965` |
| `fonts/instrument-serif-v5-latin.woff2` | Instrument Serif 400 normal, latin | `https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-6zUTjg.woff2` | 21,032 bytes | `5eb09b5ac0e28b67c2f041c8ba6d244604ca0c0980d65912ab2d47fed84ddc31` |
| `fonts/instrument-serif-v5-latin-ext.woff2` | Instrument Serif 400 normal, latin-ext | `https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-6zsTjmbI.woff2` | 11,604 bytes | `290e6267dd833bf5f899eba4c29ad0a9b09dbe53f6075b18af38057159e1ff20` |
| `fonts/instrument-serif-v5-italic-latin.woff2` | Instrument Serif 400 italic, latin | `https://fonts.gstatic.com/s/instrumentserif/v5/jizHRFtNs2ka5fXjeivQ4LroWlx-6zAjjH7M.woff2` | 22,128 bytes | `5a51946dfffa82972bc98745359c46761515641fda557c25116459a9f83da4a7` |
| `fonts/instrument-serif-v5-italic-latin-ext.woff2` | Instrument Serif 400 italic, latin-ext | `https://fonts.gstatic.com/s/instrumentserif/v5/jizHRFtNs2ka5fXjeivQ4LroWlx-6zAjgn7MsNo.woff2` | 12,384 bytes | `d0014821252a8a770bf7551641572f239a8ede83d75652d84fef0c3627751baf` |
| `fonts/jetbrains-mono-v24-latin.woff2` | JetBrains Mono 400-500 (variable, declared for 400 and 500), latin | `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2` | 31,432 bytes | `83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be` |
| `fonts/jetbrains-mono-v24-latin-ext.woff2` | JetBrains Mono, latin-ext | `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx7cwhsk.woff2` | 11,624 bytes | `db5ff4db83e580426280e9337a58dc57d3a83784a1b03ad80914651594441d52` |
| `fonts/noto-music-v21-music.woff2` | Noto Music 400, music (U+25CC, U+2669-266F, U+1D000-1D0F5, U+1D100-1D245: the clefs and accidentals the lessons and the Home card draw) | `https://fonts.gstatic.com/s/notomusic/v21/pe0rMIiSN5pO63htf1sxEkW7I9tScg.woff2` | 56,324 bytes | `20881b15b870b8005986da42bf273b33da61df848d5e26e670556adfd0e3bc22` |

Licences (SIL Open Font License 1.1), each the family's own `OFL.txt` from github.com/google/fonts (`ofl/<family>/OFL.txt`) byte for byte:

| Family | Copyright line | File |
| --- | --- | --- |
| Figtree | Copyright 2022 The Figtree Project Authors (https://github.com/erikdkennedy/figtree) | `fonts/LICENSE-figtree-OFL.txt` |
| Instrument Serif | Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif) | `fonts/LICENSE-instrument-serif-OFL.txt` |
| JetBrains Mono | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) | `fonts/LICENSE-jetbrains-mono-OFL.txt` |
| Noto Music | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/music) | `fonts/LICENSE-noto-music-OFL.txt` |

The page asks for each file as `./vendor/fonts/<file>?h=<12 hex of the sha256 of its bytes>` (server.js rewrites the `?v=1` of the source,
`static-assets.js`), which the server answers `immutable` (no gzip: a woff2 is compressed already). `tests/load/fonts.test.js` checks the table above against
the files, the licences against the families, and the `@font-face` rules of the page against Google's published faces.
