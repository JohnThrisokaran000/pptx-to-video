import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openPptx } from '../../src/pptx.js';
import { extractSlide } from '../../src/slide.js';

// Looks for the special words / patterns from data/special-words.json in everything a deck says.

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export function loadSpecialWords() {
  return JSON.parse(readFileSync(path.join(DATA_DIR, 'special-words.json'), 'utf8')).words;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EDGE_L = '(?<![\\p{L}\\p{N}_])';
const EDGE_R = '(?![\\p{L}\\p{N}_])';

export function compile(words) {
  return words.map((w) => {
    const body = w.mode === 'regex' ? w.pattern : EDGE_L + esc(w.term).replace(/\s+/g, '\\s+') + EDGE_R;
    return { ...w, re: new RegExp(body, 'giu') };
  });
}

export const paraText = (p) => p.runs.map((r) => (r.br ? '\n' : r.text ?? '')).join('');

/** Matches of every rule in one piece of text: [{ term, category, severity, why, fix, snippet }]. */
export function scanText(text, rules) {
  const out = [];
  if (!text) return out;
  for (const r of rules) {
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) {
      const a = Math.max(0, m.index - 24), b = Math.min(text.length, m.index + m[0].length + 24);
      out.push({
        term: r.term, category: r.category, severity: r.severity, why: r.why, fix: r.fix,
        match: m[0], snippet: `${a > 0 ? '…' : ''}${text.slice(a, b).replace(/\s+/g, ' ')}${b < text.length ? '…' : ''}`,
      });
    }
  }
  return out;
}

/** Every piece of text on a slide model: [{ where, eid, text }]. */
export function textsOf(model) {
  const items = [];
  for (const e of model.elements) {
    if (e.decor) continue;
    if (e.text) for (const p of e.text.paras) items.push({ where: e.ph === 'title' || e.ph === 'ctrTitle' ? 'title' : 'text', eid: e.id, text: paraText(p) });
    if (e.type === 'table') for (const r of e.rows) for (const c of r.cells) for (const p of c.paras ?? []) items.push({ where: 'table', eid: e.id, text: paraText(p) });
  }
  if (model.notes) items.push({ where: 'notes', eid: null, text: model.notes });
  return items;
}

/** Scans a whole .pptx. Returns { file, slides, findings } with findings sorted by slide then severity. */
export async function checkDeck(file, words = loadSpecialWords()) {
  const rules = compile(words);
  const deck = await openPptx(file);
  const findings = [];
  for (let i = 0; i < deck.slideCount; i++) {
    const model = await extractSlide(deck, i, { width: 1280 });
    for (const t of textsOf(model)) for (const f of scanText(t.text, rules)) findings.push({ slide: i + 1, where: t.where, eid: t.eid, ...f });
  }
  const rank = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => a.slide - b.slide || rank[a.severity] - rank[b.severity]);
  return { file, slides: deck.slideCount, findings };
}
