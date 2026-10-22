import { XMLParser } from 'fast-xml-parser';

// preserveOrder keeps z-order of mixed siblings (sp / pic / grpSp ...) and run order inside paragraphs.
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

export class El {
  constructor(name, attrs = {}) {
    this.name = name;
    this.attrs = attrs;
    this.children = [];
    this.text = '';
  }
  get(name) {
    return this.children.find((c) => c.name === name) ?? null;
  }
  all(name) {
    return this.children.filter((c) => c.name === name);
  }
  /** Walk a slash separated path of child names. */
  at(path) {
    let n = this;
    for (const p of path.split('/')) {
      n = n?.get(p);
      if (!n) return null;
    }
    return n;
  }
  attr(k, d) {
    const v = this.attrs[k];
    return v === undefined ? d : v;
  }
  num(k, d = 0) {
    const v = this.attrs[k];
    if (v === undefined || v === '') return d;
    const n = Number(v);
    return Number.isNaN(n) ? d : n;
  }
  bool(k, d = false) {
    const v = this.attrs[k];
    if (v === undefined) return d;
    return v === '1' || v === 'true';
  }
}

// the parser leaves numeric character references (&#x2022; / &#8226;) undecoded
const decode = (s) =>
  typeof s === 'string' && s.includes('&#')
    ? s.replace(/&#(x[0-9a-fA-F]+|\d+);/g, (_, n) => String.fromCodePoint(n[0] === 'x' ? parseInt(n.slice(1), 16) : Number(n)))
    : s;

function convert(items, parent) {
  for (const it of items) {
    const key = Object.keys(it).find((k) => k !== ':@');
    if (key === '#text') {
      parent.text += decode(it['#text']);
      continue;
    }
    const attrs = it[':@'] ?? {};
    for (const k of Object.keys(attrs)) attrs[k] = decode(attrs[k]);
    const el = new El(key, attrs);
    convert(it[key], el);
    parent.children.push(el);
  }
}

export function parseXml(str) {
  const root = new El('#root');
  convert(parser.parse(str), root);
  return root.children[0] ?? null;
}
