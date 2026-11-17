// Renders index.html frame by frame with headless Chrome and encodes a 1080x1920 MP4.
// If audio/vo-<scene>.mp3 files exist, each scene is stretched to fit its narration
// and the narration (plus audio/music.mp3, if present) is mixed in.
import { chromium } from 'playwright-core'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const FFMPEG = process.env.FFMPEG || execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim()
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const FPS = Number(process.env.FPS || 30)
const DIR = path.dirname(new URL(import.meta.url).pathname)
const OUT = path.join(DIR, 'out')
const IDS = ['hook', 'intro', 'simple', 'complex', 'follow', 'panel', 'outro']
const LEAD = 0.2
const TAIL = 0.45

function duration(file) {
  const r = spawnSyncStderr(FFMPEG, ['-i', file])
  const m = r.match(/Duration: (\d+):(\d+):([\d.]+)/)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function spawnSyncStderr(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    return ''
  } catch (e) {
    return e.stderr.toString()
  }
}

mkdirSync(OUT, { recursive: true })

// Scene lengths: the default, or narration + lead + tail when that is longer.
const vo = IDS.map(id => path.join(DIR, 'audio', `vo-${id}.mp3`))
const hasVo = vo.every(f => existsSync(f))
const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })
const base = pathToFileURL(path.join(DIR, 'index.html')).href
await page.goto(base)
const defaults = await page.evaluate(() => window.SCENES.map(s => s.dur))
let durs = defaults
let speech = []
if (hasVo) {
  speech = vo.map(duration)
  durs = speech.map((d, i) => Math.max(defaults[i], +(d + LEAD + TAIL).toFixed(2)))
}
// Snap every scene to whole beats so the cuts land on the music (BPM=0 turns it off).
const BPM = Number(process.env.BPM ?? 100)
if (BPM > 0) {
  const beat = 60 / BPM
  durs = durs.map((d, i) => {
    const need = hasVo ? speech[i] + LEAD + 0.15 : 0
    const beats = Math.max(Math.round(d / beat), Math.ceil(need / beat))
    return +(beats * beat).toFixed(4)
  })
}
const speechQuery = hasVo ? `&speech=${speech.map(d => d.toFixed(2)).join(',')}` : ''
await page.goto(`${base}?durs=${durs.join(',')}${speechQuery}`)
await page.waitForLoadState('networkidle')
const total = await page.evaluate(() => window.TOTAL)
console.log(`scenes: ${durs.join(' + ')} = ${total.toFixed(2)}s ${hasVo ? '(timed to narration)' : '(default timing, no narration found)'}`)

const silent = path.join(OUT, 'video-silent.mp4')
const enc = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', '-color_range', 'tv', '-movflags', '+faststart', silent],
  { stdio: ['pipe', 'inherit', 'inherit'] })
const frames = Math.round(total * FPS)
for (let f = 0; f < frames; f++) {
  await page.evaluate(t => window.render(t), f / FPS)
  const buf = await page.screenshot({ type: 'jpeg', quality: 95 })
  if (!enc.stdin.write(buf)) {
    await new Promise(r => enc.stdin.once('drain', r))
  }
  if (f % 90 === 0) {
    process.stdout.write(`\rframe ${f}/${frames}`)
  }
}
enc.stdin.end()
await new Promise(r => enc.on('close', r))
await browser.close()
console.log(`\nsilent video: ${silent}`)

const final = path.join(OUT, 'auto-model-demo.mp4')
if (!hasVo) {
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', silent, '-c', 'copy', final])
  console.log(`final (no audio): ${final}`)
  process.exit(0)
}

// Mix: each narration line at its scene start + LEAD; music underneath, ducked and faded.
const starts = []
let acc = 0
for (const d of durs) {
  starts.push(acc)
  acc += d
}
const args = ['-y', '-loglevel', 'error', '-i', silent]
vo.forEach(f => args.push('-i', f))
// MUSIC=synth (default) makes the original track with synth.py; MUSIC=<file> uses that file instead.
const MUSIC = process.env.MUSIC || 'synth'
let music = MUSIC === 'synth' ? null : path.resolve(MUSIC)
let sfx = null
if (MUSIC === 'synth') {
  const timing = path.join(OUT, 'timing.json')
  writeFileSync(timing, JSON.stringify({ bpm: BPM || 100, ids: IDS, durs, starts, total }))
  const py = existsSync(path.join(DIR, '.venv/bin/python')) ? path.join(DIR, '.venv/bin/python') : 'python3'
  execFileSync(py, [path.join(DIR, 'synth.py'), timing, path.join(DIR, 'audio')], { stdio: 'inherit' })
  music = path.join(DIR, 'audio', 'synth-music.wav')
  sfx = path.join(DIR, 'audio', 'synth-sfx.wav')
}
const hasMusic = music !== null && existsSync(music)
if (hasMusic) {
  args.push('-stream_loop', '-1', '-i', music)
}
if (sfx) {
  args.push('-i', sfx)
}
const parts = []
const labels = []
vo.forEach((_, i) => {
  const ms = Math.round((starts[i] + LEAD) * 1000)
  parts.push(`[${i + 1}:a]adelay=${ms}|${ms},aformat=sample_rates=44100:channel_layouts=stereo[v${i}]`)
  labels.push(`[v${i}]`)
})
parts.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0[voice]`)
if (hasMusic) {
  const m = vo.length + 1
  // Music is loudness-normalised, then set at 20% between lines and is ducked (sidechain) under the narration.
  parts.push(`[voice]asplit=2[vmain][vkey]`)
  parts.push(`[${m}:a]atrim=0:${total},${sfx ? 'volume=0.18' : 'loudnorm=I=-16:TP=-1.5,volume=0.2'},afade=t=in:d=0.5,afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2,aformat=sample_rates=44100:channel_layouts=stereo[bg]`)
  parts.push(`[bg][vkey]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[duck]`)
  if (sfx) {
    // effects are not ducked: they mark on-screen events and sit between the words
    parts.push(`[${m + 1}:a]volume=0.32,aformat=sample_rates=44100:channel_layouts=stereo[fx]`)
    parts.push(`[vmain][duck][fx]amix=inputs=3:normalize=0,alimiter=limit=0.95[mix]`)
  } else {
    parts.push(`[vmain][duck]amix=inputs=2:normalize=0,alimiter=limit=0.95[mix]`)
  }
} else {
  parts.push(`[voice]alimiter=limit=0.95[mix]`)
}
args.push('-filter_complex', parts.join(';'), '-map', '0:v', '-map', '[mix]',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(total), '-movflags', '+faststart', final)
execFileSync(FFMPEG, args)
console.log(`final: ${final}`)
