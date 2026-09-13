"""Check mathematical examples, subtitle alignment, and final media streams."""
import json
from pathlib import Path
import subprocess
import sys
from fractions import Fraction

import numpy as np
import srt

HERE = Path(__file__).resolve().parent
data = json.loads((HERE / 'data/compiler.json').read_text())
w = np.array(data['parity']['dense'], dtype=np.int64)
assert w.shape == (6, 6)
for n in range(129):
    x = np.array([n, 0, 0, 0, 0, 1], dtype=np.int64)
    for tick in range(1, n//2+3):
        x = np.maximum(w @ x, 0)
        if x[4]:
            break
    assert tick == n//2+2
    assert x[4] == 1 and x[3] == int(n % 2 == 0)
for key in ['even', 'odd']:
    steps = data['parity'][key]
    for before, after in zip(steps, steps[1:]):
        raw = w @ np.array(before['state'])
        assert raw.tolist() == after['raw']
        assert np.maximum(raw, 0).tolist() == after['state'] == after['candidate']
assert data['prime']['unoptimized']['size'] == len(data['prime']['unoptimized']['rows'])
assert all(value is False for value in data['prime']['disabled'].values())
assert data['prime']['composite']['result'] == 0 and data['prime']['prime']['result'] == 1
assert data['factorial']['resultAt4'] == 24

timeline = json.loads((HERE / 'output/timeline.json').read_text())
subtitles = list(srt.parse((HERE / 'output/matrix-programming.srt').read_text()))
assert len(subtitles) == len(timeline['cues'])
previous = 0
for index, (subtitle, cue) in enumerate(zip(subtitles, timeline['cues']), 1):
    start, end = subtitle.start.total_seconds(), subtitle.end.total_seconds()
    assert subtitle.index == index and previous <= start < end <= timeline['duration'] + .001
    assert abs(start-cue['start']) <= .001 and abs(end-cue['end']) <= .001
    assert ' '.join(subtitle.content.split()) == ' '.join(cue['text'].split())
    assert len(subtitle.content.splitlines()) <= 2
    previous = end
path = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'output/matrix-programming.mp4'
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-show_chapters', '-of', 'json', str(path)]))
video = next(stream for stream in probe['streams'] if stream['codec_type'] == 'video')
assert video['codec_name'] == 'h264'
assert not any(stream['codec_type'] == 'audio' for stream in probe['streams'])
assert any(stream['codec_type'] == 'subtitle' for stream in probe['streams'])
assert len(probe['chapters']) == len(timeline['chapters'])
for index, (chapter, expected) in enumerate(zip(probe['chapters'], timeline['chapters'])):
    end = timeline['chapters'][index+1]['start'] if index+1 < len(timeline['chapters']) else timeline['duration']
    assert abs(float(chapter['start_time']) - expected['start']) < .002
    assert abs(float(chapter['end_time']) - end) < .002
    assert chapter['tags']['title'] == expected['title']
for stream in probe['streams']:
    if stream['codec_type'] == 'data' and stream['codec_name'] == 'bin_data':
        assert abs(float(stream['duration']) - timeline['duration']) < .25
assert abs(float(probe['format']['duration']) - timeline['duration']) < .25
if 'preview' not in path.name:
    assert (video['width'], video['height']) == (1920, 1080)
    # Manim concatenates independently encoded clips; container duration can
    # differ by a few timebase ticks from the exact nominal frame count.
    assert video['r_frame_rate'] == '30/1'
    assert abs(float(Fraction(video['avg_frame_rate'])) - 30) < .001
    assert min(c.end.total_seconds()-c.start.total_seconds() for c in subtitles) >= 1.2
print(f"PASS: parity 0..128; exported traces; {len(subtitles)} synchronized cues; {len(probe['chapters'])} chapters; H.264 {video['width']}×{video['height']}; no audio.")
