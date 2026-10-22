// Măsura — date locale (localStorage), export/import
const KEY = 'masura.data.v1';

export const SECTION_TYPES = [
  { name: 'INTRO', color: '#6c8cff' },
  { name: 'STROFA', color: '#3fbf7f' },
  { name: 'PRE-REFREN', color: '#a6c13a' },
  { name: 'REFREN', color: '#ffb020' },
  { name: 'BRIDGE', color: '#b07cff' },
  { name: 'SOLO', color: '#ff6fa8' },
  { name: 'INTERLUDIU', color: '#4fb3ff' },
  { name: 'BREAK', color: '#9aa0a6' },
  { name: 'OUTRO', color: '#8e97ad' },
  { name: 'JOC PUBLIC', color: '#2fd4c4', open: true },
];
const CUSTOM_COLOR = '#d0b48a';

// Paleta pentru culoarea aleasă manual pe o secțiune (vizibilă pe scenă, pe fundal închis).
export const PALETTE = [
  ['#6c8cff', 'Albastru'], ['#4fb3ff', 'Azur'], ['#2fd4c4', 'Turcoaz'], ['#3fbf7f', 'Verde'],
  ['#a6c13a', 'Lime'], ['#ffd23f', 'Galben'], ['#ffb020', 'Portocaliu'], ['#ff6b4a', 'Cărămiziu'],
  ['#ff4d6d', 'Roșu'], ['#ff6fa8', 'Roz'], ['#b07cff', 'Mov'], ['#d0b48a', 'Nisip'],
  ['#ffffff', 'Alb'], ['#9aa0a6', 'Gri'],
];
export const isColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

export function baseName(name) {
  return String(name || '').toUpperCase().replace(/\s*\d+\s*$/, '').trim();
}
// Culoarea unei secțiuni: cea aleasă manual (sec.color), altfel după tipul din nume.
// Acceptă și un simplu nume (string), pentru compatibilitate.
export function colorFor(sec) {
  if (sec && typeof sec === 'object') {
    if (isColor(sec.color)) return sec.color;
    sec = sec.name;
  }
  const b = baseName(sec);
  const t = SECTION_TYPES.find(t => t.name === b);
  return t ? t.color : CUSTOM_COLOR;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const DEFAULT_SETTINGS = {
  vol: { master: 0.85, accent: 0.9, beat: 0.6, sub: 0, ch: 'both' }, // ch: 'both' | 'left' | 'right'
  flash: 0.7,
  share: { enabled: false, code: '' }, // monitor pentru colegi
};

export function newSong(partial = {}) {
  return {
    id: uid(),
    title: 'Piesă nouă',
    bpm: 120,
    num: 4,
    den: 4,
    key: '', // gama piesei, text liber (ex. „Em”, „La minor”, „capo 2”)
    countPrep: 2,
    countSticks: 4,
    notes: '',
    sections: [
      { id: uid(), name: 'INTRO', bars: 4, open: false, note: '' },
      { id: uid(), name: 'STROFA', bars: 8, open: false, note: '' },
      { id: uid(), name: 'REFREN', bars: 8, open: false, note: '' },
      { id: uid(), name: 'OUTRO', bars: 4, open: false, note: '' },
    ],
    updatedAt: Date.now(),
    ...partial,
  };
}

export function newSetlist(partial = {}) {
  return { id: uid(), name: 'Concert nou', date: '', songIds: [], updatedAt: Date.now(), ...partial };
}

export function songStats(song) {
  const fixedBars = song.sections.filter(s => !s.open).reduce((a, s) => a + (s.bars || 0), 0);
  const openCount = song.sections.filter(s => s.open).length;
  const beats = fixedBars * song.num;
  const secs = beats * 60 / (song.bpm || 120);
  return { fixedBars, openCount, beats, secs };
}

export function fmtDuration(secs) {
  secs = Math.round(secs);
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function seed() {
  const demo = newSong({
    title: 'Exemplu — piesă demo',
    bpm: 112,
    notes: 'Piesă de test. O poți edita sau șterge.',
    sections: [
      { id: uid(), name: 'INTRO', bars: 4, open: false, note: 'doar hi-hat' },
      { id: uid(), name: 'STROFA 1', bars: 8, open: false, note: '' },
      { id: uid(), name: 'REFREN', bars: 8, open: false, note: 'crash pe 1' },
      { id: uid(), name: 'JOC PUBLIC', bars: 4, open: true, note: 'vocalul cântă cu publicul' },
      { id: uid(), name: 'REFREN', bars: 8, open: false, note: '' },
      { id: uid(), name: 'OUTRO', bars: 2, open: false, note: 'stop pe 1' },
    ],
  });
  return {
    version: 1,
    songs: [demo],
    setlists: [newSetlist({ name: 'Concert demo', songIds: [demo.id] })],
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}

function normalizeSong(s) {
  const d = newSong();
  const out = { ...d, ...s };
  out.bpm = clamp(Number(out.bpm) || 120, 20, 400);
  out.num = clamp(parseInt(out.num) || 4, 1, 16);
  out.den = [2, 4, 8, 16].includes(Number(out.den)) ? Number(out.den) : 4;
  out.key = String(out.key ?? '').slice(0, 40);
  out.countPrep = clamp(parseInt(out.countPrep) || 0, 0, 16);
  out.countSticks = clamp(parseInt(out.countSticks ?? 4) || 0, 0, 16);
  out.sections = (Array.isArray(s.sections) ? s.sections : []).map(x => ({
    id: x.id || uid(), name: String(x.name ?? ''), bars: clamp(parseInt(x.bars) || 1, 1, 999),
    open: !!x.open, note: String(x.note ?? ''),
    ...(isColor(x.color) ? { color: x.color.toLowerCase() } : {}),
  }));
  return out;
}

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export class Store {
  constructor() {
    this.data = this._load();
  }
  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { const s = seed(); this._write(s); return s; }
      const d = JSON.parse(raw);
      d.songs = (d.songs || []).map(normalizeSong);
      d.setlists = d.setlists || [];
      d.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(d.settings || {}) };
      d.settings.vol = { ...DEFAULT_SETTINGS.vol, ...(d.settings.vol || {}) };
      d.settings.share = { ...DEFAULT_SETTINGS.share, ...(d.settings.share || {}) };
      delete d.settings.keysA; delete d.settings.keysB; // pedala a fost scoasă (v1.12)
      return d;
    } catch (e) {
      console.error(e);
      return seed();
    }
  }
  _write(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); return true; }
    catch (e) { console.error(e); return false; }
  }
  save() { return this._write(this.data); }

  song(id) { return this.data.songs.find(s => s.id === id); }
  setlist(id) { return this.data.setlists.find(s => s.id === id); }

  upsertSong(song) {
    song.updatedAt = Date.now();
    const i = this.data.songs.findIndex(s => s.id === song.id);
    if (i >= 0) this.data.songs[i] = song; else this.data.songs.push(song);
    this.save();
  }
  deleteSong(id) {
    this.data.songs = this.data.songs.filter(s => s.id !== id);
    this.data.setlists.forEach(sl => { sl.songIds = sl.songIds.filter(x => x !== id); });
    this.save();
  }
  upsertSetlist(sl) {
    sl.updatedAt = Date.now();
    const i = this.data.setlists.findIndex(s => s.id === sl.id);
    if (i >= 0) this.data.setlists[i] = sl; else this.data.setlists.push(sl);
    this.save();
  }
  deleteSetlist(id) {
    this.data.setlists = this.data.setlists.filter(s => s.id !== id);
    this.save();
  }

  exportJSON() {
    return JSON.stringify({
      app: 'masura', version: 1, exportedAt: new Date().toISOString(),
      songs: this.data.songs, setlists: this.data.setlists, settings: this.data.settings,
    }, null, 2);
  }

  // mode: 'merge' (după id, câștigă versiunea mai nouă) sau 'replace'
  importJSON(text, mode = 'merge') {
    const d = JSON.parse(text);
    if (!d || !Array.isArray(d.songs) || !Array.isArray(d.setlists)) throw new Error('Fișierul nu este un export Măsura valid.');
    const songs = d.songs.map(normalizeSong);
    const setlists = d.setlists.map(s => ({ ...newSetlist(), ...s, songIds: Array.isArray(s.songIds) ? s.songIds : [] }));
    if (mode === 'replace') {
      this.data.songs = songs;
      this.data.setlists = setlists;
      if (d.settings) {
        // modificăm obiectul existent (e partajat cu motorul audio)
        const cur = this.data.settings;
        const { vol, keysA, keysB, ...rest } = d.settings; // keysA/keysB: setări vechi de pedală, ignorate
        Object.assign(cur, rest);
        if (vol) Object.assign(cur.vol, vol);
      }
    } else {
      const merge = (arr, incoming) => {
        let added = 0, updated = 0;
        for (const x of incoming) {
          const i = arr.findIndex(y => y.id === x.id);
          if (i < 0) { arr.push(x); added++; }
          else if ((x.updatedAt || 0) > (arr[i].updatedAt || 0)) { arr[i] = x; updated++; }
        }
        return { added, updated };
      };
      const a = merge(this.data.songs, songs);
      const b = merge(this.data.setlists, setlists);
      this.save();
      return { songs: a, setlists: b };
    }
    this.save();
    return { songs: { added: songs.length, updated: 0 }, setlists: { added: setlists.length, updated: 0 } };
  }
}
