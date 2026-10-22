#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from '../quoro/src/build.js';
import { checkDeck } from '../quoro/src/check.js';
import { ingestDeck } from '../quoro/src/ingest.js';
import { ask } from '../quoro/src/ask.js';
import { loadModel } from '../quoro/src/model.js';
import { openDb, DB_PATH } from '../quoro/src/db.js';

const SAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'sample.pptx');
const needDb = () => {
  if (!existsSync(DB_PATH)) { console.error('No database yet. Run: node bin/quoro.js build'); process.exit(1); }
  return openDb();
};

const program = new Command();
program.name('quoro').description('Quoro AI: a fully local deck assistant (role model + database + special-word checker). No network, no API keys.');

program.command('build [decks...]')
  .description('create the database, train the model and ingest decks (default: test/sample.pptx)')
  .action(async (decks) => {
    const list = decks.length ? decks : existsSync(SAMPLE) ? [SAMPLE] : [];
    const r = await build({ decks: list, log: (m) => console.log(m) });
    console.log(`model: ${r.modelPath}`);
  });

program.command('ingest <decks...>')
  .description('add decks to the database (re-ingesting replaces)')
  .action(async (decks) => {
    const db = needDb();
    const model = loadModel();
    for (const d of decks) {
      const r = await ingestDeck(db, d, model);
      console.log(`ingested ${r.name}: ${r.slides} slides, ${r.elements} elements, ${r.findings} findings`);
    }
  });

program.command('check <deck>')
  .description('look for special words (placeholders, TODOs, typos, secrets...) in slides, tables and speaker notes')
  .option('--json', 'machine-readable output')
  .option('--min <severity>', 'lowest severity to show: info, warn, error', 'info')
  .action(async (deck, o) => {
    const rank = { info: 0, warn: 1, error: 2 };
    const r = await checkDeck(deck);
    const list = r.findings.filter((f) => rank[f.severity] >= rank[o.min]);
    if (o.json) console.log(JSON.stringify({ ...r, findings: list }, null, 2));
    else {
      for (const f of list) console.log(`slide ${f.slide} [${f.severity}] ${f.category} "${f.match}" in ${f.where}: ${f.why}  ${f.snippet}`);
      const n = (s) => r.findings.filter((f) => f.severity === s).length;
      console.log(`${r.slides} slide(s): ${n('error')} error(s), ${n('warn')} warning(s), ${n('info')} note(s)`);
    }
    if (r.findings.some((f) => f.severity === 'error')) process.exitCode = 1;
  });

program.command('classify [deck]')
  .description('show which role Quoro gives every element of an ingested deck, and where it differs from the built-in rules')
  .action((deck) => {
    const db = needDb();
    const rows = db.prepare('SELECT d.name, e.slide_idx, e.type, e.role, e.legacy_role, substr(e.text,1,40) AS t FROM elements e JOIN decks d ON d.id = e.deck_id WHERE ($n IS NULL OR d.name = $n) ORDER BY d.id, e.slide_idx, e.id')
      .all({ n: deck ? path.basename(deck) : null });
    let same = 0;
    for (const r of rows) {
      if (r.role === r.legacy_role) same++;
      console.log(`${r.name} #${r.slide_idx} ${r.type.padEnd(6)} ${r.role.padEnd(13)}${r.role === r.legacy_role ? '' : ` (rules say ${r.legacy_role})`} ${r.t.replace(/\s+/g, ' ')}`);
    }
    console.log(`${rows.length} element(s), ${same} identical to the rule-based roles`);
  });

program.command('ask <question...>')
  .description('answer a question from the dataset (elements, animations, special words, ingested decks)')
  .option('--json', 'machine-readable output')
  .action((words, o) => {
    const db = needDb();
    const r = ask(db, words.join(' '));
    if (o.json) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(r.answer);
      if (r.known) console.log(`  [${r.sources.map((s) => `${s.kind}:${s.ref}`).join(', ')}]`);
    }
  });

program.command('stats')
  .description('what Quoro knows and how well the model scored')
  .action(() => {
    const db = needDb();
    const n = (sql) => db.prepare(sql).get().n;
    const model = loadModel();
    const s = model.stats;
    console.log(`roles ${n('SELECT count(*) n FROM roles')}, element kinds ${n('SELECT count(*) n FROM element_kinds')}, special words ${n('SELECT count(*) n FROM special_words')}, decks ${n('SELECT count(*) n FROM decks')}, elements ${n('SELECT count(*) n FROM elements')}`);
    console.log(`model trained ${model.trainedAt}: ${s.tree.leaves} leaves, depth ${s.tree.depth}`);
    console.log(`  training accuracy ${(s.trainAccuracy * 100).toFixed(2)}% on ${s.trainSamples} samples`);
    console.log(`  held-out accuracy ${(s.testAccuracy * 100).toFixed(2)}% on ${s.testSamples} independent samples (${s.testErrors} error(s))`);
    console.log(`  ${s.cvFolds}-fold cross-validation ${(s.cvAccuracy * 100).toFixed(2)}%`);
  });

program.parseAsync().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
