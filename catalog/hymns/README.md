# 찬송가 piano scores

One hundred public-domain hymn tunes from the [Open Hymnal Project](http://openhymnal.org/) (ABC SATB settings, 2014.06), reduced to two-staff piano MusicXML.

Korean titles are the names these hymns are sung under in 찬송가 use. This is not the official 새찬송가 engraving, and it does not include hymnal lyrics.

Each `index.json` row names the MusicXML file and a YouTube piano-performance watch id for Practice.

Rebuild from a local Open Hymnal ABC tree with:

```
set OPENHYMNAL_ABC=path\to\abc
node catalog/hymns/build.js
```
