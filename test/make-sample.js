import { deflateSync } from 'node:zlib';
import PptxGenJS from 'pptxgenjs';

// tiny gradient PNG so the sample needs no external assets
function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1); raw[o] = 0; raw[o + 1 + x * 3] = (x / w) * 255; raw[o + 2 + x * 3] = (y / h) * 200; raw[o + 3 + x * 3] = 180; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const p = new PptxGenJS();
p.layout = 'LAYOUT_WIDE';
p.theme = { headFontFace: 'Segoe UI Semibold', bodyFontFace: 'Segoe UI' };

let s = p.addSlide();
s.background = { color: '0F172A' };
s.addText('Quarterly Business Review', { x: 0.8, y: 2.2, w: 11.5, h: 1.2, fontSize: 48, bold: true, color: 'FFFFFF' });
s.addText('Growth, product and what comes next', { x: 0.8, y: 3.5, w: 11, h: 0.6, fontSize: 24, color: '94A3B8' });
s.addShape(p.ShapeType.rect, { x: 0.8, y: 4.3, w: 2.5, h: 0.08, fill: { color: '38BDF8' } });
s.addNotes('Welcome everyone. Today we review the quarter and talk about what comes next.');

s = p.addSlide();
s.addText('Highlights', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontSize: 36, bold: true, color: '0F172A' });
s.addText(
  [
    { text: 'Revenue grew 24% quarter over quarter', options: { bullet: true, breakLine: true } },
    { text: 'Launched the new onboarding experience', options: { bullet: true, breakLine: true } },
    { text: 'Support response time cut in half', options: { bullet: true, breakLine: true } },
    { text: 'Expanded into three new regions', options: { bullet: true } },
  ],
  { x: 0.8, y: 1.6, w: 7, h: 4, fontSize: 24, color: '1E293B', paraSpaceAfter: 10 },
);
s.addImage({ data: `image/png;base64,${png(320, 240).toString('base64')}`, x: 8.4, y: 1.7, w: 4.2, h: 3.15 });
s.addNotes('Four big wins this quarter. Revenue, onboarding, support and expansion.');

s = p.addSlide();
s.addText('Three pillars', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontSize: 36, bold: true, color: '0F172A' });
[['Reach', '2563EB'], ['Retain', '16A34A'], ['Grow', 'EA580C']].forEach(([t, c], i) => {
  s.addShape(p.ShapeType.roundRect, { x: 0.8 + i * 4.05, y: 1.8, w: 3.6, h: 2.6, fill: { color: c }, rectRadius: 0.2, line: { color: c } });
  s.addText(t, { x: 0.8 + i * 4.05, y: 1.8, w: 3.6, h: 2.6, align: 'center', fontSize: 32, bold: true, color: 'FFFFFF' });
});
s.addShape(p.ShapeType.ellipse, { x: 5.9, y: 4.9, w: 1.2, h: 1.2, fill: { color: 'FACC15' } });
s.addShape(p.ShapeType.line, { x: 0.8, y: 4.6, w: 11.7, h: 0, line: { color: '94A3B8', width: 2, endArrowType: 'triangle' } });

s = p.addSlide();
s.addText('Numbers', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontSize: 36, bold: true, color: '0F172A' });
s.addChart(p.charts.BAR, [{ name: 'Revenue', labels: ['Q1', 'Q2', 'Q3', 'Q4'], values: [12, 19, 24, 31] }, { name: 'Cost', labels: ['Q1', 'Q2', 'Q3', 'Q4'], values: [9, 11, 14, 16] }], { x: 0.6, y: 1.4, w: 6.2, h: 4.8, showLegend: true, legendPos: 'b', chartColors: ['2563EB', 'F97316'] });
s.addChart(p.charts.PIE, [{ name: 'Share', labels: ['EMEA', 'APAC', 'AMER'], values: [35, 25, 40] }], { x: 7, y: 1.4, w: 5.8, h: 4.8, showLegend: true, legendPos: 'r', showPercent: true });
s.addNotes('Revenue is growing faster than cost, and the AMER region is still the largest.');

s = p.addSlide();
s.addText('Roadmap', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontSize: 36, bold: true, color: '0F172A' });
s.addTable(
  [
    [{ text: 'Milestone', options: { bold: true, color: 'FFFFFF', fill: { color: '0F172A' } } }, { text: 'Owner', options: { bold: true, color: 'FFFFFF', fill: { color: '0F172A' } } }, { text: 'Date', options: { bold: true, color: 'FFFFFF', fill: { color: '0F172A' } } }],
    ['Public beta', 'Priya', 'Nov 12'],
    ['Mobile app', 'Daniel', 'Dec 03'],
    ['Enterprise tier', 'Mei', 'Jan 20'],
  ],
  { x: 0.8, y: 1.8, w: 11.5, colW: [5, 3.5, 3], fontSize: 20, border: { type: 'solid', color: 'CBD5E1', pt: 1 }, rowH: 0.7 },
);
s.addChart(p.charts.LINE, [{ name: 'Users', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'], values: [5, 9, 14, 22, 35] }], { x: 0.8, y: 4.9, w: 11.5, h: 2.4, chartColors: ['0EA5E9'] });

s = p.addSlide();
s.background = { color: '2563EB' };
s.addText('Thank you', { x: 0, y: 2.6, w: 13.33, h: 1.4, align: 'center', fontSize: 60, bold: true, color: 'FFFFFF' });

await p.writeFile({ fileName: new URL('./sample.pptx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
console.log('wrote test/sample.pptx');
