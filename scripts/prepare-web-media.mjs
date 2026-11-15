// 브라우저에서 재생되지 않는 영상(ProRes·MJPEG·4K 등)을 웹용 H.264 mp4로 변환한다. 원본은 건드리지 않는다.
// 사용법: node scripts/prepare-web-media.mjs <원본 폴더> <출력 폴더>
import { readdir, mkdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [source, target] = process.argv.slice(2).map((value) => (value ? resolve(value) : ''));
if (!source || !target) { console.error('사용법: node scripts/prepare-web-media.mjs <원본 폴더> <출력 폴더>'); process.exit(2); }
const VIDEO = new Set(['.mov', '.mp4', '.m4v', '.webm']);
const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.aac']);

function probe(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const seconds = Number.parseFloat(result.stdout);
  return Number.isFinite(seconds) ? seconds : null;
}

await mkdir(target, { recursive: true });
const manifest = [];
for (const name of (await readdir(source)).sort()) {
  const ext = extname(name).toLowerCase();
  if (!VIDEO.has(ext) && !AUDIO.has(ext)) continue;
  const input = join(source, name);
  const stem = basename(name, extname(name));
  const outName = AUDIO.has(ext) ? name : `${stem}.mp4`;
  const output = join(target, outName);
  if (AUDIO.has(ext)) {
    spawnSync('cp', [input, output]);
  } else {
    // 음원 없는 배경 영상으로 만든다. 가로 1920 이하, yuv420p·faststart로 브라우저 스트리밍·구간 이동을 지원한다.
    const run = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-map', '0:v:0', '-an', '-vf', "scale='min(1920,iw)':-2,format=yuv420p", '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-movflags', '+faststart', output], { encoding: 'utf8' });
    if (run.status !== 0) { console.error(`변환 실패: ${name}\n${run.stderr}`); process.exitCode = 1; continue; }
  }
  const info = await stat(output);
  manifest.push({ source: name, file: outName, seconds: probe(output), bytes: info.size });
  console.log(`${name} -> ${outName} (${(info.size / 1048576).toFixed(1)}MB, ${probe(output)?.toFixed(1)}s)`);
}
console.log(JSON.stringify(manifest));
