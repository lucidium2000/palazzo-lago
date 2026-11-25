"""
Records the cast's lines with ElevenLabs (tools/voices/eleven-lines.json, made
by `npx tsx scripts/voice-lines.ts`) into public/voices/<voice>/<id>.mp3 and
adds them to public/voices/index.json (alongside the Kokoro takes; the game
prefers a character's ElevenLabs take and falls back to Kokoro).

The API key is NOT in this repo: in a cloud session it is a network secret
injected by the proxy for api.elevenlabs.io (header xi-api-key). Locally, set
ELEVENLABS_API_KEY.

Casting: tools/voices/eleven-cast.json maps each voice ("el_vinnie") to an
ElevenLabs voice_id and voice settings. `--cast` proposes one from the voice
library using the casting briefs in src/client/cast.ts (review it, then render).

  python3 tools/voices/render_eleven.py --quota            # show characters left
  python3 tools/voices/render_eleven.py --cast             # propose voices
  python3 tools/voices/render_eleven.py --priority 1       # render the essentials
  python3 tools/voices/render_eleven.py                    # render everything missing
"""
import argparse, concurrent.futures as cf, json, os, re, subprocess, sys, tempfile, time, urllib.parse, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'voices')
CAST = os.path.join(ROOT, 'tools', 'voices', 'eleven-cast.json')
API = 'https://api.elevenlabs.io'
KEY = os.environ.get('ELEVENLABS_API_KEY', 'proxy-injected')


def call(method, path, body=None, raw=False, tries=6):
    data = json.dumps(body).encode() if body is not None else None
    for i in range(tries):
        req = urllib.request.Request(API + path, data=data, method=method, headers={'xi-api-key': KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' if raw else 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                b = r.read()
                return b if raw else json.loads(b)
        except urllib.error.HTTPError as e:
            msg = e.read()[:300]
            if e.code in (429, 500, 502, 503) and i < tries - 1:
                time.sleep(2 ** i)
                continue
            raise RuntimeError(f'{method} {path}: HTTP {e.code} {msg!r}')


def quota():
    s = call('GET', '/v1/user/subscription')
    return s['character_limit'] - s['character_count'], s


def propose_cast():
    """Suggests a voice per character from the voice library, by their casting brief."""
    src = open(os.path.join(ROOT, 'src', 'client', 'cast.ts')).read()
    briefs = dict(re.findall(r"id: '([a-z_]+)'[^}]*?voiceHint: ['\"]([^'\"]+)['\"]", src, re.S))
    mine = call('GET', '/v2/voices?page_size=100').get('voices', [])
    cast = json.load(open(CAST)) if os.path.exists(CAST) else {}
    used = {c['voice_id'] for c in cast.values()}
    for cid, brief in briefs.items():
        key = 'el_' + cid
        if key in cast:
            continue
        words = set(re.findall(r'[a-z]+', brief.lower()))
        def score(v):
            lab = ' '.join(str(x) for x in (v.get('labels') or {}).values()).lower() + ' ' + (v.get('description') or '').lower() + ' ' + v.get('name', '').lower()
            return sum(1 for w in words if len(w) > 3 and w in lab)
        pool = [v for v in mine if v['voice_id'] not in used]
        try:
            shared = call('GET', '/v1/shared-voices?page_size=30&search=' + urllib.parse.quote(' '.join(sorted(words, key=len, reverse=True)[:4])))['voices']
            pool += [{'voice_id': v['voice_id'], 'name': v['name'], 'labels': {k: v.get(k) for k in ('gender', 'age', 'accent', 'descriptive', 'use_case')}, 'description': v.get('description', ''), 'shared': v.get('public_owner_id')} for v in shared if v['voice_id'] not in used]
        except Exception as e:
            print('shared library search failed:', e)
        best = max(pool, key=score) if pool else None
        if best:
            cast[key] = {'voice_id': best['voice_id'], 'name': best.get('name'), 'brief': brief, 'stability': 0.4, 'similarity_boost': 0.8, 'style': 0.35, **({'public_owner_id': best['shared']} if best.get('shared') else {})}
            used.add(best['voice_id'])
            print(f'{key:16} -> {best.get("name")} ({best["voice_id"]})  brief: {brief}')
    json.dump(cast, open(CAST, 'w'), indent=1)
    print('wrote', CAST, '- review it, then render')


def render_one(line, cast, model):
    v = cast[line['voice']]
    text = line['text']
    if not model.startswith('eleven_v3'):
        text = re.sub(r'\s*\[[^\]]+\]\s*', ' ', text).strip()  # only v3 performs [tags]
    body = {'text': text, 'model_id': model, 'voice_settings': {'stability': v.get('stability', 0.4), 'similarity_boost': v.get('similarity_boost', 0.8), 'style': v.get('style', 0.35), 'use_speaker_boost': True}}
    audio = call('POST', f"/v1/text-to-speech/{v['voice_id']}?output_format=mp3_44100_64", body, raw=True)
    dst = os.path.join(OUT, line['voice'], line['id'] + '.mp3')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
        f.write(audio)
        tmp = f.name
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-af',
                    'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-18:TP=-2:LRA=11,apad=pad_dur=0.05',
                    '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', dst], check=True)
    os.unlink(tmp)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dst], capture_output=True, text=True).stdout.strip() or 0)
    return line, round(dur, 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--quota', action='store_true')
    ap.add_argument('--cast', action='store_true')
    ap.add_argument('--priority', type=int, default=0, help='only lines with priority <= this (1 = essentials)')
    ap.add_argument('--voice', default='', help='only this voice, e.g. el_vinnie')
    ap.add_argument('--model', default='eleven_v3')
    ap.add_argument('--budget', type=float, default=0.9, help='use at most this share of the remaining characters')
    ap.add_argument('--jobs', type=int, default=3)
    a = ap.parse_args()
    if a.quota:
        left, s = quota()
        print(json.dumps({k: s.get(k) for k in ('tier', 'character_count', 'character_limit', 'next_character_count_reset_unix')}), 'left:', left)
        return
    if a.cast:
        return propose_cast()
    cast = json.load(open(CAST))
    lines = json.load(open(os.path.join(ROOT, 'tools', 'voices', 'eleven-lines.json')))
    index_path = os.path.join(OUT, 'index.json')
    index = json.load(open(index_path))['voices'] if os.path.exists(index_path) else {}
    todo = [l for l in lines if l['voice'] in cast and l['id'] not in index.get(l['voice'], {})
            and (not a.priority or l.get('p', 1) <= a.priority) and (not a.voice or l['voice'] == a.voice)]
    todo.sort(key=lambda l: (l.get('p', 1), l['voice']))
    need = sum(len(l['text']) for l in todo)
    left, _ = quota()
    print(f'{len(todo)} lines to record, {need} characters; {left} left on the account')
    if need > left * a.budget:
        cut, n = [], 0
        for l in todo:
            if n + len(l['text']) > left * a.budget:
                break
            cut.append(l)
            n += len(l['text'])
        print(f'over budget: recording the first {len(cut)} lines ({n} characters) by priority')
        todo = cut
    done = 0
    with cf.ThreadPoolExecutor(a.jobs) as ex:
        for fut in cf.as_completed([ex.submit(render_one, l, cast, a.model) for l in todo]):
            try:
                line, dur = fut.result()
            except Exception as e:
                print('failed:', e)
                continue
            index.setdefault(line['voice'], {})[line['id']] = dur
            done += 1
            if done % 25 == 0:
                print(f'{done}/{len(todo)}', flush=True)
                json.dump({'voices': index}, open(index_path, 'w'), separators=(',', ':'))
    json.dump({'voices': index}, open(index_path, 'w'), separators=(',', ':'))
    print('recorded', done)


if __name__ == '__main__':

    sys.exit(main())
