"""Generate the narration lines with Kokoro (local, free) into audio/vo-<scene>.mp3."""
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
import numpy as np
import soundfile as sf
from kokoro import KPipeline

VOICE = sys.argv[1] if len(sys.argv) > 1 else "bf_emma"
SPEED = float(sys.argv[2]) if len(sys.argv) > 2 else 1.05
LINES = {
    "hook": "Using Opus for every prompt? That's overkill.",
    "intro": "Meet auto-model. It picks the model for you.",
    "simple": "Quick question? Haiku answers it.",
    "complex": "Big refactor? Opus takes over.",
    "follow": "Short follow-ups keep the same model, so the cache stays warm.",
    "panel": "Tap the arrow to see the picks, or switch it off.",
    "outro": "Get auto-model from the plugin marketplace.",
}
RATE = 24000

out_dir = Path(__file__).parent / "audio"
out_dir.mkdir(exist_ok=True)
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
pipeline = KPipeline(lang_code="b")
for scene, text in LINES.items():
    chunks = [audio for _, _, audio in pipeline(text, voice=VOICE, speed=SPEED)]
    audio = np.concatenate(chunks)
    wav = out_dir / f"vo-{scene}.wav"
    mp3 = out_dir / f"vo-{scene}.mp3"
    sf.write(wav, audio, RATE)
    # trim leading/trailing silence, normalise loudness, encode mp3
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(wav), "-af",
                    "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
                    "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
                    "loudnorm=I=-16:TP=-1.5", "-ar", "44100", "-b:a", "192k", str(mp3)], check=True)
    wav.unlink()
    print(f"{scene:8s} {len(audio) / RATE:5.2f}s  {text}")
