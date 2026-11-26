"""
Prepares the ElevenLabs music and sound effects in tools/audio/src/ for the game:
loudness-normalises and encodes them into public/audio/, and measures each music
track's tempo, first-beat offset and per-bar energy (drums vs tonal, via
harmonic/percussive separation) into public/audio/index.json, so the game can
follow the music (beat clock, lights, dancers) instead of a fixed arrangement.

  pip install librosa soundfile numpy   (and ffmpeg on PATH)
  python3 tools/audio/analyze_music.py
"""
import json, os, subprocess, sys, tempfile
import numpy as np, soundfile as sf, librosa

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC, OUT = os.path.join(ROOT, 'tools', 'audio', 'src'), os.path.join(ROOT, 'public', 'audio')
META = json.load(open(os.path.join(ROOT, 'tools', 'audio', 'tracks.json')))


def encode(name, m):
    ch, br = ('2', '128k') if m.get('stereo') else ('1', '96k')
    dst = os.path.join(OUT, name + '.mp3')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', os.path.join(SRC, name + '.mp3'), '-af', f"loudnorm=I={m.get('lufs', -16)}:TP=-1.5:LRA=11",
                    '-ac', ch, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', br, dst], check=True)
    return dst


def analyze(path, bpm):
    with tempfile.NamedTemporaryFile(suffix='.wav') as w:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', '22050', w.name], check=True)
        y, sr = sf.read(w.name, dtype='float32')
    _, bt = librosa.beat.beat_track(y=y, sr=sr, start_bpm=bpm, units='time', tightness=400)
    n = np.concatenate([[0], np.cumsum(np.round(np.diff(bt) / (60 / bpm)))])
    a, b = np.polyfit(n, bt, 1)
    beat = float(a); first = float(b % beat)  # phase of the beat grid
    res = bt - (a * n + b)
    yh, yp = librosa.effects.hpss(y, margin=3.0)
    bar = 4 * beat; bars = int(round((len(y) / sr) / bar))
    db = lambda s: round(float(20 * np.log10(np.sqrt((s ** 2).mean()) + 1e-9)), 1) if len(s) else -90.0
    per = [{'drums': db(yp[int((first + i * bar) * sr):int((first + (i + 1) * bar) * sr)]),
            'tonal': db(yh[int((first + i * bar) * sr):int((first + (i + 1) * bar) * sr)]),
            'level': db(y[int((first + i * bar) * sr):int((first + (i + 1) * bar) * sr)])} for i in range(bars)]
    return {'seconds': round(len(y) / sr, 3), 'bpm': round(60 / beat, 3), 'firstBeat': round(first, 3), 'bars': bars,
            'beatJitterMs': round(float(1000 * np.sqrt((res ** 2).mean())), 1), 'perBar': per}


def main():
    os.makedirs(OUT, exist_ok=True)
    index = {}
    for name, m in META.items():
        dst = encode(name, m)
        e = {k: v for k, v in m.items() if k not in ('stereo', 'lufs')}
        if m.get('kind') == 'music':
            e.update(analyze(dst, m['bpm']))
        else:
            e['seconds'] = round(float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dst], capture_output=True, text=True).stdout), 3)
        index[name] = e
        print(name, {k: e[k] for k in ('seconds', 'bpm', 'firstBeat', 'bars', 'beatJitterMs') if k in e})
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)


if __name__ == '__main__':
    sys.exit(main())
