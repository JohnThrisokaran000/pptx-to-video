import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PptxGenJS from 'pptxgenjs';
import { generate, findConflicts, toXY } from '../quoro/src/dataset.js';
import { trainTree, predict, accuracy } from '../quoro/src/tree.js';
import { vectorOf, describe } from '../quoro/src/features.js';
import { compile, scanText, loadSpecialWords, checkDeck } from '../quoro/src/check.js';
import { build } from '../quoro/src/build.js';
import { ask } from '../quoro/src/ask.js';
import { openDb } from '../quoro/src/db.js';
import { quoroRoleOf } from '../quoro/src/model.js';
import { openPptx } from '../src/pptx.js';
import { extractSlide } from '../src/slide.js';
import { roleOf as legacyRoleOf } from '../src/animate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = (f) => JSON.parse(readFileSync(path.join(here, '..', 'quoro', 'data', f), 'utf8'));
const { roles } = data('roles.json');
const { elements } = data('elements.json');
const { words } = data('special-words.json');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'quoro-test-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

// ---------------------------------------------------------------- datasets

test('datasets are consistent', () => {
  const ids = elements.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'element ids are unique');
  for (const e of elements) {
    if (e.role) assert.ok(roles[e.role], `${e.id} uses a known role`);
    assert.ok(e.keywords.length > 0 && e.description && e.whenToUse, `${e.id} is fully described`);
  }
  for (const r of Object.values(roles)) assert.ok(r.specs.length && r.description && r.animation);
  for (const w of words) {
    assert.ok(['error', 'warn', 'info'].includes(w.severity), w.term);
    assert.ok(['word', 'phrase', 'regex'].includes(w.mode), w.term);
    if (w.mode === 'regex') assert.doesNotThrow(() => new RegExp(w.pattern, 'iu'), w.term);
  }
  const terms = words.map((w) => `${w.mode}:${w.term}`);
  assert.equal(new Set(terms).size, terms.length, 'special words are unique');
});

test('every role has an element kind in the knowledge base', () => {
  const covered = new Set(elements.map((e) => e.role).filter(Boolean));
  for (const r of Object.keys(roles)) assert.ok(covered.has(r), `no element kind for role ${r}`);
});

// ---------------------------------------------------------------- role model

test('role specs do not overlap', () => {
  assert.deepEqual(findConflicts(generate(roles, { seed: 1 })), []);
  assert.deepEqual(findConflicts(generate(roles, { seed: 7 })), []);
});

test('the tree fits its training data with zero error and generalises to unseen samples', () => {
  const train = toXY(generate(roles, { seed: 1 }));
  const tree = trainTree(train.X, train.y);
  assert.equal(accuracy(tree, train.X, train.y).wrong.length, 0, 'training error');
  for (const seed of [2, 3, 4]) {
    const t = toXY(generate(roles, { seed, perSpec: 300, edges: false }));
    const a = accuracy(tree, t.X, t.y);
    assert.equal(a.wrong.length, 0, `seed ${seed}: ${a.wrong.length} of ${a.total} wrong`);
  }
});

const D = (o) => ({ type: 'shape', ph: 'none', text: false, visible: false, line: false, area: 0.1, aspect: 1.5, words: 0, ...o });
const FIXTURES = [
  ['title', D({ ph: 'title', text: true, words: 4, area: 0.1, aspect: 8 })],
  ['title', D({ ph: 'title', text: true, visible: true, words: 2 })],
  ['subtitle', D({ ph: 'subTitle', text: true, words: 6 })],
  ['body', D({ ph: 'other', text: true, words: 30, area: 0.35 })],
  ['text', D({ text: true, words: 8, area: 0.02, aspect: 5 })],
  ['label', D({ text: true, visible: true, words: 3, area: 0.04 })],
  ['label', D({ text: true, visible: true, ph: 'other', words: 3, area: 0.6 })],
  ['backdropLabel', D({ text: true, visible: true, words: 3, area: 0.61 })],
  ['shape', D({ area: 0.02, aspect: 1 })],
  ['shape', D({ area: 0.6, aspect: 8 })],
  ['rule', D({ line: true, area: 0.001, aspect: 40 })],
  ['rule', D({ line: true, text: true, area: 0.9, aspect: 0.9 })],
  ['rule', D({ area: 0.003, aspect: 9 })],
  ['rule', D({ area: 0.003, aspect: 0.1 })],
  ['backdrop', D({ area: 0.99, aspect: 1.78 })],
  ['backdrop', D({ type: 'pic', area: 0.86, aspect: 1.78 })],
  ['picture', D({ type: 'pic', area: 0.85, aspect: 1.78 })],
  ['picture', D({ type: 'pic', area: 0.01, aspect: 1 })],
  ['table', D({ type: 'table', area: 0.3, aspect: 2 })],
  ['chart', D({ type: 'chart', area: 0.3, aspect: 1.6 })],
  ['footer', D({ ph: 'footer', text: true, words: 1, area: 0.002, aspect: 6 })],
];

test('hand-written fixtures get the expected role', () => {
  const train = toXY(generate(roles, { seed: 1 }));
  const tree = trainTree(train.X, train.y);
  for (const [want, d] of FIXTURES) assert.equal(predict(tree, vectorOf(d)), want, JSON.stringify(d));
});

test('the shipped model.json agrees with a fresh training run', () => {
  const model = JSON.parse(readFileSync(path.join(here, '..', 'quoro', 'model.json'), 'utf8'));
  for (const [want, d] of FIXTURES) assert.equal(predict(model.tree, vectorOf(d)), want, JSON.stringify(d));
  assert.equal(model.stats.trainAccuracy, 1);
});

test('on the sample deck Quoro and the rule-based planner agree on every element', async () => {
  const sample = path.join(here, 'sample.pptx');
  if (!existsSync(sample)) return;
  const roleFn = quoroRoleOf();
  const deck = await openPptx(sample);
  let n = 0;
  for (let i = 0; i < deck.slideCount; i++) {
    const m = await extractSlide(deck, i, { width: 1280 });
    for (const e of m.elements.filter((x) => !x.decor)) {
      assert.equal(roleFn(e, m), legacyRoleOf(e, m), `slide ${i + 1} element ${e.id}`);
      assert.deepEqual(describe(e, m).type, e.type);
      n++;
    }
  }
  assert.ok(n > 10);
});

// ---------------------------------------------------------------- special words

const rules = compile(loadSpecialWords());
const hit = (text) => scanText(text, rules).map((f) => f.term);

test('special words: placeholders, unfinished markers, typos and patterns are found', () => {
  assert.deepEqual(hit('Lorem ipsum dolor sit amet'), ['lorem ipsum', 'dolor sit amet']);
  assert.ok(hit('TODO: add numbers').includes('todo'));
  assert.ok(hit('Launch date TBD').includes('tbd'));
  assert.ok(hit('We definately recieve teh data').length >= 3);
  assert.ok(hit('Dear [insert client name]').includes('[insert ...]'));
  assert.ok(hit('Mail me at a.b@example.org').includes('email address'));
  assert.ok(hit('token sk_live_abcdefghijklmnop1234').includes('api key value'));
  assert.ok(hit('the the cat').includes('repeated word'));
  assert.ok(hit('Click to add title').includes('click to add'));
});

test('special words: no false positives on ordinary text', () => {
  assert.deepEqual(hit('Quarterly revenue grew 12% as every region improved.'), []);
  assert.deepEqual(hit('The verification step runs daily.'), []);
  assert.deepEqual(hit('Strategic planning for the autodraft feature.'), []);
  assert.deepEqual(hit('Total: 1,200 units'), []);
});

test('special words: whole-word matching and case-insensitivity', () => {
  assert.ok(hit('This is VERY good').includes('very'));
  assert.ok(!hit('Every day').includes('very'));
  assert.ok(hit('Status: Draft').includes('draft'));
  assert.ok(!hit('Redrafted plan').includes('draft'));
});

async function dirtyDeck() {
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_16x9';
  const a = p.addSlide();
  a.addText('Lorem ipsum dolor sit amet', { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 28 });
  const b = p.addSlide();
  b.addText('TODO: add the numbers', { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 20 });
  b.addNotes('Launch date TBD');
  const c = p.addSlide();
  c.addTable([[{ text: 'Region' }, { text: 'Revenue' }], [{ text: 'North' }, { text: 'n/a' }]], { x: 0.5, y: 0.5, w: 6 });
  const d = p.addSlide();
  d.addText('Quarterly results improved by 12 percent.', { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 24 });
  const file = path.join(tmp, 'dirty.pptx');
  await p.writeFile({ fileName: file });
  return file;
}

test('checkDeck finds exactly the planted problems in slides, notes and tables', async () => {
  const r = await checkDeck(await dirtyDeck());
  const got = r.findings.map((f) => `${f.slide}:${f.where}:${f.term}`).sort();
  assert.deepEqual(got, ['1:text:dolor sit amet', '1:text:lorem ipsum', '2:notes:tbd', '2:text:todo', '3:table:n/a'].sort());
  assert.equal(r.slides, 4);
  assert.equal(r.findings.filter((f) => f.slide === 4).length, 0, 'the clean slide has no findings');
});

// ---------------------------------------------------------------- database + ask

test('build creates the database, trains to zero error and ingests decks', async () => {
  const dbPath = path.join(tmp, 'q.db');
  const deck = await dirtyDeck();
  const r = await build({ dbPath, modelPath: path.join(tmp, 'm.json'), decks: [deck] });
  assert.equal(r.stats.trainAccuracy, 1);
  assert.equal(r.stats.testAccuracy, 1);
  assert.equal(r.ingested[0].slides, 4);
  assert.equal(r.ingested[0].findings, 5);
  const db = openDb(dbPath);
  const n = (sql) => db.prepare(sql).get().n;
  assert.equal(n('SELECT count(*) n FROM roles'), Object.keys(roles).length);
  assert.equal(n('SELECT count(*) n FROM element_kinds'), elements.length);
  assert.equal(n('SELECT count(*) n FROM special_words'), words.length);
  assert.equal(n("SELECT count(*) n FROM training_samples WHERE split = 'train'"), r.stats.trainSamples);
  assert.equal(n('SELECT count(*) n FROM findings'), 5);
  assert.equal(n("SELECT count(*) n FROM findings WHERE severity = 'error'"), 4);
  db.close();
});

test('ask answers from the dataset and admits what it does not know', async () => {
  const dbPath = path.join(tmp, 'q2.db');
  await build({ dbPath, modelPath: path.join(tmp, 'm2.json'), decks: [await dirtyDeck()] });
  const db = openDb(dbPath);
  const top = (q) => ask(db, q);
  assert.equal(top('which animation should a pie chart use?').sources[0].ref, 'pie-chart');
  assert.match(top('which animation should a pie chart use?').answer, /pop/);
  assert.equal(top('what is a divider line for').sources[0].ref, 'divider');
  assert.equal(top('why is lorem ipsum flagged').sources[0].ref, 'lorem ipsum');
  assert.match(top('how many slides does dirty have').answer, /4 slide/);
  assert.match(top('what is on slide 1 of dirty').answer, /Lorem ipsum/);
  for (const q of ['who won the world cup', 'what is the capital of France', 'asdkjh qwoeiu']) assert.equal(top(q).known, false, q);
  db.close();
});
