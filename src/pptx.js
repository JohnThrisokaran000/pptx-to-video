import { readFile } from 'node:fs/promises';
import posix from 'node:path/posix';
import JSZip from 'jszip';
import { parseXml } from './xml.js';

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
  webp: 'image/webp', svg: 'image/svg+xml',
};

const THEME_KEYS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

function parseTheme(xml) {
  const colors = {};
  const scheme = xml?.at('a:themeElements/a:clrScheme');
  for (const k of THEME_KEYS) {
    const c = scheme?.get(`a:${k}`)?.children[0];
    if (!c) continue;
    colors[k] = c.name === 'a:sysClr' ? c.attr('lastClr', '000000') : c.attr('val', '000000');
  }
  const fonts = xml?.at('a:themeElements/a:fontScheme');
  return {
    colors,
    major: fonts?.at('a:majorFont/a:latin')?.attr('typeface') || 'Calibri Light',
    minor: fonts?.at('a:minorFont/a:latin')?.attr('typeface') || 'Calibri',
  };
}

export async function openPptx(file) {
  const zip = await JSZip.loadAsync(await readFile(file));
  const xmlCache = new Map();
  const mediaCache = new Map();

  const xml = async (p) => {
    if (!xmlCache.has(p)) {
      const f = zip.file(p);
      xmlCache.set(p, f ? parseXml(await f.async('string')) : null);
    }
    return xmlCache.get(p);
  };

  const relsOf = async (part) => {
    const rel = await xml(`${posix.dirname(part)}/_rels/${posix.basename(part)}.rels`);
    const map = new Map();
    for (const r of rel?.all('Relationship') ?? []) {
      const external = r.attr('TargetMode') === 'External';
      const t = r.attr('Target', '');
      const target = external ? t : t.startsWith('/') ? t.slice(1) : posix.normalize(posix.join(posix.dirname(part), t));
      map.set(r.attr('Id'), { id: r.attr('Id'), type: r.attr('Type', ''), target, external });
    }
    return map;
  };
  const part = async (p) => ({ path: p, xml: await xml(p), rels: await relsOf(p) });
  const relByType = (rels, suffix) => [...rels.values()].find((r) => r.type.endsWith(`/${suffix}`));

  const pres = await part('ppt/presentation.xml');
  if (!pres.xml) throw new Error('Not a valid .pptx (ppt/presentation.xml missing)');
  const sz = pres.xml.get('p:sldSz');
  const size = { cx: sz?.num('cx', 9144000) ?? 9144000, cy: sz?.num('cy', 6858000) ?? 6858000 };
  const slidePaths = (pres.xml.at('p:sldIdLst')?.all('p:sldId') ?? [])
    .map((s) => pres.rels.get(s.attr('r:id'))?.target)
    .filter(Boolean);

  const themeCache = new Map();

  return {
    size,
    slideCount: slidePaths.length,
    defaultTextStyle: pres.xml.get('p:defaultTextStyle'),

    async slide(i) {
      const slide = await part(slidePaths[i]);
      const layoutRel = relByType(slide.rels, 'slideLayout');
      const layout = layoutRel ? await part(layoutRel.target) : { xml: null, rels: new Map() };
      const masterRel = relByType(layout.rels, 'slideMaster');
      const master = masterRel ? await part(masterRel.target) : { xml: null, rels: new Map() };
      const themeRel = relByType(master.rels, 'theme');
      let theme = themeCache.get(themeRel?.target);
      if (!theme) {
        theme = parseTheme(themeRel ? await xml(themeRel.target) : null);
        themeCache.set(themeRel?.target, theme);
      }
      const clrMap = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
      Object.assign(clrMap, master.xml?.get('p:clrMap')?.attrs);
      const ovr = slide.xml?.at('p:clrMapOvr/a:overrideClrMapping');
      if (ovr) Object.assign(clrMap, ovr.attrs);

      let notes = '';
      const notesRel = relByType(slide.rels, 'notesSlide');
      if (notesRel) {
        const nx = await xml(notesRel.target);
        const body = nx?.at('p:cSld/p:spTree')?.all('p:sp').find((sp) => sp.at('p:nvSpPr/p:nvPr/p:ph')?.attr('type') === 'body');
        notes = (body?.get('p:txBody')?.all('a:p') ?? [])
          .map((p) => p.children.filter((c) => c.name === 'a:r' || c.name === 'a:fld').map((r) => r.get('a:t')?.text ?? '').join(''))
          .join('\n')
          .trim();
      }
      return { slide, layout, master, theme, clrMap, notes };
    },

    xml,
    part,

    /** Returns a data: URI for an embedded media part, or null when it is missing / not browser renderable. */
    async image(path) {
      if (mediaCache.has(path)) return mediaCache.get(path);
      const ext = posix.extname(path).slice(1).toLowerCase();
      const f = zip.file(path);
      let uri = null;
      if (f && MIME[ext]) uri = `data:${MIME[ext]};base64,${await f.async('base64')}`;
      mediaCache.set(path, uri);
      return uri;
    },
  };
}
