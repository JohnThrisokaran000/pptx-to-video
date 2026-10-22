import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './db.js';
import { describe, vectorOf, FEATURES } from './features.js';
import { predict } from './tree.js';

export const MODEL_PATH = path.join(ROOT, 'model.json');

export function saveModel(model, file = MODEL_PATH) {
  writeFileSync(file, `${JSON.stringify(model)}\n`);
}

export function loadModel(file = MODEL_PATH) {
  if (!existsSync(file)) throw new Error('Quoro has no trained model yet. Run: node bin/quoro.js build');
  const model = JSON.parse(readFileSync(file, 'utf8'));
  if (model.features.join() !== FEATURES.join()) throw new Error('model.json does not match the current feature set. Run: node bin/quoro.js build');
  return model;
}

/** Role classifier with the same signature as animate.js's roleOf(el, slideModel). */
export function quoroRoleOf(model = loadModel()) {
  return (el, m) => predict(model.tree, vectorOf(describe(el, m)));
}

export const animationFor = (model, role) => model.roles[role]?.animation ?? null;
