import { spawn } from 'child_process';
import { accessSync, constants } from 'fs';
import { copyFile, rm } from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';

const nodeRequire = createRequire(import.meta.url);

let cachedFfmpeg: string | null = null;
let cachedFfprobe: string | null = null;

function isUsableBin(candidate: string | null | undefined): candidate is string {
  if (!candidate) return false;
  if (candidate.includes('/.next/') || candidate.includes('vendor-chunks')) return false;
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getFfmpegBin(): string {
  if (cachedFfmpeg) return cachedFfmpeg;

  const fromPkg = nodeRequire('ffmpeg-static') as string | null;
  if (isUsableBin(fromPkg)) {
    cachedFfmpeg = fromPkg;
    return cachedFfmpeg;
  }

  const candidates = [
    path.join(process.cwd(), 'node_modules/ffmpeg-static/ffmpeg'),
    path.join(process.cwd(), 'node_modules/ffmpeg-static/ffmpeg.exe'),
  ];
  for (const c of candidates) {
    if (isUsableBin(c)) {
      cachedFfmpeg = c;
      return cachedFfmpeg;
    }
  }

  throw new Error('ffmpeg nao disponivel nesta plataforma.');
}

function getFfprobeBin(): string {
  if (cachedFfprobe) return cachedFfprobe;

  const fromPkg = nodeRequire('ffprobe-static') as { path?: string };
  if (isUsableBin(fromPkg?.path)) {
    cachedFfprobe = fromPkg.path;
    return cachedFfprobe;
  }

  const platform = process.platform;
  const arch = process.arch;
  const candidates = [
    path.join(process.cwd(), 'node_modules/ffprobe-static/bin', platform, arch, 'ffprobe'),
    path.join(process.cwd(), 'node_modules/ffprobe-static/bin', platform, arch, 'ffprobe.exe'),
    path.join(process.cwd(), 'node_modules/ffprobe-static/ffprobe'),
  ];
  for (const c of candidates) {
    if (isUsableBin(c)) {
      cachedFfprobe = c;
      return cachedFfprobe;
    }
  }

  throw new Error('ffprobe nao disponivel nesta plataforma.');
}

function runCommand(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `Comando falhou (codigo ${code})`));
    });
  });
}

export async function getMediaDurationSeconds(filePath: string): Promise<number> {
  const out = await runCommand(getFfprobeBin(), [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('Nao foi possivel ler a duracao do arquivo de midia.');
  }
  return seconds;
}

export async function trimVideo(inputPath: string, outputPath: string, maxSeconds: number): Promise<void> {
  await runCommand(getFfmpegBin(), [
    '-y',
    '-i',
    inputPath,
    '-t',
    String(maxSeconds),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

export async function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  await runCommand(getFfmpegBin(), [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-acodec',
    'libmp3lame',
    '-q:a',
    '2',
    outputPath,
  ]);
}

function buildAtempoChain(ratio: number): string {
  const filters: string[] = [];
  let r = ratio;
  while (r > 2.0) {
    filters.push('atempo=2.0');
    r /= 2.0;
  }
  while (r < 0.5) {
    filters.push('atempo=0.5');
    r /= 0.5;
  }
  filters.push(`atempo=${r.toFixed(4)}`);
  return filters.join(',');
}

/** Ajusta a duracao do audio para coincidir com o alvo (preserva sync do video). */
export async function matchAudioDuration(
  inputPath: string,
  outputPath: string,
  targetSeconds: number
): Promise<void> {
  const current = await getMediaDurationSeconds(inputPath);
  if (Math.abs(current - targetSeconds) < 0.04) {
    await copyFile(inputPath, outputPath);
    return;
  }
  const ratio = current / targetSeconds;
  const filter = buildAtempoChain(ratio);
  await runCommand(getFfmpegBin(), ['-y', '-i', inputPath, '-filter:a', filter, outputPath]);
}

export async function muxVideoWithAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<void> {
  await runCommand(getFfmpegBin(), [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    outputPath,
  ]);
}

export async function cleanupWorkDir(workDir: string) {
  try {
    await rm(workDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
