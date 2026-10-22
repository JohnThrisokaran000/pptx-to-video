#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { pptxToVideo } from '../src/index.js';
import { CAMERA_MODES, STYLES, TRANSITION_NAMES, styleNames } from '../src/styles.js';

const RESOLUTIONS = { '720p': 1280, '1080p': 1920, '1440p': 2560, '2k': 2560, '4k': 3840 };

const program = new Command();
program
  .name('pptx-to-video')
  .description('Turn a .pptx into an animated MP4: every element gets an entrance animation that fits its type.')
  .argument('[input]', 'path to the .pptx file')
  .option('-o, --output <file>', 'output .mp4 (default: next to the input)')
  .option('-s, --style <name>', `video style: ${styleNames().join(', ')}`, 'classic')
  .option('--list-styles', 'describe every style and exit')
  .option('--camera <mode>', `override the style's camera move: ${CAMERA_MODES.join(', ')}`)
  .option('--transition <name>', `override slide transitions: mix, ${TRANSITION_NAMES.join(', ')}`)
  .option('-r, --resolution <res>', '720p, 1080p, 1440p or 4k', '1080p')
  .option('-w, --width <px>', 'exact video width in px (overrides --resolution); height follows the slide aspect ratio')
  .option('--crf <n>', 'x264 quality, lower = better/larger (default 17)', '17')
  .option('--fps <n>', 'frames per second', '30')
  .option('--slide-duration <sec>', 'fixed seconds per slide (default: derived from content)')
  .option('--max-anim <sec>', 'longest allowed build-in per slide before it is sped up', '7')
  .option('--speed <x>', 'animation speed multiplier', '1')
  .option('--slides <list>', 'only these slides, e.g. 1,3-5')
  .option('--narrate', 'read speaker notes aloud (Windows speech engine, no API key)')
  .option('--voice <name>', 'narration voice name, e.g. "Microsoft Zira Desktop"')
  .option('--rate <-10..10>', 'narration speed', '0')
  .option('--audio <file>', 'background music (mp3/wav/...), looped and faded out')
  .option('--audio-volume <0..1>', 'background music volume', '0.25')
  .option('--quoro', 'let Quoro AI (local, trained) classify the elements and report placeholder / unfinished text; run "node bin/quoro.js build" first')
  .option('--browser <path>', 'Chrome/Edge executable to render with')
  .option('--snapshots <dir>', 'also save a PNG of each slide in its fully built-in state')
  .action(async (input, o) => {
    if (o.listStyles) {
      for (const [k, v] of Object.entries(STYLES)) console.log(`${k.padEnd(11)} ${v.desc}  [camera: ${v.camera}]`);
      console.log(`${'mix'.padEnd(11)} A different style on every slide.`);
      return;
    }
    if (!input) { program.error('missing <input> .pptx file (or use --list-styles)'); }
    const width = o.width ? Number(o.width) : RESOLUTIONS[String(o.resolution).toLowerCase()];
    if (!width) { program.error(`unknown resolution "${o.resolution}" (use 720p, 1080p, 1440p, 4k)`); }
    const parseSlides = (s) =>
      s.split(',').flatMap((part) => {
        const [a, b] = part.split('-').map(Number);
        return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
      });
    const output = o.output ?? path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.mp4`);
    try {
      await pptxToVideo(input, output, {
        width, fps: Number(o.fps), crf: Number(o.crf), style: o.style, camera: o.camera ?? null, transition: o.transition ?? null, maxAnim: Number(o.maxAnim), speed: Number(o.speed),
        slideDuration: o.slideDuration ? Number(o.slideDuration) : null,
        slides: o.slides ? parseSlides(o.slides) : null,
        narrate: !!o.narrate, voice: o.voice ?? '', rate: Number(o.rate),
        audio: o.audio ? path.resolve(o.audio) : null, audioVolume: Number(o.audioVolume),
        browser: o.browser ?? null, snapshots: o.snapshots ?? null, quoro: !!o.quoro,
        onProgress: (m) => process.stderr.write(`${m}\n`),
      });
    } catch (e) {
      process.stderr.write(`error: ${e.message}\n`);
      process.exitCode = 1;
    }
  });

program.parse();
