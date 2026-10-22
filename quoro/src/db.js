import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = path.join(ROOT, 'quoro.db');

const SCHEMA = `
CREATE TABLE roles (role TEXT PRIMARY KEY, description TEXT, animation TEXT);
CREATE TABLE element_kinds (
  id TEXT PRIMARY KEY, name TEXT, category TEXT, role TEXT, animation TEXT,
  keywords TEXT, description TEXT, when_to_use TEXT
);
CREATE TABLE special_words (
  id INTEGER PRIMARY KEY, term TEXT, mode TEXT, pattern TEXT, category TEXT, severity TEXT, why TEXT, fix TEXT
);
CREATE TABLE training_samples (id INTEGER PRIMARY KEY, split TEXT, role TEXT, features TEXT);
CREATE TABLE model (name TEXT PRIMARY KEY, json TEXT, trained_at TEXT);
CREATE TABLE decks (id INTEGER PRIMARY KEY, path TEXT UNIQUE, name TEXT, slides INTEGER, ingested_at TEXT);
CREATE TABLE slides (id INTEGER PRIMARY KEY, deck_id INTEGER, idx INTEGER, title TEXT, notes TEXT);
CREATE TABLE elements (
  id INTEGER PRIMARY KEY, deck_id INTEGER, slide_idx INTEGER, eid TEXT, type TEXT, role TEXT, legacy_role TEXT,
  text TEXT, words INTEGER, area REAL
);
CREATE TABLE findings (
  id INTEGER PRIMARY KEY, deck_id INTEGER, slide_idx INTEGER, where_ TEXT, term TEXT, category TEXT, severity TEXT, snippet TEXT
);
CREATE INDEX elements_deck ON elements(deck_id, slide_idx);
CREATE INDEX findings_deck ON findings(deck_id, severity);
`;

/** Creates a fresh, empty database at `file` (replacing any existing one). */
export function createDb(file = DB_PATH) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  for (const t of ['findings', 'elements', 'slides', 'decks', 'model', 'training_samples', 'special_words', 'element_kinds', 'roles']) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.exec(SCHEMA);
  return db;
}

export function openDb(file = DB_PATH) {
  return new DatabaseSync(file);
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
