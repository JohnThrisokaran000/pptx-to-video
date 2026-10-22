import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import puppeteer from 'puppeteer-core';
import { planSlide } from './animate.js';
import { slideHtml } from './html.js';
import { synthesize } from './narrate.js';
import { openPptx } from './pptx.js';
import { extractSlide } from './slide.js';

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

export function findBrowser(explicit) {
  const home = os.homedir();
  const list = [explicit, process.env.PPTX_VIDEO_BROWSER, process.env.CHROME_PATH];
  const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  for (const base of pf) {
    list.push(path.join(base, 'Google/Chrome/Application/chrome.exe'), path.join(base, 'Microsoft/Edge/Application/msedge.exe'));
    try {
      for (const v of readdirSync(path.join(base, 'Microsoft/EdgeCore'))) list.push(path.join(base, 'Microsoft/EdgeCore', v, 'msedge.exe'));
    } catch { /* not installed */ }
  }
  const cache = path.join(home, '.cache/puppeteer/chrome');
  try {
    for (const v of readdirSync(cache)) list.push(path.join(cache, v, 'chrome-win64/chrome.exe'), path.join(cache, v, 'chrome-linux64/chrome'), path.join(cache, v, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
  } catch { /* no cache */ }
  list.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const hit = list.filter(Boolean).find((p) => existsSync(p));
  if (!hit) throw new Error('No Chrome/Edge found. Install one or pass --browser <path> (or set PPTX_VIDEO_BROWSER).');
  return hit;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.trim()}`))));
  });
}

// ---- browser side ----------------------------------------------------------------------------

/** Shrinks text of normAutofit boxes until it fits, like PowerPoint's "shrink text on overflow". */
function fitText() {
  for (const txt of document.querySelectorAll('.txt[data-fit]')) {
    const tin = txt.firstElementChild;
    const cs = getComputedStyle(txt);
    const avail = txt.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const over = () => tin.offsetHeight > avail + 1;
    txt.style.setProperty('--fit', '1');
    if (!over()) continue;
    let lo = 0.25, hi = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      txt.style.setProperty('--fit', String(mid));
      if (over()) hi = mid; else lo = mid;
    }
    txt.style.setProperty('--fit', String(lo));
  }
}

/** Builds a paused Web Animation per effect; returns [start,end] ms intervals for frame de-duplication. */
function setupAnimations(fx) {
  const anims = [];
  for (const f of fx) {
    document.querySelectorAll(f.sel).forEach((node, i) => {
      const a = node.animate(f.kf, { delay: (f.delay + i * f.stagger) * 1000, duration: f.dur * 1000, easing: f.ease, fill: f.fill });
      a.pause();
      anims.push(a);
    });
  }
  window.__anims = anims;
  return anims.map((a) => {
    const t = a.effect.getComputedTiming();
    return [t.delay, t.endTime];
  });
}

function seek(ms) {
  for (const a of window.__anims) a.currentTime = ms;
}

async function prepare(page, html, fx) {
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  });
  await page.evaluate(fitText);
  return page.evaluate(setupAnimations, fx);
}

// ---- main --------------------------------------------------------------------------------------

/**
 * @param {string} input   path to .pptx
 * @param {string} output  path to .mp4
 * @param {object} opts    width (default 1920), fps, crf, style, camera, transition, slideDuration, maxAnim, speed, narrate, voice, rate, audio, audioVolume,
 *                         browser, snapshots, slides (array of 1-based indexes), quoro (use Quoro AI's role model and report special words), onProgress(msg)
 */
export async function pptxToVideo(input, output, opts = {}) {
  const {
    width = 1920, fps = 30, crf = 17, style = 'classic', camera = null, transition = null,
    slideDuration = null, maxAnim = 7, speed = 1, narrate = false, voice = '', rate = 0,
    audio = null, audioVolume = 0.25, browser = null, snapshots = null, slides = null, quoro = false, onProgress = () => {},
  } = opts;
  const log = onProgress;
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'pptx-video-'));
  let chrome;
  try {
    const deck = await openPptx(input);
    if (!deck.slideCount) throw new Error('The presentation has no slides');
    const W = even(width);
    const H = even((W * deck.size.cy) / deck.size.cx);
    const wanted = (slides ?? Array.from({ length: deck.slideCount }, (_, i) => i + 1)).filter((n) => n >= 1 && n <= deck.slideCount);

    // Quoro AI (optional): its trained role model decides what each element is; its checker reports special words
    let roleOf, scan = null;
    if (quoro) {
      const { loadModel, quoroRoleOf } = await import('../quoro/src/model.js');
      const { compile, scanText, textsOf, loadSpecialWords } = await import('../quoro/src/check.js');
      roleOf = quoroRoleOf(loadModel());
      const rules = compile(loadSpecialWords());
      scan = (m, n) => {
        for (const t of textsOf(m)) for (const f of scanText(t.text, rules)) if (f.severity !== 'info') log(`quoro: slide ${n} [${f.severity}] "${f.match}" in ${t.where}: ${f.why}`);
      };
      log('Quoro AI: element roles from the trained model');
    }

    // 1. parse + plan
    const plans = [];
    for (const n of wanted) {
      const model = await extractSlide(deck, n - 1, { width: W });
      model.height = H;
      for (const w of model.warnings) log(`warning: ${w}`);
      scan?.(model, n);
      let narrationDur = 0, wav = null;
      if (narrate && model.notes) {
        wav = path.join(tmp, `narration-${n}.wav`);
        log(`slide ${n}: narrating speaker notes`);
        narrationDur = await synthesize(model.notes, wav, tmp, { voice, rate });
      }
      const plan = planSlide(model, { maxAnim, slideDuration, narrationDur, speed, style, camera, transition, roleOf });
      plans.push({ n, model, plan, wav, narrationDur });
    }
    const total = plans.reduce((a, p) => a + p.plan.duration, 0);
    log(`${plans.length} slide(s), ${total.toFixed(1)}s, ${W}x${H}@${fps}fps, style: ${style}`);

    // 2. audio track
    let narrationTrack = null;
    if (plans.some((p) => p.wav)) {
      const parts = [];
      for (const p of plans) {
        const seg = path.join(tmp, `seg-${p.n}.wav`);
        const d = p.plan.duration.toFixed(3);
        if (p.wav) await runFfmpeg(['-i', p.wav, '-af', `adelay=450|450,apad=whole_dur=${d}`, '-ar', '44100', '-ac', '2', '-t', d, seg]);
        else await runFfmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', d, seg]);
        parts.push(seg);
      }
      const list = path.join(tmp, 'concat.txt');
      await writeFile(list, parts.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
      narrationTrack = path.join(tmp, 'narration.wav');
      await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', narrationTrack]);
    }

    // 3. encoder
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    const inputs = ['-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
    const T = total.toFixed(3);
    let audioArgs = ['-an'];
    if (narrationTrack && audio) {
      inputs.push('-i', narrationTrack, '-stream_loop', '-1', '-i', audio);
      audioArgs = ['-filter_complex', `[2:a]volume=${audioVolume},afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=0,volume=2[a]`, '-map', '0:v', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k'];
    } else if (narrationTrack) {
      inputs.push('-i', narrationTrack);
      audioArgs = ['-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k'];
    } else if (audio) {
      inputs.push('-stream_loop', '-1', '-i', audio);
      audioArgs = ['-af', `volume=${Math.min(1, audioVolume * 3)},afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5`, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k'];
    }
    const enc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, ...audioArgs, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), '-t', T, '-movflags', '+faststart', path.resolve(output)], { stdio: ['pipe', 'ignore', 'pipe'] });
    let encErr = '';
    enc.stderr.on('data', (d) => (encErr += d));
    const encDone = new Promise((resolve, reject) => enc.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${encErr.trim()}`)))));
    enc.stdin.on('error', () => {}); // surfaced through encDone
    const write = (buf) => (enc.stdin.write(buf) ? Promise.resolve() : new Promise((r) => enc.stdin.once('drain', r)));

    // 4. capture
    chrome = await puppeteer.launch({ executablePath: findBrowser(browser), headless: true, args: ['--hide-scrollbars', '--force-device-scale-factor=1', '--font-render-hinting=none'] });
    const page = await chrome.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    if (snapshots) await mkdir(snapshots, { recursive: true });

    let frameNo = 0;
    const totalFrames = plans.reduce((a, p) => a + Math.ceil(p.plan.duration * fps), 0);
    for (const { n, model, plan } of plans) {
      const intervals = await prepare(page, slideHtml(model), plan.fx);
      if (snapshots) {
        await page.evaluate(seek, Math.max(0, plan.duration - 0.4) * 1000);
        await page.screenshot({ path: path.join(snapshots, `slide-${String(n).padStart(2, '0')}.png`), type: 'png' });
      }
      const nFrames = Math.ceil(plan.duration * fps);
      let lastSig = null, last = null;
      for (let f = 0; f < nFrames; f++) {
        const ms = (f / fps) * 1000;
        const states = intervals.map(([s, e]) => (ms <= s ? 0 : ms >= e ? 2 : 1));
        const sig = states.includes(1) ? null : states.join('');
        if (sig === null || sig !== lastSig || !last) {
          await page.evaluate(seek, ms);
          last = Buffer.from(await page.screenshot({ type: 'jpeg', quality: 96, optimizeForSpeed: true }));
        }
        lastSig = sig;
        await write(last);
        frameNo++;
        if (frameNo % fps === 0) log(`rendering ${Math.round((frameNo / totalFrames) * 100)}%  (slide ${n})`);
      }
    }
    enc.stdin.end();
    await encDone;
    log(`wrote ${path.resolve(output)}`);
    return { output: path.resolve(output), duration: total, slides: plans.length, width: W, height: H };
  } finally {
    await chrome?.close().catch(() => {});
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
