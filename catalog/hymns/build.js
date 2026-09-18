'use strict';
const fs = require('fs');
const path = require('path');
const { toMusicXml } = require('./abc-to-musicxml');
const sources = require('./sources');

const ABC_DIR = process.env.OPENHYMNAL_ABC
  || 'C:/Users/kimyi/AppData/Local/Temp/grok-goal-eaff4041d1ea/implementer/openhymnal/abc';
const OUT = __dirname;

function main() {
  if (sources.length !== 100) throw new Error('need 100 hymns, got ' + sources.length);
  const titles = new Set();
  const rows = [];
  sources.forEach(h => {
    if (titles.has(h.title)) throw new Error('duplicate title ' + h.title);
    titles.add(h.title);
    const abcPath = path.join(ABC_DIR, h.abc);
    if (!fs.existsSync(abcPath)) throw new Error('missing ABC ' + h.abc);
    const abc = fs.readFileSync(abcPath, 'utf8');
    const xml = toMusicXml(abc, { title: h.title, composer: h.titleEn });
    const file = h.id + '.musicxml';
    fs.writeFileSync(path.join(OUT, file), xml, 'utf8');
    rows.push({
      id: h.id,
      title: h.title,
      titleEn: h.titleEn,
      composer: h.titleEn,
      license: 'Public domain (Open Hymnal Project SATB setting, two-staff piano reduction)',
      file: file,
      youtubeId: h.youtubeId || null
    });
    const measures = (xml.match(/<measure /g) || []).length;
    const notes = (xml.match(/<pitch>/g) || []).length;
    console.log(h.id + '\t' + measures + ' bars\t' + notes + ' pitches\t' + h.title);
  });
  const index = {
    license: 'Public-domain hymn tunes from the Open Hymnal Project, reduced to two-staff piano. Korean titles are common 찬송가 names. Not official hymnal engravings or lyrics.',
    hymns: rows
  };
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log('wrote', rows.length, 'hymns');
}

main();
