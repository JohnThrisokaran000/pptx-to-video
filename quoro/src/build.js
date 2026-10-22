import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './check.js';
import { createDb, transaction, DB_PATH } from './db.js';
import { generate, findConflicts, toXY } from './dataset.js';
import { trainTree, accuracy, treeSize } from './tree.js';
import { FEATURES } from './features.js';
import { saveModel, MODEL_PATH } from './model.js';
import { ingestDeck } from './ingest.js';

const readJson = (f) => JSON.parse(readFileSync(path.join(DATA_DIR, f), 'utf8'));

/** Stratified k-fold cross-validation accuracy of the tree on a sample set. */
function crossValidate(samples, k = 5) {
  const folds = Array.from({ length: k }, () => []);
  samples.forEach((s, i) => folds[i % k].push(s));
  let ok = 0, total = 0;
  for (let f = 0; f < k; f++) {
    const train = folds.flatMap((x, i) => (i === f ? [] : x));
    const { X, y } = toXY(train);
    const tree = trainTree(X, y);
    const t = toXY(folds[f]);
    const a = accuracy(tree, t.X, t.y);
    ok += a.ok;
    total += a.total;
  }
  return { acc: ok / total, folds: k };
}

/**
 * Builds Quoro from scratch: loads the three datasets into SQLite, generates the training set, trains the role model
 * until it has no training error, evaluates it on an independently generated test set and ingests the given decks.
 */
export async function build({ dbPath = DB_PATH, modelPath = MODEL_PATH, decks = [], log = () => {} } = {}) {
  const { roles } = readJson('roles.json');
  const { elements } = readJson('elements.json');
  const { words } = readJson('special-words.json');

  // validate the datasets
  const roleNames = new Set(Object.keys(roles));
  for (const e of elements) if (e.role && !roleNames.has(e.role)) throw new Error(`elements.json: "${e.id}" uses unknown role "${e.role}"`);
  const ids = new Set();
  for (const e of elements) { if (ids.has(e.id)) throw new Error(`elements.json: duplicate id "${e.id}"`); ids.add(e.id); }
  for (const w of words) {
    if (w.mode === 'regex') new RegExp(w.pattern, 'iu');
    else if (!['word', 'phrase'].includes(w.mode)) throw new Error(`special-words.json: bad mode for "${w.term}"`);
    if (!['error', 'warn', 'info'].includes(w.severity)) throw new Error(`special-words.json: bad severity for "${w.term}"`);
  }
  log(`datasets: ${roleNames.size} roles, ${elements.length} element kinds, ${words.length} special words`);

  // training data -> model
  const train = generate(roles, { seed: 1, perSpec: 400 });
  const conflicts = findConflicts(train);
  if (conflicts.length) throw new Error(`role specs overlap (${conflicts.length} identical feature vectors with different roles), e.g. ${conflicts[0].a} vs ${conflicts[0].b}`);
  const test = generate(roles, { seed: 2, perSpec: 300, edges: false });
  const { X, y } = toXY(train);
  const tree = trainTree(X, y);
  const fit = accuracy(tree, X, y);
  if (fit.wrong.length) throw new Error(`training did not reach zero error: ${fit.wrong.length} of ${fit.total} samples wrong`);
  const tx = toXY(test);
  const held = accuracy(tree, tx.X, tx.y);
  const cv = crossValidate(train);
  const size = treeSize(tree);
  const stats = { trainSamples: train.length, trainAccuracy: fit.acc, testSamples: test.length, testAccuracy: held.acc, testErrors: held.wrong.length, cvAccuracy: cv.acc, cvFolds: cv.folds, tree: size };
  log(`trained: ${size.leaves} leaves, depth ${size.depth}; train ${(fit.acc * 100).toFixed(2)}% (${fit.ok}/${fit.total}), held-out ${(held.acc * 100).toFixed(2)}% (${held.ok}/${held.total}), ${cv.folds}-fold CV ${(cv.acc * 100).toFixed(2)}%`);

  const model = {
    name: 'quoro-roles', version: 1, features: FEATURES, tree, stats, trainedAt: new Date().toISOString(),
    roles: Object.fromEntries(Object.entries(roles).map(([r, d]) => [r, { description: d.description, animation: d.animation }])),
  };
  saveModel(model, modelPath);

  // database
  const db = createDb(dbPath);
  transaction(db, () => {
    const insRole = db.prepare('INSERT INTO roles VALUES (?,?,?)');
    for (const [r, d] of Object.entries(roles)) insRole.run(r, d.description, d.animation);
    const insEl = db.prepare('INSERT INTO element_kinds VALUES (?,?,?,?,?,?,?,?)');
    for (const e of elements) insEl.run(e.id, e.name, e.category, e.role, e.animation, e.keywords.join(', '), e.description, e.whenToUse);
    const insW = db.prepare('INSERT INTO special_words (term, mode, pattern, category, severity, why, fix) VALUES (?,?,?,?,?,?,?)');
    for (const w of words) insW.run(w.term, w.mode, w.pattern ?? null, w.category, w.severity, w.why, w.fix);
    const insS = db.prepare('INSERT INTO training_samples (split, role, features) VALUES (?,?,?)');
    for (const s of train) insS.run('train', s.role, JSON.stringify(s.d));
    for (const s of test) insS.run('test', s.role, JSON.stringify(s.d));
    db.prepare('INSERT INTO model VALUES (?,?,?)').run('quoro-roles', JSON.stringify({ stats, trainedAt: model.trainedAt, features: FEATURES }), model.trainedAt);
  });
  log(`database: ${dbPath}`);

  const ingested = [];
  for (const d of decks) {
    if (!existsSync(d)) { log(`skip (not found): ${d}`); continue; }
    const r = await ingestDeck(db, d, model, words);
    ingested.push(r);
    log(`ingested ${r.name}: ${r.slides} slides, ${r.elements} elements, ${r.findings} findings`);
  }
  db.close();
  return { stats, ingested, dbPath, modelPath };
}
