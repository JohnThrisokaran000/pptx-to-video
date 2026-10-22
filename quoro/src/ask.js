// Question answering over Quoro's database by plain TF-IDF retrieval. Answers are quoted from the stored datasets
// and decks only; when nothing matches well enough Quoro says it does not know instead of guessing.

const STOP = new Set('a an the is are was were be to of in on at for with and or what which how do does can i you it this that my me use used using should when where why who whats about tell me give show'.split(' '));

export function tokens(s) {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith('ies') ? `${t.slice(0, -3)}y` : t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

function loadDocs(db) {
  const docs = [];
  for (const r of db.prepare('SELECT * FROM element_kinds').all()) {
    docs.push({
      kind: 'element', ref: r.id, strong: `${r.name}, ${r.keywords}`,
      text: `${r.name} ${r.keywords} ${r.category} ${r.description} ${r.when_to_use}`,
      answer: `${r.name} (${r.category})${r.role ? `, role "${r.role}"` : ''}. ${r.description} When to use: ${r.when_to_use}${r.animation ? ` Entrance animation: ${r.animation}.` : ' No entrance animation (not rendered by the exporter).'}`,
    });
  }
  for (const r of db.prepare('SELECT * FROM roles').all()) {
    docs.push({ kind: 'role', ref: r.role, strong: r.role, text: `${r.role} role ${r.description}`, answer: `Role "${r.role}": ${r.description} Default entrance animation: ${r.animation}.` });
  }
  for (const r of db.prepare('SELECT * FROM special_words').all()) {
    docs.push({
      kind: 'word', ref: r.term, strong: r.term,
      text: `${r.term} ${r.category} ${r.severity} ${r.why} ${r.fix}`,
      answer: `"${r.term}" is flagged as ${r.category} (${r.severity}). ${r.why} Fix: ${r.fix}`,
    });
  }
  for (const r of db.prepare('SELECT d.name AS deck, s.idx, s.title, s.notes FROM slides s JOIN decks d ON d.id = s.deck_id').all()) {
    const els = db.prepare('SELECT text FROM elements e JOIN decks d ON d.id = e.deck_id WHERE d.name = ? AND e.slide_idx = ? AND e.text != \'\'').all(r.deck, r.idx).map((x) => x.text).join(' / ');
    docs.push({ kind: 'slide', ref: `${r.deck} #${r.idx}`, strong: r.title, text: `${r.title} ${els} ${r.notes}`, answer: `${r.deck}, slide ${r.idx}${r.title ? ` "${r.title}"` : ''}: ${els.replace(/\s+/g, ' ').slice(0, 400)}${r.notes ? ` Notes: ${r.notes.slice(0, 200)}` : ''}` });
  }
  return docs;
}

/** Questions about the ingested decks that have an exact answer in the database. */
function deckIntent(db, question) {
  const q = (question ?? '').toLowerCase();
  const decks = db.prepare('SELECT id, name, slides FROM decks').all();
  const named = decks.filter((d) => q.includes(d.name.toLowerCase().replace(/\.pptx$/, '').replace(/\s*\(\d+\)$/, '')));
  const pool = named.length ? named : decks.length === 1 ? decks : [];
  const src = (d, extra = '') => ({ kind: 'deck', ref: d.name + extra, score: 1 });
  const count = /how many (slides|elements|decks)/.exec(q);
  if (count) {
    if (count[1] === 'decks') return { known: true, answer: `${decks.length} deck(s) are in the database: ${decks.map((d) => d.name).join(', ') || 'none'}.`, sources: [] };
    if (!pool.length) return null;
    const lines = pool.map((d) => (count[1] === 'slides' ? `${d.name} has ${d.slides} slide(s).` : `${d.name} has ${db.prepare('SELECT count(*) n FROM elements WHERE deck_id = ?').get(d.id).n} element(s).`));
    return { known: true, answer: lines.join(' '), sources: pool.map((d) => src(d)) };
  }
  const sl = /slide\s*#?\s*(\d+)/.exec(q);
  if (sl && pool.length === 1) {
    const d = pool[0], idx = Number(sl[1]);
    const row = db.prepare('SELECT title, notes FROM slides WHERE deck_id = ? AND idx = ?').get(d.id, idx);
    if (!row) return { known: true, answer: `${d.name} has no slide ${idx} (it has ${d.slides}).`, sources: [src(d)] };
    if (/title|called|named/.test(q)) return { known: true, answer: row.title ? `Slide ${idx} of ${d.name} is titled "${row.title}".` : `Slide ${idx} of ${d.name} has no title placeholder.`, sources: [src(d, ` #${idx}`)] };
    const els = db.prepare("SELECT role, text FROM elements WHERE deck_id = ? AND slide_idx = ? AND text != ''").all(d.id, idx);
    return { known: true, answer: `Slide ${idx} of ${d.name}${row.title ? ` "${row.title}"` : ''}: ${els.map((e) => `[${e.role}] ${e.text.replace(/\s+/g, ' ')}`).join(' / ').slice(0, 600)}`, sources: [src(d, ` #${idx}`)] };
  }
  return null;
}

export function ask(db, question, { top = 3, minScore = 0.2 } = {}) {
  const direct = deckIntent(db, question);
  if (direct) return direct;
  const docs = loadDocs(db);
  const df = new Map();
  const vec = docs.map((d) => {
    const tf = new Map();
    for (const t of tokens(d.text)) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return tf;
  });
  const N = docs.length;
  const idf = (t) => Math.log(1 + N / (df.get(t) ?? N));
  const weigh = (tf) => {
    const w = new Map();
    let norm = 0;
    for (const [t, c] of tf) { const x = (1 + Math.log(c)) * idf(t); w.set(t, x); norm += x * x; }
    return { w, norm: Math.sqrt(norm) || 1 };
  };
  const qtf = new Map();
  for (const t of tokens(question)) qtf.set(t, (qtf.get(t) ?? 0) + 1);
  const q = weigh(qtf);
  const lowerQ = ` ${(question ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `;

  const scored = docs.map((d, i) => {
    const dv = weigh(vec[i]);
    let dot = 0;
    for (const [t, x] of q.w) if (dv.w.has(t)) dot += x * dv.w.get(t);
    let score = dot / (q.norm * dv.norm);
    // a name or keyword spelled out in the question is a strong signal; longer phrases beat shorter ones
    let named = 0;
    for (const phrase of d.strong.toLowerCase().split(/[,\n]| {2,}/)) {
      const p = phrase.trim().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ');
      if (p.length > 2 && lowerQ.includes(` ${p} `)) named = Math.max(named, 0.2 + 0.3 * p.split(' ').length);
    }
    score += named;
    // share of the question's content words that this entry actually contains
    const covered = qtf.size ? [...qtf.keys()].filter((t) => vec[i].has(t)).length / qtf.size : 0;
    return { d, score, named: named > 0, covered };
  }).filter((x) => x.score > 0).sort((a, b) => b.named - a.named || b.score - a.score);

  // answer only when the entry is named in the question or covers most of what was asked
  const hits = scored.filter((x) => x.score >= minScore && (x.named || x.covered >= 0.6)).slice(0, top);
  if (!hits.length) return { known: false, answer: "I don't know that. It isn't in my dataset.", sources: [] };
  return { known: true, answer: hits[0].d.answer, sources: hits.map((h) => ({ kind: h.d.kind, ref: h.d.ref, score: Number(h.score.toFixed(3)) })) };
}
