import path from 'node:path';
import { openPptx } from '../../src/pptx.js';
import { extractSlide } from '../../src/slide.js';
import { roleOf as legacyRoleOf } from '../../src/animate.js';
import { countWords } from '../../src/html.js';
import { compile, scanText, textsOf, paraText, loadSpecialWords } from './check.js';
import { quoroRoleOf } from './model.js';
import { transaction } from './db.js';

const textOfEl = (e) => {
  if (e.text) return e.text.paras.map(paraText).join('\n');
  if (e.type === 'table') return e.rows.map((r) => r.cells.map((c) => (c.paras ?? []).map(paraText).join(' ')).join(' | ')).join('\n');
  return '';
};

/**
 * Reads a deck into the database: slides, every element with the role Quoro gives it (and the role the built-in
 * rule-based planner would give it, for comparison) and the special-word findings. Re-ingesting a deck replaces it.
 */
export async function ingestDeck(db, file, model, words = loadSpecialWords()) {
  const abs = path.resolve(file);
  const deck = await openPptx(abs);
  const rules = compile(words);
  const roleFn = quoroRoleOf(model);
  const slides = [];
  for (let i = 0; i < deck.slideCount; i++) slides.push(await extractSlide(deck, i, { width: 1280 }));

  return transaction(db, () => {
    const old = db.prepare('SELECT id FROM decks WHERE path = ?').get(abs);
    if (old) for (const t of ['findings', 'elements', 'slides']) db.prepare(`DELETE FROM ${t} WHERE deck_id = ?`).run(old.id);
    if (old) db.prepare('DELETE FROM decks WHERE id = ?').run(old.id);
    const deckId = Number(db.prepare('INSERT INTO decks (path, name, slides, ingested_at) VALUES (?,?,?,?)').run(abs, path.basename(abs), deck.slideCount, new Date().toISOString()).lastInsertRowid);
    const insSlide = db.prepare('INSERT INTO slides (deck_id, idx, title, notes) VALUES (?,?,?,?)');
    const insEl = db.prepare('INSERT INTO elements (deck_id, slide_idx, eid, type, role, legacy_role, text, words, area) VALUES (?,?,?,?,?,?,?,?,?)');
    const insFind = db.prepare('INSERT INTO findings (deck_id, slide_idx, where_, term, category, severity, snippet) VALUES (?,?,?,?,?,?,?)');
    let nEl = 0, nFind = 0;
    slides.forEach((m, i) => {
      const els = m.elements.filter((e) => !e.decor);
      const titleEl = els.find((e) => e.text && (e.ph === 'title' || e.ph === 'ctrTitle'));
      insSlide.run(deckId, i + 1, titleEl ? textOfEl(titleEl).replace(/\s+/g, ' ').trim() : '', m.notes ?? '');
      for (const e of els) {
        insEl.run(deckId, i + 1, String(e.id), e.type, roleFn(e, m), legacyRoleOf(e, m), textOfEl(e), e.text ? countWords(e.text.paras) : 0, (e.w * e.h) / (m.width * m.height));
        nEl++;
      }
      for (const t of textsOf(m)) for (const f of scanText(t.text, rules)) {
        insFind.run(deckId, i + 1, t.where, f.term, f.category, f.severity, f.snippet);
        nFind++;
      }
    });
    return { deckId, name: path.basename(abs), slides: deck.slideCount, elements: nEl, findings: nFind };
  });
}
