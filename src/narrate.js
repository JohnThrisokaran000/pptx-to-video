import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Optional narration of speaker notes with the Windows built-in speech engine (System.Speech) - no API key needed.

const PS = `
param([string]$TextPath, [string]$OutPath, [string]$Voice, [int]$Rate)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($Voice) { try { $s.SelectVoice($Voice) } catch { Write-Error "Voice not found: $Voice"; exit 2 } }
$s.Rate = $Rate
$s.SetOutputToWaveFile($OutPath)
$s.Speak([IO.File]::ReadAllText($TextPath, [Text.Encoding]::UTF8))
$s.Dispose()
`;

export async function synthesize(text, outWav, dir, { voice = '', rate = 0 } = {}) {
  if (process.platform !== 'win32') throw new Error('--narrate currently uses the Windows speech engine and only works on Windows');
  const script = path.join(dir, 'tts.ps1');
  const txt = path.join(dir, `${path.basename(outWav, '.wav')}.txt`);
  await writeFile(script, PS);
  await writeFile(txt, text, 'utf8');
  await new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-TextPath', txt, '-OutPath', outWav, '-Voice', voice, '-Rate', String(rate)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`speech synthesis failed: ${err.trim() || `exit ${code}`}`))));
  });
  return wavDuration(outWav);
}

export async function wavDuration(file) {
  const b = await readFile(file);
  let o = 12, byteRate = 0;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') byteRate = b.readUInt32LE(o + 16);
    if (id === 'data') return byteRate ? Math.min(size, b.length - o - 8) / byteRate : 0;
    o += 8 + size + (size % 2);
  }
  return 0;
}
