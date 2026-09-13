"""Render and package a silent H.264 video with timed, selectable subtitles."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from subtitles import build_captions, to_srt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview', action='store_true', help='480p15, eight-times speed for visual review')
    parser.add_argument('--chapter', type=int, choices=range(1, 14), help='Render one chapter only')
    parser.add_argument('--skip-export', action='store_true')
    parser.add_argument('--package-only', action='store_true', help='Rebuild captions and remux the most recent render without rerendering scenes')
    args = parser.parse_args()
    if not args.skip_export and not args.package_only:
        subprocess.run(['node', 'video/export-data.mjs'], cwd=ROOT, check=True)
    output = HERE / 'output'
    output.mkdir(exist_ok=True)
    env = os.environ.copy()
    env['MATRIX_VIDEO_SPEED'] = '8' if args.preview else '1'
    if args.chapter:
        env['MATRIX_VIDEO_CHAPTER'] = str(args.chapter)
    else:
        env.pop('MATRIX_VIDEO_CHAPTER', None)
    if not args.package_only:
        subprocess.run([
            sys.executable, '-m', 'manim', str(HERE / 'matrix_programming.py'), 'MatrixProgramming',
            '--media_dir', str(HERE / 'media'), '--output_file', 'lesson',
            '--resolution', '854,480' if args.preview else '1920,1080',
            '--fps', '15' if args.preview else '30', '--renderer', 'cairo',
            '--disable_caching', '--progress_bar', 'none', '--verbosity', 'WARNING',
        ], cwd=ROOT, env=env, check=True)
    candidates = list((HERE / 'media' / 'videos').rglob('lesson.mp4'))
    if not candidates:
        raise RuntimeError('Manim did not produce lesson.mp4')
    rendered = max(candidates, key=lambda p: p.stat().st_mtime_ns)
    timeline = json.loads((output / 'timeline.json').read_text())
    timeline['cues'] = build_captions(timeline['beats'])
    (output / 'timeline.json').write_text(json.dumps(timeline, indent=2) + '\n')
    (output / 'matrix-programming.srt').write_text(to_srt(timeline['cues']))
    metadata = [';FFMETADATA1', 'title=From a program to a matrix', 'artist=Matrix Programming project', 'comment=Silent Manim lesson. Select the English subtitle track.']
    for index, chapter in enumerate(timeline['chapters']):
        end = timeline['chapters'][index+1]['start'] if index+1 < len(timeline['chapters']) else timeline['duration']
        metadata.extend(['[CHAPTER]', 'TIMEBASE=1/1000', f"START={round(chapter['start']*1000)}", f"END={round(end*1000)}", f"title={chapter['title']}"])
    meta = output / 'chapters.ffmetadata'
    meta.write_text('\n'.join(metadata) + '\n')
    target = output / ('matrix-programming-preview.mp4' if args.preview else 'matrix-programming.mp4')
    subprocess.run([
        'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(rendered),
        '-i', str(output / 'matrix-programming.srt'), '-i', str(meta),
        '-map', '0:v:0', '-map', '1:0', '-map_metadata', '2', '-map_chapters', '2',
        '-c:v', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
        '-disposition:s:0', 'default', '-an', '-video_track_timescale', '30000',
        '-movie_timescale', '1000', '-movflags', '+faststart', str(target),
    ], check=True)
    print(f"\nVideo: {target}\nSRT: {output / 'matrix-programming.srt'}\nDuration: {timeline['duration']:.2f}s; {len(timeline['cues'])} cues; {len(timeline['chapters'])} chapters")


if __name__ == '__main__':
    main()
