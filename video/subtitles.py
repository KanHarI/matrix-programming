"""Readable captions derived from the actual Manim beat timestamps."""
import textwrap


def caption_lines(text):
    return textwrap.wrap(text, 56, break_long_words=False, break_on_hyphens=False)


def build_captions(beats):
    captions = []
    for beat in beats:
        lines = caption_lines(beat['text'])
        chunks = [' '.join(lines[i:i+2]) for i in range(0, len(lines), 2)]
        # Do not leave a one-word final cue on screen for a fraction of a second.
        # Rebalance the final two chunks while preserving the two-line limit.
        if len(chunks) > 1 and len(chunks[-1]) < 40:
            words = (chunks[-2] + ' ' + chunks[-1]).split()
            candidates = [(' '.join(words[:i]), ' '.join(words[i:])) for i in range(1, len(words))]
            candidates = [(a, b) for a, b in candidates if len(caption_lines(a)) <= 2 and len(caption_lines(b)) <= 2]
            if candidates:
                chunks[-2:] = min(candidates, key=lambda pair: abs(len(pair[0])-len(pair[1])))
        total = sum(len(chunk) for chunk in chunks)
        consumed = 0
        for chunk in chunks:
            start = beat['start'] + (beat['end']-beat['start'])*consumed/total
            consumed += len(chunk)
            end = beat['start'] + (beat['end']-beat['start'])*consumed/total
            captions.append({'start': start, 'end': end, 'text': chunk})
    return captions


def stamp(seconds):
    ms = round(seconds * 1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'


def to_srt(captions):
    return '\n\n'.join(f"{i}\n{stamp(c['start'])} --> {stamp(c['end'])}\n" + '\n'.join(caption_lines(c['text'])) for i, c in enumerate(captions, 1)) + '\n'
