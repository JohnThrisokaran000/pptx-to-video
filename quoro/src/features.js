import { countWords } from '../../src/html.js';

// Turns a slide element (src/slide.js model) into the small feature vector Quoro's role model works on.

export const FEATURES = ['isShape', 'isPic', 'isTable', 'isChart', 'phTitle', 'phSub', 'phFooter', 'phOther', 'text', 'visible', 'line', 'area', 'aspect', 'words'];
export const PH_GROUPS = ['title', 'subTitle', 'footer', 'other', 'none'];

const FOOTERS = new Set(['dt', 'ftr', 'sldNum']);

export function phGroup(ph) {
  if (!ph) return 'none';
  if (ph === 'title' || ph === 'ctrTitle') return 'title';
  if (ph === 'subTitle') return 'subTitle';
  if (FOOTERS.has(ph)) return 'footer';
  return 'other';
}

/** Readable description of an element: { type, ph, text, visible, line, area, aspect, words }. */
export function describe(el, m) {
  const area = (el.w * el.h) / (m.width * m.height);
  const aspect = el.w / Math.max(el.h, 1);
  if (el.type !== 'shape') return { type: el.type, ph: 'none', text: false, visible: false, line: false, area, aspect, words: 0 };
  const prst = el.geom?.prst ?? '';
  return {
    type: 'shape',
    ph: phGroup(el.ph),
    text: !!el.text,
    visible: el.fill?.type !== 'none' || !!el.line,
    line: prst === 'line' || /Connector/.test(prst),
    area,
    aspect,
    words: el.text ? countWords(el.text.paras) : 0,
  };
}

/** Numeric vector in FEATURES order. */
export function vectorOf(d) {
  return [
    d.type === 'shape' ? 1 : 0, d.type === 'pic' ? 1 : 0, d.type === 'table' ? 1 : 0, d.type === 'chart' ? 1 : 0,
    d.ph === 'title' ? 1 : 0, d.ph === 'subTitle' ? 1 : 0, d.ph === 'footer' ? 1 : 0, d.ph === 'other' ? 1 : 0,
    d.text ? 1 : 0, d.visible ? 1 : 0, d.line ? 1 : 0, d.area, d.aspect, d.words,
  ];
}
