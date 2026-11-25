"""
Records every line in tools/voices/lines.json with Kokoro-82M (Apache-2.0,
hexgrad/Kokoro-82M, ONNX build onnx-community/Kokoro-82M-v1.0-ONNX) and writes:

  public/voices/<voice>/<id>.mp3   mono, loudness-normalised, silence trimmed
  public/voices/index.json         {"voices": {voice: {id: seconds}}}

Re-runs only render lines that are missing. Needs: pip install kokoro-onnx soundfile
numpy huggingface_hub, plus ffmpeg on PATH.

  python3 tools/voices/render.py [--limit N]
"""
import argparse, json, os, subprocess, sys, tempfile
import numpy as np
import soundfile as sf
from huggingface_hub import hf_hub_download

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX'
OUT = os.path.join(ROOT, 'public', 'voices')


def load_voices(names):
    """Builds the voices file kokoro-onnx expects (an .npz of 510x1x256 style tables)."""
    tables = {}
    for n in names:
        raw = np.fromfile(hf_hub_download(REPO, f'voices/{n}.bin'), dtype=np.float32)
        tables[n] = raw.reshape(-1, 1, 256)
    path = os.path.join(tempfile.gettempdir(), 'kokoro-voices.npz')
    np.savez(path, **tables)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()
    from kokoro_onnx import Kokoro

    lines = json.load(open(os.path.join(ROOT, 'tools', 'voices', 'lines.json')))
    if args.limit:
        lines = lines[: args.limit]
    names = sorted({l['voice'] for l in lines})
    model = hf_hub_download(REPO, 'onnx/model.onnx')
    tts = Kokoro(model, load_voices(names))

    index_path = os.path.join(OUT, 'index.json')
    index = json.load(open(index_path))['voices'] if os.path.exists(index_path) else {}
    wanted = {(l['voice'], l['id']) for l in lines}
    done = 0
    for i, l in enumerate(lines):
        v, lid = l['voice'], l['id']
        dst = os.path.join(OUT, v, lid + '.mp3')
        if os.path.exists(dst) and lid in index.get(v, {}):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        lang = 'en-gb' if v.startswith('b') else 'en-us'
        samples, sr = tts.create(l.get('say', l['text']), voice=v, speed=l.get('speed', 1.0), lang=lang)
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            wav = f.name
        sf.write(wav, samples, sr)
        # Trim leading/trailing silence, even out loudness, encode small.
        subprocess.run([
            'ffmpeg', '-y', '-loglevel', 'error', '-i', wav,
            '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-18:TP=-2:LRA=11,apad=pad_dur=0.05',
            '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '40k', dst,
        ], check=True)
        os.unlink(wav)
        dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dst], capture_output=True, text=True).stdout.strip() or 0)
        index.setdefault(v, {})[lid] = round(dur, 2)
        done += 1
        if done % 25 == 0:
            print(f'{i + 1}/{len(lines)}', flush=True)
            json.dump({'voices': index}, open(index_path, 'w'), separators=(',', ':'))
    # Drop clips for lines that no longer exist.
    if not args.limit:
        for v in [v for v in list(index) if v in names]:  # only Kokoro voices (ElevenLabs takes live alongside)
            for lid in list(index[v]):
                if (v, lid) not in wanted:
                    del index[v][lid]
                    p = os.path.join(OUT, v, lid + '.mp3')
                    if os.path.exists(p):
                        os.unlink(p)
    os.makedirs(OUT, exist_ok=True)
    json.dump({'voices': index}, open(index_path, 'w'), separators=(',', ':'))
    print('rendered', done, 'total', sum(len(x) for x in index.values()))


if __name__ == '__main__':
    sys.exit(main())
