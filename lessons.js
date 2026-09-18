/* PPP — Piano Basics.

   A course for someone who has never sat at a piano: the keys, Do Re Mi up to
   the octave, finger numbers, letter names, the staff, the beat, first songs,
   the black keys, the left hand and a first chord. Twenty short lessons, each
   a few steps — something to read and hear, then something to do.

   The course is data. The page draws the step it is on and hands every key
   press (on screen, computer keyboard or MIDI) to the reducers below, which
   say what happened and what to show next. They never touch the page, so a
   test can walk a whole lesson in node. Every word shown goes through the
   app's translations; the English here is the source text. */
(function (global) {
  'use strict';

  function interpolate(s, vars) {
    if (!vars) return String(s);
    return String(s).replace(/\{\{(\w+)\}\}/g, function (_, k) { return vars[k] == null ? '' : String(vars[k]); });
  }
  function t(src, vars) {
    var I = global.PPP_I18N;
    return I && I.tx ? I.tx(src, vars) : interpolate(src, vars);
  }

  /* ------------------------------------------------------------ note names */
  var SOL = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'];
  var LET = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  /* the white key each pitch class is written on (black keys as sharps) */
  var PC_STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  var PC_SHARP = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  function pc(m) { return ((m % 12) + 12) % 12; }
  function isBlack(m) { return PC_SHARP[pc(m)] === 1; }
  function sol(m) { var p = pc(m); return t(SOL[PC_STEP[p]]) + (PC_SHARP[p] ? '♯' : ''); }
  function letter(m) { var p = pc(m); return LET[PC_STEP[p]] + (PC_SHARP[p] ? '♯' : ''); }
  /* the same black key, spelled as a flat of the white key above it */
  function solFlat(m) { var p = pc(m); return PC_SHARP[p] ? t(SOL[(PC_STEP[p] + 1) % 7]) + '♭' : sol(m); }
  function letterFlat(m) { var p = pc(m); return PC_SHARP[p] ? LET[(PC_STEP[p] + 1) % 7] + '♭' : letter(m); }
  /* diatonic position: one per white key, so a staff line or space is one step */
  function diat(m) { return (Math.floor(m / 12) - 1) * 7 + PC_STEP[pc(m)]; }

  var C4 = 60;
  var UP8 = [60, 62, 64, 65, 67, 69, 71, 72];
  var UP5 = [60, 62, 64, 65, 67];
  var rev = function (a) { return a.slice().reverse(); };

  /* ------------------------------------------------------------------ songs
     Notes as MIDI, lengths in beats. Each splits in two where a phrase ends. */
  var SONGS = {
    airplane: {
      notes: [64, 62, 60, 62, 64, 64, 64, 62, 62, 62, 64, 67, 67, 64, 62, 60, 62, 64, 64, 64, 62, 62, 64, 62, 60],
      beats: [1, 1, 1, 1, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 4],
      split: 13, bpm: 100
    },
    school: {
      notes: [67, 67, 69, 69, 67, 67, 64, 67, 67, 64, 64, 62, 67, 67, 69, 69, 67, 67, 64, 67, 64, 62, 64, 60],
      beats: [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 4, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 4],
      split: 12, bpm: 104
    },
    twinkle: {
      notes: [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60,
        67, 67, 65, 65, 64, 64, 62, 67, 67, 65, 65, 64, 64, 62,
        60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60],
      beats: [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2,
        1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2,
        1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2],
      split: 14, bpm: 100
    },
    ode: {
      notes: [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62,
        64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60],
      beats: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 2,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 2],
      split: 15, bpm: 104
    }
  };
  /* The three steps every song lesson ends with: each half with the next key
     lit, then the whole thing on your own. */
  function songSteps(id) {
    var s = SONGS[id], a = s.notes.slice(0, s.split), b = s.notes.slice(s.split);
    var ba = s.beats.slice(0, s.split), bb = s.beats.slice(s.split);
    return [
      { kind: 'play', title: 'First half', text: ['Play the first half. The coloured key shows where to go next.'], seq: a, beats: ba, bpm: s.bpm, hint: true, chips: true },
      { kind: 'play', title: 'Second half', text: ['Now the second half.'], seq: b, beats: bb, bpm: s.bpm, hint: true, chips: true },
      { kind: 'play', title: 'The whole song', text: ['Now all of it, without the coloured key. Take your time — the song waits for you.'], seq: s.notes, beats: s.beats, bpm: s.bpm, hint: false, chips: true }
    ];
  }
  function songListen(id) { var s = SONGS[id]; return { seq: s.notes, beats: s.beats, bpm: s.bpm }; }

  /* ---------------------------------------------------------------- course */
  var COURSE = [
    { id: 'u1', title: 'Meet the piano', lessons: [
      { id: 'keys', title: 'White keys and black keys', goal: 'Find your way around the keyboard.',
        keys: { lo: 48, hi: 83, labels: 'none' }, steps: [
          { kind: 'read', title: 'Low on the left, high on the right',
            text: ['A piano has white keys and black keys. Tap a few keys below and listen.',
              'Keys on the left sound low, like a big drum. Keys on the right sound high, like a bird.'] },
          { kind: 'read', title: 'Black keys come in twos and threes',
            text: ['Look at the black keys. They come in groups: two, then three, then two, then three — all the way along.',
              'This pattern is your map. Every note on the piano is found by the black keys around it.'],
            keys: { hl: [49, 51, 61, 63, 73, 75], hl2: [54, 56, 58, 66, 68, 70, 78, 80, 82] } },
          { kind: 'find', title: 'Find the groups of two', text: ['Tap every black key that is in a group of two.'],
            pcs: [1, 3], miss: 'Look for black keys that come in a pair, not three in a row.' },
          { kind: 'quiz', title: 'Quick check', qs: [
            { q: 'Which side of the piano sounds higher?', choices: ['The left side', 'The right side'], answer: 1,
              why: 'Going right, every key sounds a little higher.' },
            { q: 'How are the black keys grouped?', choices: ['In twos and threes', 'All in one long row', 'In fours'], answer: 0,
              why: 'Two, three, two, three — that pattern repeats across the whole piano.' }] }
        ] },
      { id: 'do', title: 'Find Do', goal: 'Find Do anywhere on the piano — and Middle Do.',
        keys: { lo: 48, hi: 83, labels: 'names' }, steps: [
          { kind: 'read', title: 'Do lives next to the two black keys',
            text: ['Do is the white key just to the left of each group of two black keys.',
              'Every group of two has a Do in front of it, so there are many Dos. They all sound alike — only higher or lower.'],
            keys: { hl: [48, 60, 72], names: [48, 60, 72] } },
          { kind: 'find', title: 'Find every Do', text: ['Tap every Do on the keyboard.'], pcs: [0],
            keys: { labels: 'none' }, miss: 'Do is just to the left of the two black keys.' },
          { kind: 'read', title: 'Middle Do is home',
            text: ['The Do closest to the middle of the piano is called Middle Do. It is where your right hand starts.',
              'When you sit at a piano, sit so Middle Do is in front of you.'],
            keys: { hl: [60], names: [60], middle: true } },
          { kind: 'play', title: 'Play Middle Do', text: ['Play Middle Do. It is marked with a dot.'], seq: [60], hint: false,
            keys: { labels: 'none', middle: true } }
        ] },
      { id: 'doremi', title: 'Do, Re, Mi', goal: 'Play your first three notes.',
        keys: { lo: 60, hi: 71, labels: 'names', names: [60, 62, 64] }, steps: [
          { kind: 'read', title: 'Three neighbours',
            text: ['After Do comes Re, then Mi. Re is the white key between the two black keys. Mi is just to the right of them.',
              'Tap Do, Re and Mi and listen to them climb like stairs.'],
            keys: { hl: [60, 62, 64] }, listen: { seq: [60, 62, 64] } },
          { kind: 'play', title: 'Go up: Do Re Mi', text: ['Play Do, Re, Mi. The coloured key shows where to go next.'], seq: [60, 62, 64], hint: true },
          { kind: 'play', title: 'Come down: Mi Re Do', text: ['Now come back down.'], seq: [64, 62, 60], hint: true },
          { kind: 'play', title: 'On your own', text: ['This time without the coloured key: Do Re Mi Re Do.'], seq: [60, 62, 64, 62, 60], hint: false, chips: true }
        ] },
      { id: 'fasol', title: 'Fa and Sol', goal: 'Add two more notes — five in a row.',
        keys: { lo: 60, hi: 71, labels: 'names', names: UP5 }, steps: [
          { kind: 'read', title: 'Fa is next to the three black keys',
            text: ['Fa is the white key just to the left of the group of three black keys. Sol comes right after Fa.',
              'Now you know five notes: Do Re Mi Fa Sol.'],
            keys: { hl: [65, 67] }, listen: { seq: UP5 } },
          { kind: 'play', title: 'Up five', text: ['Play Do Re Mi Fa Sol.'], seq: UP5, hint: true },
          { kind: 'play', title: 'Down five', text: ['And back down: Sol Fa Mi Re Do.'], seq: rev(UP5), hint: true },
          { kind: 'play', title: 'Skip a step', text: ['Skip every other key: Do, Mi, Sol. You will meet these three again as your first chord.'],
            seq: [60, 64, 67], hint: false, chips: true }
        ] },
      { id: 'octave', title: 'La, Ti, and high Do', goal: 'Finish the scale — all eight notes.',
        keys: { lo: 60, hi: 72, labels: 'names' }, steps: [
          { kind: 'read', title: 'Eight notes make an octave',
            text: ['After Sol come La and Ti. Then comes Do again — a higher Do.',
              'From one Do to the next is called an octave. Do Re Mi Fa Sol La Ti Do is the C major scale.'],
            keys: { hl: [69, 71, 72] }, listen: { seq: UP8 } },
          { kind: 'play', title: 'The whole scale', text: ['Play all eight, from Do up to high Do.'], seq: UP8, hint: true },
          { kind: 'play', title: 'And back down', text: ['Now from high Do down to Do.'], seq: rev(UP8), hint: true },
          { kind: 'quiz', title: 'Quick check', qs: [
            { q: 'What comes after Sol?', choices: ['La', 'Fa', 'Ti'], answer: 0, why: 'Do Re Mi Fa Sol La Ti Do.' },
            { q: 'Which white key sits between the two black keys?', choices: ['Do', 'Re', 'Mi'], answer: 1,
              why: 'Re sits between the two black keys, like the filling in a sandwich.' },
            { q: 'What is an octave?', choices: ['From one Do to the next Do', 'Any five keys', 'Only the black keys'], answer: 0,
              why: 'Eight white keys, from Do up to the next Do.' }] }
        ] }
    ] },

    { id: 'u2', title: 'Hands and names', lessons: [
      { id: 'fingers', title: 'Finger numbers', goal: 'Number your fingers and put your right hand in place.',
        keys: { lo: 60, hi: 71, labels: 'fingers', fingers: { 60: 1, 62: 2, 64: 3, 65: 4, 67: 5 } }, steps: [
          { kind: 'read', title: 'Every finger has a number', hands: true,
            text: ['Your thumb is 1, then 2, 3 and 4, and your little finger is 5.',
              'It is the same on both hands: thumbs are always 1.'] },
          { kind: 'read', title: 'Right hand on the keys',
            text: ['Put your right thumb on Middle Do. Let the other fingers rest on the next white keys: 2 on Re, 3 on Mi, 4 on Fa, 5 on Sol.',
              'Curve your fingers as if holding a small ball, and play with the tips.'] },
          { kind: 'quiz', title: 'Which finger?', qs: [
            { q: 'With your thumb on Do, which finger plays Mi?', choices: ['1', '2', '3', '4', '5'], answer: 2, why: 'Do 1, Re 2, Mi 3.' },
            { q: 'Which finger is number 1?', choices: ['Thumb', 'Little finger', 'Pointer'], answer: 0, why: 'Thumbs are always 1.' },
            { q: 'Your little finger (5) rests on…', choices: ['Do', 'Fa', 'Sol'], answer: 2, why: '1 2 3 4 5 lands on Do Re Mi Fa Sol.' }] },
          { kind: 'play', title: 'Play 1 2 3 4 5', text: ['One finger per key: 1 2 3 4 5, then back 4 3 2 1.'],
            seq: [60, 62, 64, 65, 67, 65, 64, 62, 60], hint: true }
        ] },
      { id: 'letters', title: 'Letter names: C D E F G A B', goal: 'Learn the other name every note has.',
        keys: { lo: 60, hi: 72, labels: 'names' }, steps: [
          { kind: 'read', title: 'Every note has a letter',
            text: ['Do Re Mi are names you can sing. Pianos and sheet music also use letters:',
              'Do = C, Re = D, Mi = E, Fa = F, Sol = G, La = A, Ti = B.',
              'The letters stop at G and start again at A. That is why Middle Do is also called Middle C.'] },
          { kind: 'quiz', title: 'Match the names', qs: [
            { q: 'What letter is Sol?', choices: ['E', 'G', 'A'], answer: 1, why: 'Sol is G.' },
            { q: 'What letter is Do?', choices: ['A', 'C', 'D'], answer: 1, why: 'Do is C — that is why it is called Middle C.' },
            { q: 'Which note is F?', choices: ['Mi', 'Fa', 'La'], answer: 1, why: 'F is Fa.' },
            { q: 'Which note is A?', choices: ['La', 'Ti', 'Re'], answer: 0, why: 'A is La.' }] },
          { kind: 'play', title: 'Play by letter', text: ['Play C, E, G. Only the letters are on the keys now.'],
            seq: [60, 64, 67], hint: false, keys: { labels: 'letters' } },
          { kind: 'play', title: 'Spell a word', text: ['Play the notes that spell BAG: B, A, G.'],
            seq: [71, 69, 67], hint: false, keys: { labels: 'letters' } }
        ] }
    ] },

    { id: 'u3', title: 'Reading music', lessons: [
      { id: 'staff', title: 'The staff and the treble clef', goal: 'See how notes are written down.',
        keys: { lo: 60, hi: 72, labels: 'names' }, steps: [
          { kind: 'read', title: 'Five lines',
            text: ['Music is written on five lines called a staff. Each note sits on a line or in a space between two lines.',
              'The higher a note sits, the higher it sounds. Press Listen to hear these go up.'],
            staff: { clef: 'treble', notes: UP8 }, listen: { seq: UP8 } },
          { kind: 'read', title: 'The treble clef',
            text: ['The curly sign at the start is the treble clef. It says: these notes are for the higher part of the piano — usually the right hand.'],
            staff: { clef: 'treble', notes: [], big: true } },
          { kind: 'read', title: 'Middle Do on the staff',
            text: ['Middle Do sits below the staff on a short line of its own, called a ledger line.',
              'Re hangs just under the bottom line, and Mi sits on the bottom line.'],
            staff: { clef: 'treble', notes: [60, 62, 64], labels: 'names' }, listen: { seq: [60, 62, 64] } },
          { kind: 'quiz', title: 'Quick check', qs: [
            { q: 'How many lines does a staff have?', choices: ['4', '5', '6'], answer: 1, why: 'Five lines, with four spaces between them.' },
            { q: 'A note higher on the staff sounds…', choices: ['Higher', 'Lower', 'The same'], answer: 0, why: 'Up on the page is up in sound.' },
            { q: 'Where is Middle Do written?', choices: ['On a short line below the staff', 'On the top line', 'In the middle space'], answer: 0,
              why: 'It gets its own little ledger line under the staff.' }] }
        ] },
      { id: 'readlow', title: 'Reading Do to Sol', goal: 'Read the five notes under your right hand.',
        keys: { lo: 60, hi: 72, labels: 'names' }, steps: [
          { kind: 'read', title: 'Line, space, line, space',
            text: ['Each step up the staff — from a line to the next space, or a space to the next line — is the next white key.',
              'Do on its ledger line, Re under the staff, Mi on the 1st line, Fa in the 1st space, Sol on the 2nd line.'],
            staff: { clef: 'treble', notes: UP5, labels: 'names' }, listen: { seq: UP5 } },
          { kind: 'drill', title: 'Name the note', clef: 'treble', pool: UP5, count: 8 },
          { kind: 'play', title: 'Read and play', text: ['Play the notes on the staff from left to right. The names are hidden — read them!'],
            seq: [60, 62, 64, 62, 60, 64, 65, 67], hint: false, read: true, staff: { clef: 'treble' }, keys: { labels: 'none', middle: true } }
        ] },
      { id: 'readhigh', title: 'Reading up to high Do', goal: 'Read all eight notes of the scale.',
        keys: { lo: 60, hi: 72, labels: 'names' }, steps: [
          { kind: 'read', title: 'Up to the middle line and beyond',
            text: ['La sits in the 2nd space, Ti on the middle line, and high Do in the 3rd space.',
              'Now you can read the whole scale: Do Re Mi Fa Sol La Ti Do.'],
            staff: { clef: 'treble', notes: UP8, labels: 'names' }, listen: { seq: UP8 } },
          { kind: 'drill', title: 'Name the note', clef: 'treble', pool: UP8, count: 10 },
          { kind: 'play', title: 'Read and play', text: ['Play what you see, from left to right.'],
            seq: [67, 69, 71, 72, 71, 69, 67, 64, 60], hint: false, read: true, staff: { clef: 'treble' }, keys: { labels: 'none', middle: true } }
        ] }
    ] },

    { id: 'u4', title: 'Rhythm', lessons: [
      { id: 'beat', title: 'The beat and quarter notes', goal: 'Feel the steady pulse under all music.', steps: [
        { kind: 'read', title: 'Music has a heartbeat',
          text: ['Music has a steady pulse called the beat, like a clock ticking. Press Listen and tap your foot along with it.'],
          rhythm: [1, 1, 1, 1], listen: { pattern: [1, 1, 1, 1], bpm: 72 } },
        { kind: 'read', title: 'The quarter note',
          text: ['A quarter note is a filled-in note with a stem. It lasts one beat.',
            'Count out loud while you play: 1, 2, 3, 4.'],
          rhythm: [1, 1, 1, 1], listen: { pattern: [1, 1, 1, 1], bpm: 72 } },
        { kind: 'rhythm', title: 'Tap the beat',
          text: ['Press Start. After four clicks, tap once on every note — with the Tap button, the space bar or any piano key.'],
          pattern: [1, 1, 1, 1, 1, 1, 1, 1], bpm: 72 }
      ] },
      { id: 'long', title: 'Half notes and whole notes', goal: 'Hold notes for two and four beats.', steps: [
        { kind: 'read', title: 'Longer notes',
          text: ['A half note is hollow with a stem. It lasts two beats: play on 1, hold through 2.',
            'A whole note is hollow with no stem. It lasts four beats: play on 1, hold through 2, 3 and 4.'],
          rhythm: [2, 2, 4], listen: { pattern: [2, 2, 4], bpm: 72 } },
        { kind: 'quiz', title: 'Quick check', qs: [
          { q: 'How many beats does a half note last?', choices: ['1', '2', '4'], answer: 1, why: 'Half of a whole note: two beats.' },
          { q: 'How many beats does a whole note last?', choices: ['2', '3', '4'], answer: 2, why: 'A whole note fills a whole measure of four beats.' },
          { q: 'Which note lasts one beat?', choices: ['Quarter note', 'Half note', 'Whole note'], answer: 0, why: 'The filled-in note with a stem: one beat.' }] },
        { kind: 'rhythm', title: 'Tap long and short', text: ['Tap once at the start of each note, then wait while it is held.'],
          pattern: [1, 1, 2, 1, 1, 2, 4], bpm: 72 }
      ] },
      { id: 'measures', title: 'Measures, 4/4 and rests', goal: 'Count music in groups of four.', steps: [
        { kind: 'read', title: 'Bar lines make measures',
          text: ['Music is divided into measures by bar lines. The 4/4 at the start is the time signature: every measure holds four beats.',
            'Count 1 2 3 4 in every measure, then start again at 1.'],
          staff: { clef: 'treble', notes: [60, 62, 64, 65, 64, 62, 60], beats: [1, 1, 2, 1, 1, 2, 4], time: true },
          listen: { seq: [60, 62, 64, 65, 64, 62, 60], beats: [1, 1, 2, 1, 1, 2, 4], bpm: 80 } },
        { kind: 'read', title: 'Rests are silent beats',
          text: ['A rest means: do not play, but keep counting. A quarter rest is one silent beat.'],
          rhythm: [1, 1, 1, -1, 1, -1, 2], listen: { pattern: [1, 1, 1, -1, 1, -1, 2], bpm: 72 } },
        { kind: 'quiz', title: 'Quick check', qs: [
          { q: 'In 4/4 time, how many beats are in each measure?', choices: ['3', '4', '8'], answer: 1, why: 'The top 4 says: four beats in every measure.' },
          { q: 'What do you do on a rest?', choices: ['Stay silent and keep counting', 'Play louder', 'Skip the next note'], answer: 0,
            why: 'Silence is part of the music — the beat keeps going.' },
          { q: 'Quarter + quarter + half: how many beats?', choices: ['3', '4', '5'], answer: 1, why: '1 + 1 + 2 = 4: exactly one measure.' }] },
        { kind: 'rhythm', title: 'Tap with rests', text: ['Tap on the notes and stay still on the rests.'],
          pattern: [1, 1, 1, -1, 2, 2, 1, -1, 1, -1, 4], bpm: 72 }
      ] }
    ] },

    { id: 'u5', title: 'First songs', lessons: [
      { id: 'airplane', title: 'Airplane (Mary Had a Little Lamb)', goal: 'Play a whole song with Do, Re, Mi and Sol.',
        keys: { lo: 60, hi: 71, labels: 'names' }, steps: [
          { kind: 'read', title: 'Listen first', chips: true,
            text: ['Your first song uses only Do, Re, Mi and Sol. Put your right thumb on Do.',
              'Press Listen to hear it, and sing along with the note names.'],
            seq: SONGS.airplane.notes, listen: songListen('airplane') }
        ].concat(songSteps('airplane')) },
      { id: 'school', title: 'School Bell (Korean children’s song)', goal: 'Play a song that reaches up to La.',
        keys: { lo: 60, hi: 71, labels: 'names' }, steps: [
          { kind: 'read', title: 'Listen first', chips: true,
            text: ['This song uses Do, Re, Mi, Sol and La. La is one key past your little finger — stretch over to it, then come back.',
              'Press Listen and follow the note names.'],
            seq: SONGS.school.notes, listen: songListen('school') }
        ].concat(songSteps('school')) },
      { id: 'twinkle', title: 'Twinkle, Twinkle, Little Star', goal: 'Play a longer song with six notes.',
        keys: { lo: 60, hi: 71, labels: 'names' }, steps: [
          { kind: 'read', title: 'Listen first', chips: true,
            text: ['Twinkle uses six notes, from Do up to La. It starts with a jump: Do Do, then up to Sol Sol.',
              'Each line ends on a longer note — hold it for two beats.'],
            seq: SONGS.twinkle.notes, listen: songListen('twinkle') }
        ].concat(songSteps('twinkle')) },
      { id: 'ode', title: 'Ode to Joy', goal: 'Play Beethoven — with all five fingers.',
        keys: { lo: 60, hi: 71, labels: 'names' }, steps: [
          { kind: 'read', title: 'Listen first', chips: true,
            text: ['Beethoven’s Ode to Joy fits right under your hand: thumb on Do, little finger on Sol, no stretching.',
              'Most of it moves step by step to the very next key.'],
            seq: SONGS.ode.notes, listen: songListen('ode') }
        ].concat(songSteps('ode')) }
    ] },

    { id: 'u6', title: 'Black keys, left hand, chords', lessons: [
      { id: 'sharps', title: 'Sharps and flats', goal: 'Name the black keys.',
        keys: { lo: 60, hi: 72, labels: 'names', blackNames: true }, steps: [
          { kind: 'read', title: 'Half steps',
            text: ['From any key to the very next key — black or white — is a half step. It is the smallest step on the piano.',
              'A sharp ♯ means one half step higher. A flat ♭ means one half step lower.'],
            keys: { hl: [60, 61], blackNames: false }, listen: { seq: [60, 61, 62, 63, 64] } },
          { kind: 'read', title: 'Two names for one key',
            text: ['So the black key between Do and Re has two names: Do♯ (Do sharp) and Re♭ (Re flat). It is the same key.',
              'Between Mi and Fa, and between Ti and Do, there is no black key — they are already a half step apart.'] },
          { kind: 'quiz', title: 'Quick check', qs: [
            { q: 'Where is Do♯?', choices: ['The black key just right of Do', 'The white key right of Do', 'The key just left of Do'], answer: 0,
              why: 'Sharp means one half step up: the very next key to the right.' },
            { q: 'A flat ♭ moves a note…', choices: ['Down, to the left', 'Up, to the right'], answer: 0, why: 'A flat goes down one half step.' },
            { q: 'Which pair has no black key between them?', choices: ['Mi and Fa', 'Do and Re', 'Fa and Sol'], answer: 0,
              why: 'Mi–Fa and Ti–Do are already a half step apart.' }] },
          { kind: 'play', title: 'Every key', text: ['Play every key from Do to Mi, black ones too: Do, Do♯, Re, Re♯, Mi.'],
            seq: [60, 61, 62, 63, 64], hint: true },
          { kind: 'play', title: 'The group of three', text: ['Play Fa♯, Sol♯ and La♯ — the three black keys together in a group.'],
            seq: [66, 68, 70], hint: false }
        ] },
      { id: 'lefthand', title: 'The left hand and the bass clef', goal: 'Wake up your left hand.',
        keys: { lo: 48, hi: 64, labels: 'fingers', fingers: { 48: 5, 50: 4, 52: 3, 53: 2, 55: 1 }, middle: true }, kbBase: 48, steps: [
          { kind: 'read', title: 'The bass clef',
            text: ['Low notes are written with the bass clef. Its two dots sit either side of the line for Fa.',
              'The left hand usually plays these lower notes. Here are Do to Sol, one octave below Middle Do.'],
            staff: { clef: 'bass', notes: [48, 50, 52, 53, 55], labels: 'names' }, listen: { seq: [48, 50, 52, 53, 55] } },
          { kind: 'read', title: 'Left hand in place',
            text: ['Put your left little finger (5) on the Do below Middle Do. Your thumb (1) lands on Sol.',
              'On the left hand the numbers run the other way: Do Re Mi Fa Sol is 5 4 3 2 1.'] },
          { kind: 'play', title: 'Left hand up', text: ['Play Do Re Mi Fa Sol with fingers 5 4 3 2 1.'], seq: [48, 50, 52, 53, 55], hint: true },
          { kind: 'play', title: 'Left hand down', text: ['And back down with 1 2 3 4 5.'], seq: [55, 53, 52, 50, 48], hint: true },
          { kind: 'drill', title: 'Read the bass clef', clef: 'bass', pool: [48, 50, 52, 53, 55], count: 6, keys: { labels: 'none' } }
        ] },
      { id: 'chords', title: 'Your first chord', goal: 'Play three notes at once.',
        keys: { lo: 48, hi: 71, labels: 'names', middle: true }, steps: [
          { kind: 'read', title: 'Notes together',
            text: ['A chord is two or more notes played at the same time. Do, Mi and Sol together make the C major chord — a bright, happy sound.',
              'Press Listen to hear it.'],
            keys: { hl: [60, 64, 67] }, listen: { chord: [60, 64, 67] } },
          { kind: 'chord', title: 'Right hand chord',
            text: ['Play Do, Mi and Sol together with fingers 1, 3 and 5. On screen, tap the three keys one after another.'],
            notes: [60, 64, 67], keys: { labels: 'fingers', fingers: { 60: 1, 64: 3, 67: 5 } } },
          { kind: 'chord', title: 'Left hand chord', text: ['Now the left hand, one octave lower, with fingers 5, 3 and 1.'],
            notes: [48, 52, 55], keys: { labels: 'fingers', fingers: { 48: 5, 52: 3, 55: 1 } }, kbBase: 48 },
          { kind: 'read', title: 'You finished the basics!',
            text: ['You can find every key, read notes on both clefs, count the beat, and play songs and chords.',
              'Next: open My Songs, try a sample song, and let PPP coach you through it.'],
            listen: { chord: [48, 60, 64, 67, 72] } }
        ] }
    ] }
  ];

  var LESSONS = [];
  COURSE.forEach(function (u, ui) {
    u.lessons.forEach(function (l) { l.unit = u.id; l.unitIndex = ui; l.n = LESSONS.length + 1; LESSONS.push(l); });
  });
  function lesson(id) { for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) return LESSONS[i]; return null; }
  function next(id) { var l = lesson(id); return l ? LESSONS[l.n] || null : LESSONS[0]; }
  /* the first lesson not yet done, in course order */
  function nextUp(done) {
    for (var i = 0; i < LESSONS.length; i++) if (!(done && done[LESSONS[i].id])) return LESSONS[i];
    return null;
  }

  /* The keyboard a step shows: the lesson's, with the step's own on top, and
     for exercises wide enough for every key they ask for. */
  function keysFor(les, step) {
    var o = {};
    var base = les.keys || {}, own = step.keys || {};
    Object.keys(base).forEach(function (k) { o[k] = base[k]; });
    Object.keys(own).forEach(function (k) { o[k] = own[k]; });
    var want = (step.seq || []).concat(step.notes || [], step.pool || []);
    var lo = o.lo != null ? o.lo : 60, hi = o.hi != null ? o.hi : 72;
    want.forEach(function (m) {
      if (m < lo) lo = m - pc(m);
      if (m > hi) hi = m - pc(m) + 11;
    });
    o.lo = lo; o.hi = hi;
    if (!o.labels) o.labels = 'names';
    return o;
  }
  /* The computer keyboard's A key is this note; the row A S D F G H J K… plays white keys up from it. */
  function kbBase(les, step) { return step.kbBase || les.kbBase || C4; }
  var KEY_CODES = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
    KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
  function codeToMidi(code, base) { return KEY_CODES[code] == null ? null : base + KEY_CODES[code]; }

  /* ---------------------------------------------------------------- reducers
     Each step's working state ("lx"). Every reducer returns a new object. */
  function copy(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }
  function fresh(step, rnd) {
    var lx = { kind: step.kind, done: step.kind === 'read', flash: null, msg: '', tone: '', misses: 0 };
    if (step.kind === 'play') { lx.idx = 0; lx.slips = 0; }
    if (step.kind === 'find') lx.found = [];
    if (step.kind === 'chord') lx.got = [];
    if (step.kind === 'quiz') { lx.qi = 0; lx.wrong = []; lx.right = false; lx.first = 0; }
    if (step.kind === 'drill') { lx.n = 0; lx.wrong = []; lx.right = false; lx.first = 0; lx.note = pickNote(step, null, rnd); }
    if (step.kind === 'rhythm') { lx.run = null; lx.result = null; }
    return lx;
  }
  function pickNote(step, prev, rnd) {
    var pool = step.pool.filter(function (m) { return m !== prev; });
    return pool[Math.floor((rnd || Math.random)() * pool.length) % pool.length];
  }
  function targets(les, step) {
    var k = keysFor(les, step), out = [];
    for (var m = k.lo; m <= k.hi; m++) if (step.pcs.indexOf(pc(m)) > -1) out.push(m);
    return out;
  }
  function good(lx, m, msg) { lx.flash = { m: m, kind: 'good' }; lx.msg = msg; lx.tone = 'good'; return lx; }
  function bad(lx, m, msg) { lx.flash = { m: m, kind: 'bad' }; lx.msg = msg; lx.tone = 'bad'; lx.misses++; return lx; }

  /* A key pressed during a step. */
  function press(les, step, prev, m) {
    var lx = copy(prev);
    if (step.kind === 'play') {
      if (lx.done) return good(lx, m, prev.msg);
      var want = step.seq[lx.idx];
      if (m === want) {
        lx.idx++; lx.slips = 0;
        if (lx.idx >= step.seq.length) { lx.done = true; return good(lx, m, t('Well done — you played it all!')); }
        return good(lx, m, step.read ? t('Good!') : t('Good! Next: {{note}}', { note: sol(step.seq[lx.idx]) }));
      }
      lx.slips++;
      return bad(lx, m, step.read ? t('That was {{got}}. Look at the staff again.', { got: sol(m) })
        : t('That was {{got}} — look for {{want}}.', { got: sol(m), want: sol(want) }));
    }
    if (step.kind === 'find') {
      var all = targets(les, step);
      if (all.indexOf(m) < 0) return bad(lx, m, t(step.miss || 'Not that one — try another key.'));
      if (lx.found.indexOf(m) > -1) return good(lx, m, t('You already found that one.'));
      lx.found = lx.found.concat([m]);
      if (lx.found.length >= all.length) { lx.done = true; return good(lx, m, t('All {{n}} found!', { n: all.length })); }
      return good(lx, m, t('{{got}} of {{n}} found.', { got: lx.found.length, n: all.length }));
    }
    if (step.kind === 'chord') {
      if (step.notes.indexOf(m) < 0) {
        lx.got = [];
        return bad(lx, m, t('That was {{got}}. The chord is {{names}}.', { got: sol(m), names: step.notes.map(sol).join(' · ') }));
      }
      if (lx.got.indexOf(m) < 0) lx.got = lx.got.concat([m]);
      if (lx.got.length >= step.notes.length) { lx.done = true; return good(lx, m, t('All together — that is a chord!')); }
      return good(lx, m, t('{{got}} of {{n}} keys.', { got: lx.got.length, n: step.notes.length }));
    }
    if (step.kind === 'drill') return answer(step, lx, pc(m), m);
    /* read: any key just sounds */
    lx.flash = { m: m, kind: 'hl' };
    return lx;
  }
  /* A name picked (or a key played) for the note on the staff. Octave does
     not matter: this is about reading the name. */
  function answer(step, prev, p, m) {
    var lx = copy(prev);
    if (lx.done || lx.right) return lx;
    if (p === pc(lx.note)) {
      lx.right = true; lx.n++;
      if (!lx.wrong.length) lx.first++;
      lx.flash = m != null ? { m: m, kind: 'good' } : null;
      lx.msg = t('Yes — {{note}}!', { note: sol(lx.note) }); lx.tone = 'good';
      if (lx.n >= step.count) lx.done = true;
      return lx;
    }
    lx.wrong = lx.wrong.concat([p]); lx.misses++;
    lx.flash = m != null ? { m: m, kind: 'bad' } : null;
    lx.msg = t('Not {{got}}. Count lines and spaces up from a note you know.', { got: t(SOL[PC_STEP[p]]) }); lx.tone = 'bad';
    return lx;
  }
  function nextDrill(step, prev, rnd) {
    var lx = copy(prev);
    if (lx.done) return lx;
    lx.note = pickNote(step, prev.note, rnd); lx.right = false; lx.wrong = []; lx.msg = ''; lx.tone = ''; lx.flash = null;
    return lx;
  }
  function choose(step, prev, i) {
    var lx = copy(prev), q = step.qs[lx.qi];
    if (lx.right || lx.done) return lx;
    if (i === q.answer) {
      lx.right = true;
      if (!lx.wrong.length) lx.first++;
      lx.msg = t(q.why); lx.tone = 'good';
      if (lx.qi + 1 >= step.qs.length) lx.done = true;
      return lx;
    }
    if (lx.wrong.indexOf(i) < 0) lx.wrong = lx.wrong.concat([i]);
    lx.misses++;
    lx.msg = t('Not quite — try another answer.'); lx.tone = 'bad';
    return lx;
  }
  function nextQuestion(step, prev) {
    var lx = copy(prev);
    if (!lx.right || lx.qi + 1 >= step.qs.length) return lx;
    lx.qi++; lx.right = false; lx.wrong = []; lx.msg = ''; lx.tone = '';
    return lx;
  }

  /* --------------------------------------------------------------- rhythm
     Beats from the first note; a negative length is a rest. */
  function onsets(pattern) {
    var at = 0, out = [];
    pattern.forEach(function (d, i) { if (d > 0) out.push({ i: i, at: at }); at += Math.abs(d); });
    return out;
  }
  function length(pattern) { return pattern.reduce(function (a, d) { return a + Math.abs(d); }, 0); }
  /* How far off a tap may be and still count: a fifth of a second either way,
     never more than a third of a beat. */
  function tolerance(bpm) { return Math.min(0.33, 0.22 / (60 / bpm)); }
  /* A tap `beat` beats after the first note: the nearest note not yet hit,
     if it is close enough. */
  function tap(run, beat) {
    var r = copy(run), best = -1, bd = Infinity;
    r.hits = run.hits.slice();
    run.ons.forEach(function (o, j) {
      if (r.hits[j]) return;
      var d = Math.abs(beat - o.at);
      if (d <= run.tol && d < bd) { bd = d; best = j; }
    });
    if (best > -1) r.hits[best] = true; else r.extra = (run.extra || 0) + 1;
    return r;
  }
  function verdict(run) {
    var n = run.ons.length, hits = run.hits.filter(Boolean).length;
    var pass = hits >= Math.ceil(n * 0.75) && (run.extra || 0) <= Math.max(2, Math.floor(n / 2));
    return { hits: hits, n: n, extra: run.extra || 0, pass: pass };
  }

  /* ----------------------------------------------------------------- views
     Plain SVG built with the page's own createElement, in its colours. */
  var KW = 40, KH = 150;
  var MARK_FILL = { next: 'var(--accent)', got: 'var(--accent)', good: 'var(--good)', bad: 'var(--bad)',
    found: 'color-mix(in oklab, var(--good) 55%, var(--key-w))', hl: 'var(--accent-2)',
    hl2: 'color-mix(in oklab, var(--warn) 45%, var(--key-w))' };
  var MARK_FILL_B = { next: 'var(--accent)', got: 'var(--accent)', good: 'var(--good)', bad: 'var(--bad)',
    found: 'var(--good)', hl: 'var(--accent)', hl2: 'var(--warn)' };
  var SOLID = { next: 1, got: 1, good: 1, bad: 1 };

  function keyboard(h, o) {
    var whites = [];
    for (var m = o.lo; m <= o.hi; m++) if (!isBlack(m)) whites.push(m);
    var W = whites.length * KW, els = [], over = [];
    var marks = o.marks || {}, fingers = o.fingers || {};
    var named = o.names ? o.names : null;
    var click = function (mm) { return o.onKey ? function (e) { if (e && e.preventDefault) e.preventDefault(); o.onKey(mm); } : undefined; };
    whites.forEach(function (mm, i) {
      var mk = marks[mm], solid = !!SOLID[mk];
      var x = i * KW;
      els.push(h('rect', { key: 'w' + mm, x: x + 1, y: 0, width: KW - 2, height: KH, rx: 6,
        'data-midi': mm, 'data-mark': mk || 'idle',
        fill: mk ? MARK_FILL[mk] : 'var(--key-w)', stroke: 'rgba(0,0,0,.2)', strokeWidth: 1,
        style: { cursor: 'pointer', transition: 'fill .12s ease' }, onPointerDown: click(mm) }));
      var ink = solid ? 'rgba(255,255,255,.97)' : 'rgba(20,18,16,.78)', ink3 = solid ? 'rgba(255,255,255,.8)' : 'rgba(20,18,16,.48)';
      var show = !named || named.indexOf(mm) > -1;
      if (o.labels === 'names' && show) {
        over.push(h('text', { key: 's' + mm, x: x + KW / 2, y: KH - 25, textAnchor: 'middle', fontSize: 13, fontWeight: 700, fill: ink }, sol(mm)));
        over.push(h('text', { key: 'l' + mm, x: x + KW / 2, y: KH - 10, textAnchor: 'middle', fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fill: ink3 }, letter(mm)));
      } else if (o.labels === 'letters' && show) {
        over.push(h('text', { key: 'l' + mm, x: x + KW / 2, y: KH - 14, textAnchor: 'middle', fontSize: 15, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fill: ink }, letter(mm)));
      } else if (o.labels === 'fingers') {
        if (show) over.push(h('text', { key: 's' + mm, x: x + KW / 2, y: KH - 12, textAnchor: 'middle', fontSize: 11.5, fontWeight: 600, fill: ink3 }, sol(mm)));
        if (fingers[mm]) {
          over.push(h('circle', { key: 'fc' + mm, cx: x + KW / 2, cy: KH - 40, r: 11, fill: solid ? 'rgba(255,255,255,.25)' : 'var(--hand)', stroke: solid ? 'rgba(255,255,255,.8)' : 'var(--hand-line)', strokeWidth: 1.2 }));
          over.push(h('text', { key: 'fn' + mm, x: x + KW / 2, y: KH - 35.5, textAnchor: 'middle', fontSize: 13, fontWeight: 700, fill: solid ? '#fff' : 'var(--hand-ink)' }, String(fingers[mm])));
        }
      }
      if (o.middle && mm === C4) {
        over.push(h('circle', { key: 'mid', cx: x + KW / 2, cy: o.labels === 'fingers' ? KH - 64 : KH - 48, r: 4.5, fill: solid ? '#fff' : 'var(--accent)', 'data-middle-c': 1 }));
      }
    });
    whites.forEach(function (mm, i) {
      var b = mm + 1;
      if (b > o.hi || !isBlack(b)) return;
      var mk = marks[b], bx = (i + 1) * KW - 12;
      els.push(h('rect', { key: 'b' + b, x: bx, y: 0, width: 24, height: 94, rx: 4,
        'data-midi': b, 'data-mark': mk || 'idle',
        fill: mk ? MARK_FILL_B[mk] : 'var(--key-b)', stroke: 'rgba(0,0,0,.4)', strokeWidth: 1,
        style: { cursor: 'pointer', transition: 'fill .12s ease' }, onPointerDown: click(b) }));
      if (o.blackNames) {
        /* the sign from the music font: the text fonts draw it hairline-thin */
        var sign = function (name) { return [name.slice(0, -1), h('tspan', { key: 't', fontFamily: MUSIC_FONT, fontSize: 11 }, name.slice(-1))]; };
        /* a black key is 24 wide: a longer name (ファ♯, Sol♯) gets a smaller size */
        var fit = function (name) {
          var em = 0.5;
          for (var c = 0; c < name.length - 1; c++) em += name.charCodeAt(c) > 0x2e80 ? 1 : 0.62;
          return Math.min(9, 21 / em);
        };
        over.push(h('text', { key: 'bs' + b, x: bx + 12, y: 70, textAnchor: 'middle', fontSize: fit(sol(b)), fontWeight: 700, fill: 'rgba(255,255,255,.95)' }, sign(sol(b))));
        over.push(h('text', { key: 'bf' + b, x: bx + 12, y: 84, textAnchor: 'middle', fontSize: fit(solFlat(b)), fontWeight: 700, fill: 'rgba(255,255,255,.72)' }, sign(solFlat(b))));
      }
    });
    /* names and marks never take the tap from the key under them */
    return h('svg', { viewBox: '0 0 ' + W + ' ' + KH, width: '100%', 'data-learn-keyboard': 1,
      style: { display: 'block', height: 'auto', margin: '0 auto', maxWidth: whites.length * 56 + 'px', minWidth: Math.min(W, whites.length * 30) + 'px', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation', fontFamily: "Figtree, 'Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC', system-ui, sans-serif" } },
      h('g', { key: 'keys' }, els),
      h('g', { key: 'names', style: { pointerEvents: 'none' } }, over));
  }

  /* Music glyphs come from whichever font the browser has — Noto Music once
     it loads, a system symbol font before — and each draws them at its own
     size and height. So the ink of a glyph is measured, and it is scaled and
     placed to fill the space it should, whatever font is doing the drawing. */
  var MUSIC_FONT = "'Noto Music', 'Segoe UI Symbol', 'Apple Symbols', serif";
  var GLYPH = { treble: '𝄞', bass: '𝄢', q: '𝄽', sharp: '♯' };
  var INK = {}, inkCanvas = null, fontAsked = false;
  function ink(g) {
    var doc = global.document;
    if (!doc || !doc.createElement) return null;
    var ready = false;
    try { ready = !!(doc.fonts && doc.fonts.check("40px 'Noto Music'", g)); } catch (e) {}
    if (!ready && !fontAsked && doc.fonts && doc.fonts.load) {
      fontAsked = true;
      /* when the music font arrives, measure again and draw again */
      doc.fonts.load("40px 'Noto Music'", GLYPH.treble + GLYPH.bass + GLYPH.q + GLYPH.sharp).then(function () {
        INK = {};
        if (api.onFonts) api.onFonts();
      }, function () {});
    }
    var key = g + (ready ? '+' : '-');
    if (INK[key]) return INK[key];
    try {
      var c = (inkCanvas || (inkCanvas = doc.createElement('canvas'))).getContext('2d');
      c.font = '100px ' + MUSIC_FONT;
      var m = c.measureText(g);
      var asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
      if (!(asc + desc > 1)) return null;
      INK[key] = { asc: asc / 100, desc: desc / 100, left: (m.actualBoundingBoxLeft || 0) / 100, right: (m.actualBoundingBoxRight || 0) / 100 };
      return INK[key];
    } catch (e) { return null; }
  }
  /* A glyph whose ink spans y0 to y1, its left edge at x (or centred on x). */
  function glyph(h, key, g, x, y0, y1, fill, centre) {
    var b = ink(g) || { asc: 0.72, desc: 0.28, left: 0, right: 0.36 };
    var size = (y1 - y0) / (b.asc + b.desc);
    var left = centre ? x - (b.right - b.left) * size / 2 : x;
    return h('text', { key: key, x: left + b.left * size, y: y0 + b.asc * size, fontSize: size, fontFamily: MUSIC_FONT, fill: fill }, g);
  }

  /* A few notes on a staff: clef, optional 4/4, heads, stems, ledger lines,
     and the note names underneath when a step wants them. */
  var LS = 10;
  var CLEF_REF = { treble: 30 /* E4, bottom line */, bass: 18 /* G2 */ };
  function noteHead(h, key, cx, cy, hollow, color, k) {
    k = k || 1;
    return h('ellipse', { key: key, cx: cx, cy: cy, rx: 6.4 * k, ry: 4.5 * k, transform: 'rotate(-20 ' + cx + ' ' + cy + ')',
      fill: hollow ? 'none' : color, stroke: color, strokeWidth: hollow ? 1.8 * k : 1 });
  }
  function staff(h, o) {
    var clef = o.clef || 'treble', ref = CLEF_REF[clef];
    var big = !!o.big;
    var top = big ? 34 : 42, bottom = top + 4 * LS;
    var notes = o.notes || [], beats = o.beats || [];
    var states = o.states || [];
    var labels = o.labels === 'names';
    var x0 = big ? 64 : 46, x = x0 + (o.time ? 26 : 0) + 14;
    if (o.solo) x = 112;
    var cols = [], at = 0;
    notes.forEach(function (m, i) {
      var d = beats[i] || 1;
      cols.push({ m: m, d: d, x: x + 8, ni: i });
      x += 30 + Math.min(4, Math.abs(d)) * 8;
      at += Math.abs(d);
      if (o.time && at % 4 === 0 && i < notes.length - 1) { cols.push({ bar: true, x: x - 6 }); x += 8; }
    });
    var W = Math.max(big ? 200 : o.solo ? 230 : 150, x + (o.time ? 14 : 6));
    var H = bottom + (labels ? 44 : 30);
    var ink = 'var(--paper-ink)', lineC = 'var(--paper-staff)';
    var els = [];
    for (var l = 0; l < 5; l++) els.push(h('line', { key: 'l' + l, x1: 4, x2: W - 4, y1: top + l * LS, y2: top + l * LS, stroke: lineC, strokeWidth: 1 }));
    els.push(h('line', { key: 'b0', x1: 4, x2: 4, y1: top, y2: bottom, stroke: lineC, strokeWidth: 1 }));
    /* where an engraver puts them: the treble clef from a space and a half
       above the staff to a space and a half below it, its curl round the G
       line; the bass clef from the top line to half a space off the bottom,
       its dots either side of the F line */
    els.push(clef === 'treble' ? glyph(h, 'clef', GLYPH.treble, 8, top - 1.4 * LS, bottom + 1.65 * LS, ink)
      : glyph(h, 'clef', GLYPH.bass, 9, top - 0.05 * LS, bottom - 0.45 * LS, ink));
    if (o.time) {
      [0, 1].forEach(function (k) {
        els.push(h('text', { key: 'ts' + k, x: x0 + 12, y: top + (k ? 4 : 2) * LS - 1.5, textAnchor: 'middle', fontSize: 21, fontWeight: 700,
          fontFamily: "Georgia, 'Times New Roman', serif", fill: ink }, '4'));
      });
    }
    cols.forEach(function (c, i) {
      if (c.bar) { els.push(h('line', { key: 'bar' + i, x1: c.x, x2: c.x, y1: top, y2: bottom, stroke: lineC, strokeWidth: 1.2 })); return; }
      var st = states[c.ni] || null;
      var col = st === 'now' ? 'var(--accent)' : st === 'done' ? 'var(--good)' : st === 'bad' ? 'var(--bad)' : ink;
      var dd = diat(c.m) - ref, cy = bottom - dd * LS / 2;
      /* ledger lines, below the bottom line or above the top one */
      for (var k = -2; k >= dd; k -= 2) els.push(h('line', { key: 'lg' + i + k, x1: c.x - 10, x2: c.x + 10, y1: bottom - k * LS / 2, y2: bottom - k * LS / 2, stroke: lineC, strokeWidth: 1.2 }));
      for (var k2 = 10; k2 <= dd; k2 += 2) els.push(h('line', { key: 'lh' + i + k2, x1: c.x - 10, x2: c.x + 10, y1: bottom - k2 * LS / 2, y2: bottom - k2 * LS / 2, stroke: lineC, strokeWidth: 1.2 }));
      if (isBlack(c.m)) els.push(glyph(h, 'acc' + i, GLYPH.sharp, c.x - 19, cy - 1.4 * LS, cy + 1.4 * LS, col));
      els.push(noteHead(h, 'n' + i, c.x, cy, c.d >= 2, col));
      if (c.d < 4) {
        var up = dd < 4;
        els.push(h('line', { key: 's' + i, x1: up ? c.x + 5.6 : c.x - 5.6, x2: up ? c.x + 5.6 : c.x - 5.6, y1: cy + (up ? -1 : 1), y2: cy + (up ? -34 : 34), stroke: col, strokeWidth: 1.4 }));
        if (c.d === 0.5) els.push(h('path', { key: 'f' + i, d: up ? 'M' + (c.x + 5.6) + ' ' + (cy - 34) + ' q 2 10 9 14' : 'M' + (c.x - 5.6) + ' ' + (cy + 34) + ' q 2 -10 9 -14', stroke: col, strokeWidth: 1.6, fill: 'none' }));
      }
      if (c.d === 1.5 || c.d === 3) els.push(h('circle', { key: 'dot' + i, cx: c.x + 11, cy: dd % 2 === 0 ? cy - 3 : cy, r: 1.8, fill: col }));
      if (labels) els.push(h('text', { key: 'nm' + i, x: c.x, y: bottom + 34, textAnchor: 'middle', fontSize: 12, fontWeight: 700, fill: st ? col : 'var(--paper-ink3)' }, sol(c.m)));
    });
    if (o.time) {
      els.push(h('line', { key: 'end1', x1: W - 9, x2: W - 9, y1: top, y2: bottom, stroke: lineC, strokeWidth: 1.2 }));
      els.push(h('line', { key: 'end2', x1: W - 5, x2: W - 5, y1: top, y2: bottom, stroke: ink, strokeWidth: 3 }));
    } else els.push(h('line', { key: 'end', x1: W - 4, x2: W - 4, y1: top, y2: bottom, stroke: lineC, strokeWidth: 1 }));
    return h('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W * (big ? 1.9 : 1.7), 'data-learn-staff': clef,
      style: { display: 'block', maxWidth: '100%', height: 'auto', margin: '0 auto', fontFamily: "Figtree, 'Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC', system-ui, sans-serif" } }, els);
  }

  /* A rhythm on one line, spaced by time so the cursor moves at an even
     speed: beat numbers under it, bar lines every four beats, and two
     measures to a row so the notes stay big enough to read. */
  function rhythm(h, o) {
    var pat = o.pattern, total = length(pat), PER = 8, BW = 54, x0 = 28, ROW = 96, Y = 50;
    var rows = Math.max(1, Math.ceil(total / PER));
    var W = x0 * 2 + Math.min(total, PER) * BW - 20, H = rows * ROW;
    var at0 = function (b) { var r = Math.min(rows - 1, Math.floor(b / PER + 1e-9)); return { r: r, x: x0 + (b - r * PER) * BW, y: Y + r * ROW }; };
    var els = [], at = 0, ons = onsets(pat), results = o.results || [];
    var ink = 'var(--paper-ink)', line = 'var(--paper-staff)';
    for (var r = 0; r < rows; r++) els.push(h('line', { key: 'base' + r, x1: 6, x2: W - 6, y1: Y + r * ROW, y2: Y + r * ROW, stroke: line, strokeWidth: 1 }));
    for (var b = 0; b < total; b++) {
      var p = at0(b);
      els.push(h('text', { key: 'c' + b, x: p.x, y: p.y + 36, textAnchor: 'middle', fontSize: 13, fontWeight: 600,
        fontFamily: "'JetBrains Mono', monospace", fill: 'var(--paper-ink3)' }, String((b % 4) + 1)));
      if (b % 4 === 0 && b % PER !== 0) els.push(h('line', { key: 'bar' + b, x1: p.x - 16, x2: p.x - 16, y1: p.y - 26, y2: p.y + 14, stroke: line, strokeWidth: 1.3 }));
    }
    pat.forEach(function (d, i) {
      var p = at0(at), x = p.x, y = p.y, oi = -1;
      ons.forEach(function (on, j) { if (on.i === i) oi = j; });
      var res = oi > -1 ? results[oi] : null;
      var col = res === 'hit' ? 'var(--good)' : res === 'miss' ? 'var(--bad)' : ink;
      if (d < 0) {
        /* a quarter rest stands on the line; half and whole rests are the
           little blocks that sit on it and hang from it */
        if (-d >= 2) els.push(h('rect', { key: 'r' + i, x: x - 7, y: -d >= 4 ? y : y - 6, width: 14, height: 6, fill: 'var(--paper-ink3)' }));
        else els.push(glyph(h, 'r' + i, GLYPH.q, x, y - 15, y + 15, 'var(--paper-ink3)', true));
      } else {
        els.push(noteHead(h, 'n' + i, x, y, d >= 2, col, 1.2));
        if (d < 4) els.push(h('line', { key: 's' + i, x1: x + 6.8, x2: x + 6.8, y1: y - 1, y2: y - 36, stroke: col, strokeWidth: 1.7 }));
        /* a held note: a bar showing how long it lasts */
        if (d > 1) els.push(h('rect', { key: 'hold' + i, x: x + 11, y: y - 2.5, width: d * BW - 26, height: 5, rx: 2.5, fill: col, opacity: 0.2 }));
      }
      at += Math.abs(d);
    });
    if (o.cursor != null && o.cursor > -0.5 && o.cursor < total + 0.5) {
      var c = at0(Math.max(0, o.cursor));
      els.push(h('line', { key: 'cur', x1: c.x, x2: c.x, y1: c.y - 40, y2: c.y + 20, stroke: 'var(--accent)', strokeWidth: 3, strokeLinecap: 'round', 'data-cursor': 1 }));
    }
    return h('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', 'data-learn-rhythm': 1,
      style: { display: 'block', maxWidth: Math.round(W * 1.2) + 'px', height: 'auto', margin: '0 auto' } }, els);
  }

  /* Two hands seen from above, palms down on the keys: the right thumb on
     the left of its hand, the left thumb on the right. */
  function hands(h) {
    var els = [];
    /* finger boxes for a right hand whose palm spans x 0–80 */
    var F = [{ n: 2, x: 6, top: 14 }, { n: 3, x: 25, top: 2 }, { n: 4, x: 44, top: 9 }, { n: 5, x: 63, top: 27 }];
    function hand(ox, mirror, label) {
      var X = function (x, w) { return mirror ? ox + 80 - x - (w || 0) : ox + x; };
      var g = [];
      F.forEach(function (f) {
        g.push(h('rect', { key: 'f' + f.n, x: X(f.x, 16), y: f.top, width: 16, height: 96 - f.top, rx: 8, fill: 'var(--hand)', stroke: 'var(--hand-line)', strokeWidth: 1.2 }));
      });
      /* the thumb grows out of the palm's lower corner and leans outward;
         its root is drawn over by the palm */
      var bx = X(15, 0), by = 126, ang = mirror ? 44 : -44, rad = ang * Math.PI / 180;
      g.push(h('rect', { key: 'th', x: bx - 10, y: by - 60, width: 20, height: 66, rx: 10, fill: 'var(--hand)', stroke: 'var(--hand-line)', strokeWidth: 1.2,
        transform: 'rotate(' + ang + ' ' + bx + ' ' + by + ')' }));
      g.push(h('rect', { key: 'palm', x: ox, y: 78, width: 80, height: 64, rx: 24, fill: 'var(--hand)', stroke: 'var(--hand-line)', strokeWidth: 1.2 }));
      /* cover the seams where the fingers meet the palm */
      g.push(h('rect', { key: 'seam', x: ox + 9, y: 79, width: 62, height: 14, fill: 'var(--hand)' }));
      var nums = F.map(function (f) { return { n: f.n, cx: X(f.x, 16) + 8, cy: f.top + 13 }; });
      nums.push({ n: 1, cx: bx + Math.sin(rad) * 48, cy: by - Math.cos(rad) * 48 });
      nums.forEach(function (p) {
        g.push(h('circle', { key: 'c' + p.n, cx: p.cx, cy: p.cy, r: 9.5, fill: 'var(--surface)', stroke: 'var(--accent)', strokeWidth: 1.6 }));
        g.push(h('text', { key: 'n' + p.n, x: p.cx, y: p.cy + 4.5, textAnchor: 'middle', fontSize: 13, fontWeight: 700, fill: 'var(--accent)' }, String(p.n)));
      });
      g.push(h('text', { key: 'lab', x: ox + 40, y: 162, textAnchor: 'middle', fontSize: 13, fontWeight: 600, fill: 'var(--ink2)' }, label));
      return h('g', { key: label }, g);
    }
    els.push(hand(40, true, t('Left hand')));
    els.push(hand(210, false, t('Right hand')));
    return h('svg', { viewBox: '0 0 330 172', width: 330, 'data-learn-hands': 1,
      style: { display: 'block', maxWidth: '100%', height: 'auto', margin: '0 auto', fontFamily: "Figtree, 'Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC', system-ui, sans-serif" } }, els);
  }

  /* Every string the course shows, for the translation check. */
  function strings() {
    var out = {};
    var add = function (s) { if (s && typeof s === 'string' && !/^[\d\s]+$/.test(s) && !/^[A-G]$/.test(s)) out[s] = true; };
    COURSE.forEach(function (u) {
      add(u.title);
      u.lessons.forEach(function (l) {
        add(l.title); add(l.goal);
        l.steps.forEach(function (s) {
          add(s.title); (s.text || []).forEach(add); add(s.miss);
          (s.qs || []).forEach(function (q) { add(q.q); add(q.why); q.choices.forEach(add); });
        });
      });
    });
    SOL.forEach(add);
    return Object.keys(out);
  }

  var api = global.PPP_LESSONS = {
    /* set by the page: draw again once the music font has loaded */
    onFonts: null,
    COURSE: COURSE, LESSONS: LESSONS, SONGS: SONGS, SOL: SOL,
    lesson: lesson, next: next, nextUp: nextUp, keysFor: keysFor, kbBase: kbBase, codeToMidi: codeToMidi,
    fresh: fresh, press: press, answer: answer, nextDrill: nextDrill, choose: choose, nextQuestion: nextQuestion, targets: targets,
    onsets: onsets, length: length, tolerance: tolerance, tap: tap, verdict: verdict,
    sol: sol, letter: letter, solFlat: solFlat, letterFlat: letterFlat, pc: pc, isBlack: isBlack, diat: diat,
    keyboard: keyboard, staff: staff, rhythm: rhythm, hands: hands, strings: strings
  };
})(typeof window !== 'undefined' ? window : globalThis);
