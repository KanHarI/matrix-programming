# From a program to a matrix

A silent Manim lesson with a dark mathematical canvas, color-coded coordinates,
animated circuit/control-flow diagrams, a rotating clock, and a recursive
activation-bank walkthrough. This is an original project explainer, not a
3Blue1Brown production or an imitation of its narration/branding.

The opening shows the literal 6×6 matrix and **every multiply, ReLU result,
and commit for inputs 4 and 5**, stopping only when END is set. The remaining
chapters build the unoptimized compiler's mechanisms and run its actual
primality matrix. An actual writeback row is shown with its exported indices.

## Deliverables

After rendering, `output/` contains:

- `matrix-programming.mp4`: 1920×1080, 30fps, H.264; no audio. Includes optional
  English subtitles and chapter markers.
- `matrix-programming.srt`: the same subtitles as a separate UTF-8 file.
- `transcript.md`: editable/readable lesson transcript with chapter timestamps.
- `timeline.json`: precise animation-derived cue and chapter timings.

The MP4 subtitle track is selectable, not burned into the picture. If a player
does not show it, load the adjacent SRT. Turn off one track if a player loads
both. Source and verified compiler data are kept here; large renders and the
isolated Python environment are ignored by git.

## Render

From the repository root, install Node dependencies and build the WASM kernel,
then create a separate Python environment:

```sh
npm ci
npm run wasm
uv venv --python 3.13 .venv-video
uv pip install --python .venv-video/bin/python -r video/requirements.txt
.venv-video/bin/python video/render.py
.venv-video/bin/python video/check.py
.venv-video/bin/python -m unittest video.test_typography
```

FFmpeg must be on PATH. Manim uses Cairo/Pango; macOS installations may need
`brew install pango cairo pkg-config ffmpeg`. See the official
[Manim installation guide](https://docs.manim.community/en/stable/installation.html)
and [text-rendering guide](https://docs.manim.community/en/stable/guides/using_text.html).
The scene uses Pango text and native vector brackets, not `MathTex`, so a LaTeX
distribution is not required. It was rendered using Arial, Menlo, and STIX
Two Math; other systems may substitute fonts and should recheck layout.

For a fast 480p15, eight-times-speed layout preview:

```sh
.venv-video/bin/python video/render.py --preview
.venv-video/bin/python video/check.py video/output/matrix-programming-preview.mp4
```

`--chapter 6` renders only the clock section. Preview/partial renders overwrite
the SRT and timeline, so render the full version last to restore matching final
deliverables. Manim partial-movie cache files live under `media/`.

## Accuracy and scope

`export-data.mjs` imports the actual TypeScript compiler and runtime through
Vite. It exports the six parity rows and exact before/after-ReLU vectors; actual
unoptimized primality checkpoints; matrix sizes and weights under three compiler
configurations; and recursive-function metadata. It asserts the demonstrated
results. No hand-built primality matrix is substituted into the compiler.

The lesson explains the unoptimized translation throughout. Optimization is
mentioned only in two closing sentences, without size comparisons or a tour
of flags. The six-coordinate parity example is the starting circuit.

The lesson distinguishes:

- Parity's clock-free 6×6 recurrence and delayed result/end protocol.
- u32 state, signed-i32 weights, exact checked-i64 accumulation, and overflow
  faults rather than wraparound.
- Conceptual staged gates versus simultaneous evaluation of all actual rows.
- The general backend's 11-update instruction period, not a wall-clock timer.
- Shared ordinary function bodies versus bounded recursive activation banks.
  The current recursive implementation duplicates body circuitry per depth;
  it is not an unbounded dynamically indexed stack.
- Mathematical block parallelism versus physical CPU parallelism.
- Host I/O latches and the host framebuffer versus compiled matrix coordinates.
- The unchanged simple primality algorithm and its general-purpose clocked
  construction. The exported build has **all 21 optimization flags false**;
  the fully unoptimized compiler currently produces **1536×1536**,
  with **2775 nonzero weights**. The final heatmap is generated from those
  exact rows. Tiny weights may be visually lost when the full raster is scaled.

All subtitles are timed from Manim's actual scene clock. Changing an animation
duration regenerates the SRT automatically. The rendering never adds audio.
Long narration beats are split into two-line subtitle cues without splitting
hyphenated words. Subscripts are positioned with Pango markup, avoiding missing
Unicode subscript glyphs; code indentation is laid out explicitly.
Small text is shaped at four times its display size and scaled as vector
outlines for smoother spacing. Labels use a higher-contrast neutral color, and
there is no persistent footer competing with the subtitles.
