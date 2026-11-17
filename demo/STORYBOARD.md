# auto-model demo: 9:16, 29.4 s at 100 BPM (each cut on a beat)

| # | Time | On screen | Headline | Voiceover / caption |
|---|---|---|---|---|
| 1 | 0.0–4.8 | Opus / Sonnet / Haiku circles with $$$ / $$ / $, then a "That's overkill." pill | Opus for every prompt? | Using Opus for every prompt? That's overkill. |
| 2 | 4.8–7.8 | Icon spins in, then the name and tagline | auto-model | Meet auto-model. It picks the model for you. |
| 3 | 7.8–12.6 | Terminal: "what does ls -la print?" is typed and sent, the footer turns `◆ haiku ▲` (green), pill "simple → haiku" | Quick question → Haiku | Quick question? Haiku answers it. |
| 4 | 12.6–17.4 | A long refactor prompt is typed, the footer turns `◆ opus ▲` (orange), pill "complex → opus" | Big task → Opus | Big refactor? Opus takes over. |
| 5 | 17.4–21.0 | "yes do it", the footer stays on opus, pill "short reply → keeps opus · cache stays warm" | Follow-up? Same model | Short follow-ups keep the same model, so the cache stays warm. |
| 6 | 21.0–25.8 | Cursor clicks ▲, the panel opens with bars; it clicks "● on" and the footer shows `◇ auto off ▲` | See it. Switch it. | Tap the arrow to see the picks, or switch it off. |
| 7 | 25.8–29.4 | Icon, the install command and the GitHub link | auto-model | Get auto-model from the plugin marketplace. |

## Render

    cd demo
    npm install
    pip install imageio-ffmpeg        # gives a static ffmpeg build
    node render.mjs                   # writes out/auto-model-demo.mp4

Optional audio goes in `demo/audio/`:
- `vo-hook.mp3`, `vo-intro.mp3`, `vo-simple.mp3`, `vo-complex.mp3`, `vo-follow.mp3`, `vo-panel.mp3`, `vo-outro.mp3` hold one narration line each, from the table above.
- `music.mp3` is a music bed. It is mixed at 16% volume with fades.

When all seven narration files are there, each scene is stretched to its narration length (0.2 s lead, 0.45 s tail) and the captions follow the real timing. To preview a single frame, open `index.html?t=12.5` in Chrome.

## Narration (free, local)

    python3 -m venv .venv && .venv/bin/pip install kokoro soundfile imageio-ffmpeg
    .venv/bin/python tts.py bf_emma 1.05     # voice, speed → audio/vo-*.mp3
    node render.mjs

Other British voices to try: `bf_isabella`, `bf_alice`, `bf_lily`, `bm_george`, `bm_lewis`, `bm_daniel`.

## Music (original, generated)

`render.mjs` runs `synth.py`, which writes `audio/synth-music.wav` and `audio/synth-sfx.wav`. The track is in D major at 100 BPM, with chords D–A–Bm–G.
- **Hook:** pad, arpeggio and sub-bass, with the filter opening as it builds. Soft hi-hats come in during the last bar, and a swell leads into the intro.
- **Intro:** the groove (kick, claps, hi-hats, bass, a pumping effect) ramps in over one bar.
- **Panel scene:** breakdown.
- **Outro:** the groove returns.

Sound effects play on screen events: typing, enter, model switches, clicks and whooshes into each cut. The effects are not ducked; the music is ducked under the narration. `MUSIC=audio/music.mp3 node render.mjs` uses your own track instead.
