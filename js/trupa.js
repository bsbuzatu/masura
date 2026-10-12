// Măsura → Trupa: sincronizare într-un singur sens.
// Măsura e sursa de adevăr pentru titlu, BPM, măsură, gamă și structură (cu nr. de măsuri).
// Atinge DOAR colecția „songs” din Firestore și DOAR câmpurile de mai jos (OWNED).
// Nu citește, nu scrie și nu șterge niciodată „events” sau „availability” (calendarele Trupei).
// Nu șterge niciodată nimic în Trupa.

const CFG = {
  apiKey: 'AIzaSyC7KKu23mrmx0Hy31BE-QRTQUbCC2G6eP4',
  authDomain: 'band-repo.firebaseapp.com',
  projectId: 'band-repo',
  storageBucket: 'band-repo.firebasestorage.app',
  messagingSenderId: '843962154786',
  appId: '1:843962154786:web:0a77086e7f33c47387ef7b',
};
const SDK = 'https://www.gstatic.com/firebasejs/12.15.0/';
const COLL = 'songs'; // singura colecție folosită

// numele secțiunilor din Măsura → cum le scrie Trupa
const PART_MAP = {
  'INTRO': 'Intro', 'STROFA': 'Strofă', 'PRE-REFREN': 'Pre-refren', 'REFREN': 'Refren',
  'BRIDGE': 'Bridge', 'SOLO': 'Solo', 'INTERLUDIU': 'Instrumental', 'BREAK': 'Break',
  'OUTRO': 'Outro', 'JOC PUBLIC': 'Joc cu publicul',
};

export const DEFAULT_TRUPA = { enabled: false, links: {}, skip: [], synced: {}, lastSync: 0, lastError: '' };

export function partLabel(name) {
  const raw = String(name || '').trim();
  const base = raw.toUpperCase().replace(/\s*\d+\s*$/, '').trim();
  if (PART_MAP[base]) return PART_MAP[base];
  const s = raw.replace(/\s*\d+\s*$/, '').trim() || raw;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ce scrie Măsura într-o piesă din Trupa (nimic altceva)
export function payload(song) {
  const secs = song.sections || [];
  const bpm = Math.round(Number(song.bpm));
  return {
    title: String(song.title || '').trim() || 'Fără titlu',
    bpm: Number.isFinite(bpm) && bpm >= 30 && bpm <= 300 ? bpm : null,
    structure: secs.map(s => partLabel(s.name)),
    structureBars: secs.map(s => (s.open ? null : Math.max(0, Math.round(s.bars || 0)))),
    timeSig: `${song.num || 4}/${song.den || 4}`,
    key: String(song.key || '').trim(),
    masuraId: song.id,
    masuraUpdatedAt: song.updatedAt || 0,
    masuraSyncedAt: Date.now(),
  };
}

// potrivire de titluri: fără diacritice, litere mici, fără punctuație
export function norm(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
export function similarity(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.85;
  const ta = new Set(A.split(' ')), tb = new Set(B.split(' '));
  let common = 0; ta.forEach(w => { if (tb.has(w)) common++; });
  return common / Math.max(ta.size, tb.size);
}

// ---------- Firebase (încărcat doar la nevoie, ca Măsura să rămână 100% offline) ----------
let fb = null;
async function connect() {
  if (fb) return fb;
  if (navigator.onLine === false) throw new Error('Fără internet');
  const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(msg)), ms))]);
  const [A, U, F] = await withTimeout(Promise.all([
    import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js'),
  ]), 20000, 'Nu pot încărca Firebase (internet slab?)');
  const app = A.getApps().find(a => a.name === 'masura-trupa') || A.initializeApp(CFG, 'masura-trupa');
  const auth = U.getAuth(app);
  if (!auth.currentUser) await withTimeout(U.signInAnonymously(auth), 15000, 'Autentificarea la Trupa a expirat');
  fb = { F, db: F.getFirestore(app) };
  return fb;
}

export async function fetchTrupaSongs() {
  const { F, db } = await connect();
  const snap = await F.getDocs(F.collection(db, COLL));
  return snap.docs.map(d => {
    const x = d.data();
    return { id: d.id, title: x.title || '', artist: x.artist || '', archived: !!x.archived, masuraId: x.masuraId || '' };
  });
}

async function update(id, data) {
  const { F, db } = await connect();
  await F.updateDoc(F.doc(db, COLL, id), data); // updateDoc: păstrează toate celelalte câmpuri
}
// piesa din Trupa nu mai e legată de Măsura (doar scoatem marcajul nostru)
async function unmark(id) {
  const { F, db } = await connect();
  try { await F.updateDoc(F.doc(db, COLL, id), { masuraId: F.deleteField() }); } catch (e) { /* nu contează */ }
}
async function create(data) {
  const { F, db } = await connect();
  const ref = await F.addDoc(F.collection(db, COLL), {
    artist: '', link: '', lyrics: '', archived: false, addedBy: 'Măsura', createdAt: Date.now(), ...data,
  });
  return ref.id;
}

/**
 * Sincronizează.
 *  T = setările Trupa (links/skip/synced), modificate pe loc
 *  songs = piesele din Măsura
 *  opts.force = trimite tot, chiar dacă nu s-a schimbat
 *  opts.auto  = mod automat: piesele noi fără potrivire sigură rămân „de confirmat”
 * Întoarce { updated, created, linked, pending:[songId], errors:[msg] }
 */
export async function sync(T, songs, opts = {}) {
  const res = { updated: 0, created: 0, linked: 0, pending: [], errors: [] };
  const remote = await fetchTrupaSongs();
  const byId = new Map(remote.map(r => [r.id, r]));
  const ids = new Set(songs.map(s => s.id));

  // curăță legăturile spre piese șterse din Măsura (în Trupa nu ștergem nimic)
  for (const mid of Object.keys(T.links)) if (!ids.has(mid)) { delete T.links[mid]; delete T.synced[mid]; }
  // legătură pierdută (doc șters în Trupa)
  for (const [mid, tid] of Object.entries(T.links)) if (!byId.has(tid)) { delete T.links[mid]; delete T.synced[mid]; }
  // refă legăturile din Trupa (ex. după reinstalarea Măsurii)
  for (const r of remote) if (r.masuraId && ids.has(r.masuraId) && !T.links[r.masuraId] && !T.skip.includes(r.masuraId) && !Object.values(T.links).includes(r.id)) {
    T.links[r.masuraId] = r.id; res.linked++;
  }
  const taken = () => new Set(Object.values(T.links));

  for (const s of songs) {
    if (T.skip.includes(s.id)) continue;
    let tid = T.links[s.id];
    if (!tid) {
      if (!opts.auto) continue; // în modul manual, alegerea vine din ecranul de legare
      const free = remote.filter(r => !taken().has(r.id) && !(r.masuraId && ids.has(r.masuraId)));
      const exact = free.find(r => norm(r.title) === norm(s.title));
      if (exact) { T.links[s.id] = tid = exact.id; res.linked++; }
      else if (free.some(r => similarity(r.title, s.title) >= 0.5)) { res.pending.push(s.id); continue; }
      else {
        try { tid = await create(payload(s)); T.links[s.id] = tid; T.synced[s.id] = s.updatedAt; res.created++; }
        catch (e) { res.errors.push(`${s.title}: ${e.code || e.message}`); }
        continue;
      }
    }
    if (!opts.force && T.synced[s.id] === s.updatedAt) continue;
    try { await update(tid, payload(s)); T.synced[s.id] = s.updatedAt; res.updated++; }
    catch (e) { res.errors.push(`${s.title}: ${e.code || e.message}`); }
  }
  return res;
}

// aplică alegerile din ecranul de legare: choice[songId] = 'new' | 'skip' | <trupaDocId>
export async function applyChoices(T, songs, choice) {
  const res = { updated: 0, created: 0, linked: 0, pending: [], errors: [] };
  for (const s of songs) {
    const c = choice[s.id];
    if (!c) continue;
    const prev = T.links[s.id];
    if (prev && prev !== c) await unmark(prev);
    // dacă altă piesă din Măsura era legată de aceeași piesă din Trupa, o dezlegăm
    if (c !== 'new' && c !== 'skip') for (const [mid, tid] of Object.entries(T.links)) if (tid === c && mid !== s.id) { delete T.links[mid]; delete T.synced[mid]; }
    if (c === 'skip') {
      if (!T.skip.includes(s.id)) T.skip.push(s.id);
      delete T.links[s.id]; delete T.synced[s.id];
      continue;
    }
    T.skip = T.skip.filter(x => x !== s.id);
    if (c === 'new') {
      if (prev && prev !== c) delete T.links[s.id];
      if (T.links[s.id]) { // deja creată: doar actualizăm
        try { await update(T.links[s.id], payload(s)); T.synced[s.id] = s.updatedAt; res.updated++; }
        catch (e) { res.errors.push(`${s.title}: ${e.code || e.message}`); }
        continue;
      }
      try { T.links[s.id] = await create(payload(s)); T.synced[s.id] = s.updatedAt; res.created++; }
      catch (e) { res.errors.push(`${s.title}: ${e.code || e.message}`); }
    } else {
      T.links[s.id] = c;
      try { await update(c, payload(s)); T.synced[s.id] = s.updatedAt; res.updated++; }
      catch (e) { res.errors.push(`${s.title}: ${e.code || e.message}`); }
    }
  }
  return res;
}
