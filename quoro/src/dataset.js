import { vectorOf, PH_GROUPS } from './features.js';

// Generates Quoro's labelled training data from the role specifications in data/roles.json.
// Each sample is { role, d } where d is a feature description (see features.js).

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AREA_DOMAIN = [0.0005, 1.3];
const ASPECT_DOMAIN = [0.02, 50];
const WORD_DOMAIN = [1, 80];

const asRanges = (r) => (Array.isArray(r[0]) ? r : [r]);

function sampleSpec(spec, rnd, edge, cat) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const logU = ([lo, hi]) => Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo)));
  const num = (r, domain, which) => {
    const rg = pick(asRanges(r ?? domain));
    if (edge && r && which) return which === 'lo' ? rg[0] : rg[1];
    return logU(rg);
  };
  const d = { type: spec.type, ph: cat.ph, text: cat.text, visible: cat.visible, line: spec.type === 'shape' && !!spec.line };
  d.area = num(spec.area, AREA_DOMAIN, edge?.area);
  d.aspect = num(spec.aspect, ASPECT_DOMAIN, edge?.aspect);
  d.words = d.text ? Math.round(num(spec.words, WORD_DOMAIN)) : 0;
  return d;
}

/** Every combination of the categorical features a spec allows, so no combination is left to chance. */
function categoricalCombos(spec) {
  const shape = spec.type === 'shape';
  const phs = shape ? spec.ph ?? PH_GROUPS : ['none'];
  const texts = shape ? (spec.text === 'any' ? [false, true] : [!!spec.text]) : [false];
  const visibles = shape ? (spec.visible === undefined ? [false, true] : [!!spec.visible]) : [false];
  return phs.flatMap((ph) => texts.flatMap((text) => visibles.map((visible) => ({ ph, text, visible }))));
}

/**
 * @param roles  parsed data/roles.json `roles`
 * @param opts   seed, perSpec (random samples per spec, spread over its categorical combinations), edges (exact boundary samples)
 */
export function generate(roles, { seed = 1, perSpec = 400, edges = true } = {}) {
  const rnd = mulberry32(seed);
  const out = [];
  for (const [role, def] of Object.entries(roles)) {
    for (const spec of def.specs) {
      const combos = categoricalCombos(spec);
      const each = Math.max(12, Math.ceil(perSpec / combos.length));
      for (const cat of combos) {
        for (let i = 0; i < each; i++) out.push({ role, d: sampleSpec(spec, rnd, null, cat) });
        if (!edges) continue;
        for (const area of [undefined, 'lo', 'hi']) {
          for (const aspect of [undefined, 'lo', 'hi']) {
            if (!area && !aspect) continue;
            // an exact boundary value for the dimensions the spec constrains, random for the rest
            for (let i = 0; i < 2; i++) out.push({ role, d: sampleSpec(spec, rnd, { area: spec.area ? area : undefined, aspect: spec.aspect ? aspect : undefined }, cat) });
          }
        }
        // exact range ends for multi-range aspects
        if (Array.isArray(spec.aspect?.[0])) {
          for (const rg of spec.aspect) for (const v of rg) out.push({ role, d: { ...sampleSpec(spec, rnd, null, cat), aspect: v } });
        }
      }
    }
  }
  return out;
}

/** Fails if two samples with the same features carry different roles: the specs must not overlap. */
export function findConflicts(samples) {
  const seen = new Map();
  const bad = [];
  for (const s of samples) {
    const k = vectorOf(s.d).join(',');
    const prev = seen.get(k);
    if (prev && prev !== s.role) bad.push({ k, a: prev, b: s.role });
    seen.set(k, s.role);
  }
  return bad;
}

export function toXY(samples) {
  return { X: samples.map((s) => vectorOf(s.d)), y: samples.map((s) => s.role) };
}
