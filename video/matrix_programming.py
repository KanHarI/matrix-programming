"""A silent, data-backed Manim lesson. Render with video/render.py.

Typography uses Pango/STIX, so no system LaTeX distribution is required.
All subtitle times come from Scene.time, not a separately estimated script.
"""
from __future__ import annotations

import json
import html
import os
from pathlib import Path
import re

import numpy as np
from manim import *
from video.subtitles import build_captions, stamp, to_srt

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "data/compiler.json").read_text())
BG = "#10141F"
INK = "#EEF2FA"
MUTED = "#B2BDCE"
BLUE = "#66B9FF"
GREEN = "#7EE0B8"
GOLD = "#F5C86B"
PINK = "#F28BA8"
PURPLE = "#BC9DFF"
GRID = "#293246"
config.background_color = BG


def txt(value, size=28, color=INK, font="Arial", **kwargs):
    # Shape at a larger size, then scale the vector outlines down. This keeps
    # small labels from inheriting coarse glyph-position rounding.
    return Text(str(value), font=font, font_size=size * 4, color=color, **kwargs).scale(.25)


def math(value, size=38, color=INK):
    # Pango's subscript positioning avoids missing Unicode subscript-t glyphs.
    sub = dict(zip("₀₁₂₃₄₅₆₇₈₉ₜᵢ₋₊", "0123456789ti-+"))
    markup = re.sub("[₀₁₂₃₄₅₆₇₈₉ₜᵢ₋₊]+", lambda m: "<sub>" + "".join(sub[c] for c in m[0]) + "</sub>", html.escape(str(value)))
    return MarkupText(markup, font="STIX Two Math", font_size=size, color=color)


def fit(mob, width=12.4, height=None):
    if mob.width > width:
        mob.scale_to_fit_width(width)
    if height and mob.height > height:
        mob.scale_to_fit_height(height)
    return mob


def formula(value, at=ORIGIN, size=40, color=INK):
    return fit(math(value, size, color)).move_to(at)


def label(value, at=ORIGIN, size=25, color=MUTED):
    return fit(txt(value, size, color)).move_to(at)


def box(value, pos, width=2.3, height=.8, color=BLUE, size=25):
    outline = RoundedRectangle(width=width, height=height, corner_radius=.13,
                               stroke_color=color, stroke_width=1.6,
                               fill_color=color, fill_opacity=.055)
    words = fit(txt(value, size, color), width - .22, height - .18)
    return VGroup(outline, words).move_to(pos)


def arrow_between(a, b, color=MUTED):
    return Arrow(a.get_right(), b.get_left(), buff=.12, color=color, stroke_width=2.5,
                 max_tip_length_to_length_ratio=.12)


def code(lines, pos=ORIGIN, size=22, width=11.7):
    glyph = txt("M", size, font="Menlo")
    # Empty Text has no geometry and cannot preserve the left edge during
    # arrange(); give blank lines an invisible, positionable placeholder.
    rows = VGroup(*[
        txt(line.lstrip(), size, MUTED if line.lstrip().startswith("//") else INK, font="Menlo")
        if line.strip() else Rectangle(width=.01, height=glyph.height, stroke_opacity=0, fill_opacity=0)
        for line in lines
    ])
    rows.arrange(DOWN, aligned_edge=LEFT, buff=.13)
    space_width = glyph.width
    for row, line in zip(rows, lines):
        row.shift(RIGHT * (len(line) - len(line.lstrip())) * space_width)
    fit(rows, width, 5.25).move_to(pos)
    return rows


class NumberMatrix(VGroup):
    """Native vector cells and brackets; avoids MathTex's external LaTeX."""
    def __init__(self, values, cell_w=.47, cell_h=.52, size=28, row_colors=None):
        super().__init__()
        self.values = values
        self.cells = []
        nr, nc = len(values), len(values[0])
        self.nrows, self.ncols = nr, nc
        for r, row in enumerate(values):
            cells = []
            for c, value in enumerate(row):
                color = PINK if isinstance(value, (int, float)) and value < 0 else row_colors.get(r, INK) if row_colors else MUTED if value == 0 else INK
                cell = math(str(value).replace("-", "−"), size, color)
                cell.move_to([(c - (nc - 1)/2)*cell_w, ((nr - 1)/2-r)*cell_h, 0])
                cells.append(cell)
                self.add(cell)
            self.cells.append(cells)
        x = nc * cell_w/2 + .08
        y = nr * cell_h/2 + .08
        for side in [-1, 1]:
            bracket = VMobject(stroke_color=INK, stroke_width=2)
            bracket.set_points_as_corners([[side*(x-.13), y, 0], [side*x, y, 0], [side*x, -y, 0], [side*(x-.13), -y, 0]])
            self.add(bracket)

    def row(self, index):
        return VGroup(*self.cells[index])


def vector(values, **kwargs):
    return NumberMatrix([[v] for v in values], **kwargs)


class MatrixProgramming(Scene):
    def construct(self):
        self.cues = []
        self.chapters = []
        self.speed = float(os.environ.get("MATRIX_VIDEO_SPEED", "1"))
        if self.speed <= 0:
            raise ValueError("MATRIX_VIDEO_SPEED must be positive")
        chapters = [
            self.parity, self.parity_logic, self.rows_are_circuits,
            self.gates, self.compiler, self.clock, self.branches,
            self.functions, self.recursion, self.parallel_io,
            self.primality, self.primality_matrix, self.epilogue,
        ]
        selected = os.environ.get("MATRIX_VIDEO_CHAPTER")
        for index, chapter in enumerate(chapters, 1):
            if selected and str(index) != selected:
                continue
            chapter()
        out = HERE / "output"
        out.mkdir(exist_ok=True)
        # Break a narration beat into readable two-line subtitle cues. Each
        # interval is apportioned within that beat's actual animation time.
        captions = build_captions(self.cues)
        timeline = {"duration": float(self.time), "chapters": self.chapters, "cues": captions, "beats": self.cues}
        (out / "timeline.json").write_text(json.dumps(timeline, indent=2) + "\n")
        (out / "matrix-programming.srt").write_text(to_srt(captions))
        transcript = ["# From a program to a matrix", "", "Silent Manim lesson; captions are also supplied as SRT.", ""]
        for chapter in self.chapters:
            transcript.extend([f"## {chapter['title']} ({stamp(chapter['start'])})", ""])
            next_start = next((c['start'] for c in self.chapters if c['start'] > chapter['start']), float('inf'))
            transcript.extend(c['text'] + "\n" for c in self.cues if chapter['start'] <= c['start'] < next_start)
        (out / "transcript.md").write_text("\n".join(transcript))

    def section(self, index, title):
        self.chapters.append({"title": title, "start": float(self.time)})
        if self.mobjects:
            self.play(*[FadeOut(m) for m in list(self.mobjects)], run_time=.55/self.speed)
        self.clear()
        kicker = txt(f"MATRIX PROGRAMMING   /   {index:02}", 16, BLUE).to_edge(UP, buff=.34).to_edge(LEFT, buff=.55)
        heading = fit(txt(title, 39), 12.5).next_to(kicker, DOWN, aligned_edge=LEFT, buff=.22)
        line = Line(LEFT*6.5, RIGHT*6.5, stroke_color=GRID).move_to(UP*2.66)
        self.play(FadeIn(kicker), FadeIn(heading, shift=UP*.1), Create(line), run_time=.7/self.speed)

    def beat(self, narration, *animations, duration=None, run_time=1.25):
        duration = duration or max(5.3, len(narration.split()) / 2.65 + 1.2)
        duration /= self.speed
        start = float(self.time)
        if animations:
            actual = min(run_time/self.speed, duration*.6)
            self.play(*animations, run_time=actual)
        remaining = duration - (float(self.time) - start)
        if remaining > 0:
            self.wait(remaining)
        self.cues.append({"start": start, "end": float(self.time), "text": narration})

    def parity(self):
        self.section(1, "Can six numbers run a program?")
        w = NumberMatrix(DATA['parity']['dense'], cell_w=.5, cell_h=.5, size=29).move_to(LEFT*3.9 + UP*.1)
        x = vector(DATA['parity']['even'][0]['state'], row_colors={0: BLUE, 3: GREEN, 4: GOLD}).move_to(LEFT*.9 + UP*.1)
        raw = vector(["·"]*6).move_to(RIGHT*1.25 + UP*.1)
        nxt = vector(["·"]*6).move_to(RIGHT*4.15 + UP*.1)
        labels = VGroup(formula("W", w.get_top()+UP*.45), formula("xₜ", x.get_top()+UP*.45), formula("z", raw.get_top()+UP*.45), formula("xₜ₊₁", nxt.get_top()+UP*.45))
        signs = VGroup(formula("×", LEFT*2.05), formula("=", RIGHT*.15), Arrow(RIGHT*2.08, RIGHT*3.35, buff=0, color=GREEN), label("ReLU", RIGHT*2.73+UP*.4, 22, GREEN))
        self.beat("This is an entire parity checker. The matrix never changes. Put four in the input coordinate, and the same update will tell us whether four is even.", FadeIn(w), FadeIn(x), FadeIn(raw), FadeIn(nxt), FadeIn(labels), FadeIn(signs))
        note = label("INPUT 4       RESULT 0       END 0       constant 1", DOWN*2.1, 23)
        self.beat("The vector contains more than input and output. It also stores intermediate signals, a stop signal, and a constant one. State is the program's working memory.", FadeIn(note), Indicate(x.cells[0][0], color=BLUE), Indicate(x.cells[5][0], color=PURPLE))
        rowbox = SurroundingRectangle(w.row(0), color=BLUE, buff=.12)
        dot = formula("1 · 4 + (−2) · 1 = 2", DOWN*2.65, 32, BLUE)
        self.beat("A row chooses which old coordinates to combine. The first row takes the current counter and subtracts twice the constant one. Four becomes two.", Create(rowbox), FadeIn(dot))
        first = DATA['parity']['even'][1]
        newraw = vector(first['raw'], row_colors={0: BLUE, 3: GREEN, 4: GOLD}).move_to(raw)
        legend = label("Coordinate order: counter r, detector a, detector b, LED, END, constant 1", DOWN*2.8, 19, MUTED)
        self.beat("Multiplication computes every row from the same old vector. Notice the negative numbers: we have not applied ReLU yet.", Transform(raw, newraw), FadeOut(rowbox), FadeOut(dot), FadeIn(legend))
        newnext = vector(first['state'], row_colors={0: BLUE, 3: GREEN, 4: GOLD}).move_to(nxt)
        self.beat("ReLU keeps positive numbers and clips negative numbers to zero. Only then do we commit the next vector. This separation is what the browser debugger shows.", Transform(nxt, newnext), Indicate(raw, color=PINK))
        for step in DATA['parity']['even'][1:]:
            if step['tick'] > 1:
                explanation = {
                    2: "Use the committed vector again. Two minus two gives zero. The detector rows still see two, so both detectors remain zero in this next vector.",
                    3: "Now the old counter is zero. Multiplication produces minus two in the counter row, one in detector a, and two in detector b. ReLU clips that minus two to zero.",
                    4: "Now the result row copies the old a, which is one. The end row takes the old b minus a: two minus one is one. Both output signals are ready together.",
                }[step['tick']]
                self.beat(explanation, LaggedStart(Transform(raw, vector(step['raw'], row_colors={3: GREEN, 4: GOLD}).move_to(raw)), Transform(nxt, vector(step['state'], row_colors={3: GREEN, 4: GOLD}).move_to(nxt)), lag_ratio=.65), run_time=2.4)
            newx = vector(step['state'], row_colors={0: BLUE, 3: GREEN, 4: GOLD}).move_to(x)
            info = label(f"tick {step['tick']}       counter {step['state'][0]}       result {step['state'][3]}       end {step['state'][4]}", DOWN*2.1, 23, GOLD if step['state'][4] else MUTED)
            narration = {
                1: "Commit the first update. The counter is two; the detector coordinates are still zero.",
                2: "On the second update the counter reaches zero. The output is not valid yet: the detector pipeline has not caught up.",
                3: "On the third update the two threshold signals become one and two. The result and end rows still read their previous values.",
                4: "On the fourth update, the result is one and the end signal is one. Stop here. Four is even.",
            }[step['tick']]
            previews = [Transform(raw, vector(["·"]*6).move_to(raw)), Transform(nxt, vector(["·"]*6).move_to(nxt))]
            self.beat(narration, Transform(x, newx), Transform(note, info), *previews, duration=5.3)
        self.beat("Nothing outside the matrix checked parity. The host only stopped when the end coordinate became nonzero.", Indicate(x.cells[3][0], color=GREEN), Indicate(x.cells[4][0], color=GOLD))
        start5 = vector(DATA['parity']['odd'][0]['state'], row_colors={0: BLUE, 3: GREEN, 4: GOLD}).move_to(x)
        self.beat("Reset the same six coordinates and change only the input to five. The matrix stays exactly the same. Let us run every update again.", Transform(x, start5), Transform(note, label("INPUT 5       tick 0       RESULT 0       END 0", DOWN*2.1, 23, BLUE)))
        for step in DATA['parity']['odd'][1:]:
            explanation = {
                1: "First multiplication: five minus two is three. The two detector rows produce minus four and minus three, which ReLU clips to zero. The output and end are still zero.",
                2: "Second multiplication: three minus two is one. Both detector results are still negative before ReLU and zero after it. The candidate counter is now one.",
                3: "Third multiplication: one minus two is minus one, so the next counter becomes zero. But detector a is zero and detector b is one. They remember that the old counter was odd.",
                4: "Fourth multiplication: the result copies the old a, which is zero. End becomes the old b minus a, one minus zero. ReLU preserves those values. The result is ready.",
            }[step['tick']]
            self.beat(explanation, LaggedStart(Transform(raw, vector(step['raw'], row_colors={3: GREEN, 4: GOLD}).move_to(raw)), Transform(nxt, vector(step['state'], row_colors={3: GREEN, 4: GOLD}).move_to(nxt)), lag_ratio=.65), run_time=2.4)
            info = label(f"INPUT 5       tick {step['tick']}       RESULT {step['state'][3]}       END {step['state'][4]}", DOWN*2.1, 23, GOLD if step['state'][4] else MUTED)
            sentence = f"Commit update {step['tick']}. The counter is {step['state'][0]}; the end signal is still zero." if step['tick'] < 4 else "Commit update four and stop. Result zero means odd: five is odd. Result zero before end would not have been a finished answer."
            self.beat(sentence, Transform(x, vector(step['state'], row_colors={0: BLUE, 3: GREEN, 4: GOLD}).move_to(x)), Transform(note, info), Transform(raw, vector(["·"]*6).move_to(raw)), Transform(nxt, vector(["·"]*6).move_to(nxt)), duration=6 if step['tick'] == 4 else 4.8)

    def parity_logic(self):
        self.section(2, "Why those six coordinates work")
        equations = VGroup(*[math(s, 35, c) for s, c in [
            ("r′ = max(r − 2, 0)", BLUE), ("a′ = max(1 − r, 0)", INK),
            ("b′ = max(2 − r, 0)", INK), ("LED′ = a", GREEN),
            ("END′ = max(b − a, 0)", GOLD), ("c′ = c = 1", PURPLE),
        ]]).arrange(DOWN, aligned_edge=LEFT, buff=.22).move_to(LEFT*3.5 + DOWN*.15)
        self.beat("Let us rename the coordinates: counter r, detectors a and b, result LED, end, and constant c. A prime here means the next matrix update, not a derivative.", Write(equations))
        rows = [["r", "a next", "b next", "b − a"], ["0", "1", "2", "1"], ["1", "0", "1", "1"], ["2 or more", "0", "0", "0"]]
        table = VGroup(*[VGroup(*[fit(txt(v, 22, BLUE if j == 0 else INK), 1.35).move_to([j*1.45, -i*.65, 0]) for j, v in enumerate(row)]) for i, row in enumerate(rows)]).move_to(RIGHT*3.1 + UP*.4)
        fit(table, 5.35)
        self.beat("Detector a recognizes exactly zero. Detector b distinguishes zero, one, and everything larger. Their difference is one precisely when the old counter is below two.", FadeIn(table), Circumscribe(equations[1], color=BLUE), Circumscribe(equations[2], color=BLUE))
        timing = label("detector update  →  result + END update", RIGHT*3 + DOWN*1.4, 22, GOLD)
        self.beat("The result and end each read those detectors one update later. That shared delay makes the result valid at the exact moment execution stops.", FadeIn(timing), Indicate(equations[3]), Indicate(equations[4]))
        odd = DATA['parity']['odd']
        strip = VGroup(*[box(str(s['state'][0]), ORIGIN, width=.7, height=.65, color=BLUE, size=27) for s in odd]).arrange(RIGHT, buff=.5).move_to(RIGHT*3 + DOWN*2.1)
        self.beat("For input five, the counter visits five, three, one, then zero. The delayed detectors remember the one, so the final result is zero: odd.", FadeIn(strip))
        tail = label("5 is odd: LED = 0, END = 1", RIGHT*3 + DOWN*2.75, 25, GREEN)
        self.beat("The end signal matters. Continuing after end would destroy this interpretation. The parity circuit has no instruction clock, function stack, or optional device storage.", FadeIn(tail))

    def rows_are_circuits(self):
        self.section(3, "Rows are tiny circuits")
        nodes = [box(s, [x, 1, 0], color=c, width=2.1) for s, x, c in [("a", -4.5, BLUE), ("b", -1.5, PURPLE), ("c", 1.5, PINK), ("sum", 4.5, GREEN)]]
        form = formula("s′ = ReLU(a + b − c)", DOWN*.5, 49)
        edges = VGroup(*[Arrow(n.get_bottom(), form.get_top()+RIGHT*(j-1)*1.7, buff=.2, color=[BLUE, PURPLE, PINK][j]) for j, n in enumerate(nodes[:3])])
        self.beat("For a larger language, we reuse a few small circuits. Addition and saturating subtraction are just signed weights feeding a row, followed by ReLU.", *[FadeIn(n) for n in nodes], Write(form), Create(edges))
        memory = formula("m′ = m       c′ = c = 1", DOWN*1.65, 38, GOLD)
        self.beat("A diagonal one retains memory. A coordinate initialized to one and copied to itself supplies constant offsets. This makes affine operations possible even though the matrix multiply is linear.", FadeIn(memory))
        caveat = label("Linear weights + repeated nonlinear clipping = stateful computation", DOWN*2.6, 24, GREEN)
        self.beat("The crucial nonlinearity is the clipping between multiplications. We are not claiming that one ordinary linear map can express every program.", FadeIn(caveat))
        self.play(*[FadeOut(m) for m in [*nodes, edges, form, memory, caveat]], run_time=.7/self.speed)
        axes = Axes(x_range=[-3, 3, 1], y_range=[-1, 3, 1], x_length=7, y_length=3.6, tips=False,
                    axis_config={"color": MUTED, "include_ticks": False}).move_to(LEFT*1.6 + DOWN*.3)
        graph = axes.plot(lambda x: max(x, 0), x_range=[-3, 3], color=GREEN, use_smoothing=False)
        zero = label("0", axes.c2p(0, 0)+DOWN*.3, 20)
        rules = VGroup(label("negative → 0", [4.2, .8, 0], 26, PINK), label("positive → unchanged", [4.2, 0, 0], 26, GREEN), label("too large → FAULT", [4.2, -.8, 0], 26, GOLD))
        self.beat("Our implementation stores unsigned 32-bit state. Negative results clamp to zero; values above a coordinate's bound fault. They do not wrap around.", Create(axes), Create(graph), FadeIn(zero), FadeIn(rules))
        exact = label("u32 state  •  signed i32 weights  •  checked exact i64 accumulation", DOWN*2.6, 22, MUTED)
        self.beat("Weights are signed 32-bit integers. The compiler supplies coordinate bounds; the runtime loader checks that every row fits exact signed 64-bit accumulation. Values are validated again before each commit.", FadeIn(exact))

    def gates(self):
        self.section(4, "From arithmetic to decisions")
        formulas = VGroup(*[math(s, 36, c) for s, c in [
            ("zero(a) = ReLU(1 − a)", BLUE),
            ("and(p, q) = ReLU(p + q − 1)", PURPLE),
            ("equal(a, b) = ReLU(1 − u − v)", GREEN),
            ("u = ReLU(a − b),  v = ReLU(b − a)", MUTED),
        ]]).arrange(DOWN, aligned_edge=LEFT, buff=.45).move_to(UP*.2)
        self.beat("For nonnegative integers, one minus a value clips to one only at zero. For Boolean coordinates, one threshold row computes AND.", Write(formulas[:2]))
        self.beat("Equality uses two directed differences. If the values differ, one difference is at least one. Only equality leaves both at zero. These equations are staged across updates, not evaluated instantly.", Write(formulas[2:]))
        premise = label("p, q ∈ {0, 1}     a, b are nonnegative integers", DOWN*2.45, 23, GOLD)
        self.beat("These domain assumptions are essential. Boolean control signals must remain zero or one; the compiler constructs and bounds them that way.", FadeIn(premise))
        self.play(FadeOut(formulas), FadeOut(premise), run_time=.6/self.speed)
        gate = formula("select(v, p) = ReLU(v − M + Mp)", UP*1.45, 43)
        bounds = label("For 0 ≤ v ≤ M, and p ∈ {0, 1}", UP*.6, 25, GOLD)
        left = box("p = 0: output 0", [-3.1, -.55, 0], width=4, color=PINK)
        right = box("p = 1: output v", [3.1, -.55, 0], width=4, color=GREEN)
        self.beat("A selector passes a word only when its control bit is on. Subtract its bound when the selector is off; subtract nothing when it is on.", Write(gate), FadeIn(bounds), FadeIn(left), FadeIn(right))
        full = formula("H = 2³¹ − 1      2H + 1 = 2³² − 1", DOWN*1.7, 36, BLUE)
        self.beat("The full unsigned range cannot fit in one positive signed weight. For a full-width word, the compiler instead subtracts H, H, then one, using three ReLU stages and delayed selectors.", FadeIn(full))
        stages = VGroup(*[box(s, ORIGIN, width=2.4, height=.6, size=23, color=PURPLE) for s in ["subtract H", "subtract H", "subtract 1"]]).arrange(RIGHT, buff=.55).move_to(DOWN*2.65)
        self.beat("When selected, all three subtractions are disabled and the word passes through. When unselected, even the largest unsigned value is reduced to zero.", FadeIn(stages))

    def compiler(self):
        self.section(5, "The compiler builds a circuit")
        stages = [box(s, [x, .7, 0], width=2.5, color=c, size=23) for s, x, c in [("source text", -4.75, BLUE), ("syntax tree", -1.6, PURPLE), ("control-flow graph", 1.6, GOLD), ("sparse rows of W", 4.75, GREEN)]]
        self.beat("Chevrotain parses the source into syntax. Semantic checks and lowering create data registers, function instances, and a graph of small instructions. Matrix generation wires that graph into rows.", LaggedStart(*[FadeIn(s) for s in stages], lag_ratio=.2), *[Create(arrow_between(a, b)) for a, b in zip(stages, stages[1:])])
        eq = formula("x = [ data | control | temporaries | ports ]", DOWN*.6, 39)
        self.beat("The vector contains both data and control. The matrix is fixed after compilation. There is no hidden source interpreter choosing the next arithmetic operation at runtime.", Write(eq))
        rule = label("an edge j → i with weight w   means   W[i, j] += w", DOWN*1.65, 28, BLUE)
        self.beat("Every connection has a destination row, a source column, and an integer weight. Reading a logical matrix row is reading the incoming wires to one coordinate.", FadeIn(rule))
        opts = label("Parsing and allocation happen once. Matrix updates happen repeatedly.", DOWN*2.6, 25, GREEN)
        self.beat("The parity example was a direct counter circuit. To translate more general source programs systematically, we will now build a clocked machine with a shared arithmetic circuit.", FadeIn(opts))

    def clock(self):
        self.section(6, "The clock is also a matrix")
        center = LEFT*3.7 + DOWN*.2
        points = [center + np.array([1.55*np.cos(PI/2-i*TAU/11), 1.55*np.sin(PI/2-i*TAU/11), 0]) for i in range(11)]
        circles = VGroup(*[Circle(radius=.23, stroke_color=BLUE, fill_color=BG, fill_opacity=1).move_to(p) for p in points])
        numbers = VGroup(*[txt(i, 18, INK).move_to(p) for i, p in enumerate(points)])
        connections = VGroup(*[Arrow(points[i], points[(i+1)%11], buff=.27, color=GRID, stroke_width=2, max_tip_length_to_length_ratio=.2) for i in range(11)])
        pulse = Dot(points[0], radius=.14, color=GOLD)
        ringeq = formula("c′ᵢ = cᵢ₋₁  (mod 11)", RIGHT*2.85+UP*1.5, 37, BLUE)
        self.beat("Initialize one clock coordinate to one and the other ten to zero. A ring of copy rows rotates that one around the vector. No wall-clock timer is involved.", Create(connections), FadeIn(circles), FadeIn(numbers), FadeIn(pulse), Write(ringeq))
        for i in range(1, 4):
            self.play(pulse.animate.move_to(points[i]), run_time=.35/self.speed)
        hold = formula("PC stays put while the pulse moves", RIGHT*2.7+UP*.65, 30, GOLD)
        self.beat("One source operation takes several matrix updates. The program-counter coordinate remains active while the clock schedules reads, arithmetic, and writeback.", FadeIn(hold))
        phase_rows = ["1–2    select operands", "3–5    full-u32 gates", "6–7    assemble + compute", "8–10  gate values + dispatch", "11      commit data + next PC"]
        schedule = code(phase_rows, RIGHT*2.65+DOWN*.95, size=23, width=6.1)
        self.beat("In the general backend, an instruction period has eleven updates: select operands, gate them, assemble the arithmetic inputs, compute, then commit data and control together.", FadeIn(schedule))
        band = SurroundingRectangle(schedule[0], color=GOLD, buff=.12)
        self.beat("The early phases select only operands of the active instruction. Other arithmetic circuits see zeros, so an untaken overflowing expression cannot fault the machine.", Create(band), pulse.animate.move_to(points[2]))
        self.beat("Three gating stages carry full-width unsigned words using legal signed weights. Selector delays keep the control and the data aligned.", Transform(band, SurroundingRectangle(schedule[1], color=GOLD, buff=.12)), pulse.animate.move_to(points[5]))
        self.beat("The shared arithmetic row computes ReLU of A plus B minus C. Its output is then selected for the instruction's destination.", Transform(band, SurroundingRectangle(schedule[2], color=GOLD, buff=.12)), pulse.animate.move_to(points[7]))
        self.beat("Writeback uses old value plus selected new value minus selected old value. Data replacement and the next program counter commit on the eleventh update.", Transform(band, SurroundingRectangle(schedule[4], color=GOLD, buff=.12)), pulse.animate.move_to(points[0]))
        endnote = label("start pulse → delay rows → scheduled dispatch pulse", DOWN*2.75, 23, MUTED)
        self.beat("In the unoptimized construction, an instruction's start pulse travels through copy rows. Those delays deliver its dispatch pulse at the scheduled phase. Waiting is itself matrix circuitry.", FadeIn(endnote))

    def branches(self):
        self.section(7, "A loop is a wire that comes back")
        test = box("test counter > 0", [0, 1.1, 0], width=3.7, color=GOLD)
        update = box("counter = counter − 1", [-3.1, -.65, 0], width=4.1, color=BLUE)
        done = box("return / END", [3.5, -.65, 0], width=2.7, color=GREEN)
        yes = Arrow(test.get_bottom()+LEFT*.45, update.get_top(), buff=.13, color=BLUE)
        no = Arrow(test.get_bottom()+RIGHT*.45, done.get_top(), buff=.13, color=GREEN)
        back = CurvedArrow(update.get_left(), test.get_left(), angle=-PI/1.8, color=BLUE)
        self.beat("A branch sends the control token along exactly one outgoing edge. A while-loop is the same construction with a back edge from the update to the test.", FadeIn(test), FadeIn(update), FadeIn(done), Create(yes), Create(no), Create(back))
        token = Dot(test.get_center()+RIGHT*1.35, color=GOLD)
        self.beat("The data register retains its value until its update is selected. The branch tests that value again after writeback, not a stale intermediate result.", FadeIn(token))
        self.play(token.animate.move_to(update.get_center()+RIGHT*1.65), run_time=.7/self.speed)
        self.play(token.animate.move_to(test.get_center()+RIGHT*1.35), run_time=.7/self.speed)
        self.play(token.animate.move_to(done.get_center()+RIGHT*.95), run_time=.7/self.speed)
        forms = VGroup(formula("yes = AND(dispatch, condition)", DOWN*1.9, 32, BLUE), formula("no = AND(dispatch, 1 − condition)", DOWN*2.55, 32, GREEN))
        self.beat("Boolean logic combines the instruction's dispatch pulse with the condition. These are equations implemented by ReLU rows. The host does not execute an if statement for the program.", FadeIn(forms))

    def functions(self):
        self.section(8, "Two calls. One function body.")
        src = code(["fn bump(v) { return v + 1; }", "", "fn main(n) {", "  let first = bump(n);", "  return bump(first);", "}"], LEFT*3.4+DOWN*.2, size=24, width=6.2)
        body = box("shared bump body", [3.3, .6, 0], width=4.6, height=1.1, color=BLUE)
        sitea = box("call site A", [2, -1.05, 0], width=2.25, color=GOLD)
        siteb = box("call site B", [4.8, -1.05, 0], width=2.25, color=PURPLE)
        self.beat("Ordinary functions provide size-efficient reuse. Both call sites enter the same compiled body. The body is not copied just because it appears twice in the source.", FadeIn(src), FadeIn(body), FadeIn(sitea), FadeIn(siteb))
        paths = VGroup(Arrow(sitea.get_top(), body.get_bottom()+LEFT*.8, color=GOLD, buff=.12), Arrow(siteb.get_top(), body.get_bottom()+RIGHT*.8, color=PURPLE, buff=.12))
        self.beat("A call copies arguments into the callee's parameter registers, records a return-site flag, then routes control to the callee's first instruction.", Create(paths), Indicate(sitea, color=GOLD))
        flags = label("return flags:   A = 1     B = 0", [3.4, 1.8, 0], 25, GOLD)
        self.beat("On return, a pulse combines with the remembered call-site flag to activate the correct continuation. The flag clears, allowing the body to be called again.", FadeIn(flags), Circumscribe(body, color=GREEN))
        otherflags = label("return flags:   A = 0     B = 1", [3.4, 1.8, 0], 25, PURPLE)
        self.beat("Now the second call reuses those same parameters and scratch registers, but returns to site B. Reuse is safe because ordinary functions cannot recursively reactivate themselves.", Transform(flags, otherflags), Indicate(siteb, color=PURPLE))
        lower = label("Nested acyclic calls: each function keeps its own activation storage", DOWN*2.65, 25, BLUE)
        self.beat("Nested nonrecursive calls are also possible. Separate function instances hold values across a call. Repeated sequential calls share circuitry; simultaneous activations need separate storage.", FadeIn(lower))

    def recursion(self):
        self.section(9, "Recursion needs more than a return address")
        source = code(["rec fn factorial(n) {", "  if (n <= 1) { return 1; }", "  let previous = factorial(n - 1);", "  return multiply(previous, n);", "}"], LEFT*2.7+UP*.65, size=24, width=7.9)
        self.beat("Factorial must remember each caller's n while a deeper call is running. A single shared set of parameter registers would overwrite those live values.", FadeIn(source))
        frames = VGroup(*[box(f"bank {i+1}: n = {4-i}", [4.6, 1.65-i*1.0, 0], width=3, height=.75, color=[BLUE, PURPLE, GOLD, GREEN][i], size=25) for i in range(4)])
        self.beat("The current compiler handles direct self recursion with a fixed bank of activations. Each depth has its own parameters, local data, return flags, and compiled body.", FadeIn(frames[0]))
        self.beat("Calling factorial of four activates banks for four, three, two, and one. The lower banks preserve the callers' values while control moves deeper.", LaggedStart(*[FadeIn(f, shift=DOWN*.15) for f in frames[1:]], lag_ratio=.35), run_time=2.1)
        pending = formula("4 × (3 × (2 × 1))", LEFT*2.7+DOWN*.8, 51, BLUE)
        self.beat("The base case returns one. Each suspended caller then receives the child result and completes its own multiplication.", Write(pending), Indicate(frames[3], color=GREEN))
        for index, value in [(2, 2), (1, 6), (0, 24)]:
            caption = {2: "Unwind one level: two times one is two.", 1: "Then three times two is six.", 0: "Finally four times six is twenty-four. The pending activations are resumed, not recomputed from scratch."}[index]
            self.beat(caption, Indicate(frames[index], color=GREEN), Transform(pending, formula(f"returned value = {value}", LEFT*2.7+DOWN*.8, 43, GREEN)), duration=5.3)
        limit = label("Default: 16 banks    •    overflow of depth → fault", LEFT*2.25+DOWN*1.95, 24, GOLD)
        self.beat("This is bounded recursion, not an unbounded dynamic stack. The default is sixteen banks. Exceeding the configured depth faults; increasing depth increases matrix size.", FadeIn(limit))
        fact = label("More supported depth means more matrix coordinates", DOWN*2.7, 23, MUTED)
        self.beat("The current implementation duplicates recursive circuitry per depth. It does not yet use one recursive body with a dynamically addressed stack. Factorial's multiplication helper itself is a source-level addition loop.", FadeIn(fact))

    def parallel_io(self):
        self.section(10, "Parallel work and optional devices")
        grid = VGroup(*[Square(side_length=.6, stroke_color=GRID, fill_color=GRID, fill_opacity=.35).move_to([c*.6-4.1, 1.3-r*.6, 0]) for r in range(5) for c in range(5)])
        a = Rectangle(width=1.2, height=1.2, color=BLUE, fill_opacity=.22).move_to([-3.8, 1, 0])
        b = Rectangle(width=1.8, height=1.8, color=PURPLE, fill_opacity=.22).move_to([-2.3, -.5, 0])
        eq = formula("W = [ A  0 ; 0  B ]", RIGHT*2.4+UP*1.25, 41)
        self.beat("Independent computations can occupy separate blocks of one matrix. A global matrix update advances both blocks at once. This is mathematical parallelism, not a promise about CPU thread scheduling.", FadeIn(grid), FadeIn(a), FadeIn(b), Write(eq))
        join = box("join: AND(done A, done B)", [2.8, -.1, 0], width=5.8, color=GREEN)
        self.beat("Real compiled parallel programs also include shared constants, launch wiring, and join signals. Each concurrent context has separate working storage; the parent waits until both done signals arrive.", FadeIn(join))
        ports = VGroup(*[label(s, [0, y, 0], 25, c) for s, y, c in [
            ("END: terminate     LED: observe nonzeroness", -1.4, GOLD),
            ("console: character + emit   /   request + input latches", -2.05, BLUE),
            ("screen: X, Y, R, G, B, emit    →    host's 16 × 16 display", -2.7, GREEN),
        ]])
        self.beat("Devices are vector coordinates, not packed flags hidden inside a number. A console emits one character; the display receives one pixel command through six output ports.", FadeIn(ports))
        self.beat("The screen's pixel buffer lives in the host, so it does not force seven hundred sixty-eight color coordinates into the matrix. Unused optional devices add no ports. The LED can observe an existing coordinate.", Indicate(ports[2], color=GREEN))
        self.beat("Input is an explicit boundary: the host injects a requested character into designated input latches. We can write that as W x plus B u before ReLU. Device events happen only on commit.", Indicate(ports[1], color=BLUE), Transform(eq, formula("x′ = ReLU(Wx + Bu)", RIGHT*2.4+UP*1.25, 37, BLUE)))

    def primality(self):
        self.section(11, "Build the simple primality program")
        listing = code([
            "if n < 2: return 0", "divisor = 2", "while divisor < n:",
            "  count = 0; remainder = 0", "  while count < n:",
            "    count += 1; remainder += 1", "    if remainder == divisor:",
            "      if count == n: return 0", "      while remainder > 0:",
            "        remainder -= 1", "  while count > 0:",
            "    count -= 1; remainder -= 1", "  divisor += 1", "return 1",
        ], LEFT*2.7+DOWN*.35, size=20, width=7.8)
        badge = label("Nat pseudocode: subtraction clamps to zero", LEFT*2.7+UP*2.15, 20, MUTED)
        self.beat("Now assemble those mechanisms into the original simple primality algorithm. We are showing shortened pseudocode for the unchanged counter-and-reset source, not a faster replacement algorithm.", FadeIn(listing), FadeIn(badge))
        words = VGroup(*[box(s, [4.4, y, 0], width=3.1, color=c, height=.7, size=24) for s, y, c in [("n = 6", 1.4, BLUE), ("divisor = 2", .5, PURPLE), ("count = 0", -.4, INK), ("remainder = 0", -1.3, GREEN)]])
        self.beat("Reject inputs below two. Try each divisor starting at two. Count upward to n while also advancing a remainder counter.", FadeIn(words), Circumscribe(listing[0], color=GOLD))
        highlight = SurroundingRectangle(listing[5], color=BLUE, buff=.09)
        self.beat("Each inner iteration increments count and remainder. When remainder reaches the divisor, we have counted another complete group of that size.", Create(highlight), Transform(words[2], box("count = 1", [4.4, -.4, 0], width=3.1, color=INK, height=.7)), Transform(words[3], box("remainder = 1", [4.4, -1.3, 0], width=3.1, color=GREEN, height=.7)))
        self.beat("At count two, remainder two equals divisor two. Count has not yet reached six, so decrement the remainder back to zero and continue.", Transform(highlight, SurroundingRectangle(VGroup(listing[6], listing[7], listing[8], listing[9]), color=GOLD, buff=.1)), Transform(words[2], box("count = 2", [4.4, -.4, 0], width=3.1, color=INK, height=.7)), Transform(words[3], box("remainder = 2", [4.4, -1.3, 0], width=3.1, color=GREEN, height=.7)))
        self.beat("At count six, remainder again equals two. The final group ends exactly at n. Six has a proper divisor, so return zero: composite.", Transform(words[2], box("count = 6", [4.4, -.4, 0], width=3.1, color=INK, height=.7)), Transform(words[3], box("remainder = 2", [4.4, -1.3, 0], width=3.1, color=GREEN, height=.7)), Transform(highlight, SurroundingRectangle(listing[7], color=PINK, buff=.1)))
        self.beat("If a divisor does not divide n, a second countdown clears count and the remaining remainder, then advances the divisor. If no proper divisor succeeds, return one: prime.", Transform(highlight, SurroundingRectangle(VGroup(listing[10], listing[11], listing[12], listing[13]), color=GREEN, buff=.1)), words.animate.set_opacity(.25))
        self.beat("Every increment, countdown, comparison, back edge, and return uses the same circuits we have just built. No runtime modulo or primality routine is hidden behind this source.", FadeOut(highlight))

    def primality_matrix(self):
        self.section(12, "Putting the whole primality machine into W")
        data = DATA['prime']['unoptimized']
        n = data['size']
        # This is an actual weight raster, one source/destination coordinate per
        # pixel. The Manim camera scales it; it is not a fabricated block sketch.
        pixels = np.empty((n, n, 3), dtype=np.uint8)
        pixels[:] = [23, 29, 43]
        for r, row in enumerate(data['rows']):
            for c, w in zip(row['cols'], row['weights']):
                pixels[r, c] = [102, 185, 255] if w > 0 else [242, 139, 168]
        heat = ImageMobject(pixels).set_resampling_algorithm(RESAMPLING_ALGORITHMS["nearest"]).set_height(4.6).move_to(LEFT*3.65+DOWN*.15)
        border = SurroundingRectangle(heat, color=MUTED, buff=.04, stroke_width=1)
        stats = VGroup(
            txt(f"{n:,} × {n:,}", 58, BLUE), txt(f"{data['nonzeros']:,} nonzero weights", 29, INK),
            txt("The unoptimized clocked construction", 23, GOLD), txt("Signed weights; sparse storage", 23, MUTED),
        ).arrange(DOWN, aligned_edge=LEFT, buff=.33).move_to(RIGHT*2.65+UP*.7)
        self.beat(f"The unoptimized compiler translates this source into a {n} by {n} matrix. This image is the actual exported matrix, not a hand-drawn approximation of its sparsity.", FadeIn(heat), Create(border), FadeIn(stats))
        explanation = VGroup(*[txt(s, 24, c) for s, c in [("data + constants", BLUE), ("instruction PCs + delay lines", GOLD), ("operand gates + shared ALU", PURPLE), ("writeback + comparisons + end", GREEN)]]).arrange(DOWN, aligned_edge=LEFT, buff=.18).move_to(RIGHT*2.8+DOWN*1.5)
        self.beat("Most coordinates are not mathematical variables in the source. They are the machinery for routing words, sequencing instructions, aligning selectors, and preserving intermediate values.", FadeIn(explanation))
        note = label("Blue: positive weight    Pink: negative weight    Dark: zero", DOWN*2.8, 22, MUTED)
        self.beat(f"There are only {data['nonzeros']} nonzero weights. Sparse storage makes execution cheaper, but it does not change the mathematical dimensions of W.", FadeIn(note))
        self.play(FadeOut(heat), FadeOut(border), FadeOut(stats), FadeOut(explanation), FadeOut(note), run_time=.7/self.speed)
        count_id = next(i for i, r in enumerate(data['registers']) if r['name'] == 'main.main.count')
        count_row = data['rows'][count_id]
        old_id = next(c for c in count_row['cols'] if data['registers'][c]['name'].endswith('.old.value'))
        new_id = next(c for c in count_row['cols'] if data['registers'][c]['name'].endswith('.new.value'))
        sub = lambda value: str(value).translate(str.maketrans('0123456789', '₀₁₂₃₄₅₆₇₈₉'))
        ports = VGroup(*[box(s, [x, 1.3, 0], width=3.35, height=1.05, color=c, size=24) for s, x, c in [
            (f'x[{count_id}]\ncurrent count', -4.25, BLUE),
            (f'x[{old_id}]\nselected old count', 0, PINK),
            (f'x[{new_id}]\nselected new count', 4.25, GREEN),
        ]])
        actual = formula(f"x′{sub(count_id)} = ReLU(x{sub(count_id)} − x{sub(old_id)} + x{sub(new_id)})", DOWN*.05, 44)
        self.beat(f"Zoom into actual destination row {count_id}. It copies the current count, subtracts the selected old count, and adds the selected new count. These three nonzero weights implement assignment.", FadeIn(ports), Write(actual))
        inactive = formula("inactive: old − 0 + 0 = old", DOWN*1.25, 36, BLUE)
        active = formula("active: old − old + new = new", DOWN*2.25, 36, GREEN)
        self.beat("When this writer is inactive, both selected words are zero, so the row retains count. When active, the old value cancels and the new value remains. The row itself never changes.", FadeIn(inactive), FadeIn(active), Indicate(ports[1], color=PINK), Indicate(ports[2], color=GREEN))
        self.play(FadeOut(ports), FadeOut(actual), FadeOut(inactive), FadeOut(active), run_time=.6/self.speed)
        headings = VGroup(*[txt(v, 23, c) for v, c in [("matrix tick", MUTED), ("n", BLUE), ("divisor", PURPLE), ("count", INK), ("remainder", GREEN)]]).arrange(RIGHT, buff=.75).move_to(UP*1.65)
        self.beat("Let us inspect actual committed vectors from that unoptimized matrix, ignoring internal coordinates here so we can follow the source data.", FadeIn(headings))
        traces = DATA['prime']['composite']['trace']
        chosen = [traces[0]]
        for target in [(6, 2, 0, 0), (6, 2, 1, 1), (6, 2, 2, 2), (6, 2, 2, 0), (6, 2, 4, 2), (6, 2, 6, 2)]:
            hit = next((t for t in traces if tuple(t['values'][:4]) == target), None)
            if hit and hit not in chosen:
                chosen.append(hit)
        table_rows = VGroup()
        for j, step in enumerate(chosen):
            row = VGroup(*[txt(v, 25, [MUTED, BLUE, PURPLE, INK, GREEN][k]) for k, v in enumerate([step['tick'], *step['values'][:4]])])
            for k, cell in enumerate(row):
                cell.move_to([headings[k].get_x(), 1-j*.47, 0])
            table_rows.add(row)
        self.beat("These are selected checkpoints, not adjacent updates. Each source action crosses operand gates, arithmetic, and writeback; many internal vectors occur between visible counter changes.", LaggedStart(*[FadeIn(r, shift=UP*.08) for r in table_rows], lag_ratio=.2), run_time=2.2)
        end = DATA['prime']['composite']
        result = label(f"n = 6: RESULT 0, END 1 at tick {end['ticks']:,}", DOWN*2.45, 28, GOLD)
        self.beat(f"For six, this completely unoptimized compilation halts after {end['ticks']} matrix updates with result zero. The host only sees the end signal and exposes the result.", FadeIn(result))
        prime = DATA['prime']['prime']
        nextresult = label(f"n = 7: RESULT 1, END 1 at tick {prime['ticks']:,}", DOWN*2.45, 28, GREEN)
        self.beat(f"With the same W but input seven, the divisor tests all fail and the machine returns one after {prime['ticks']} updates. Changing the input does not recompile the matrix.", Transform(result, nextresult))

    def epilogue(self):
        self.section(13, "A program made of connections")
        equation = formula("program → fixed W → xₜ₊₁ = ReLU(Wxₜ)", UP*1.1, 48, GREEN)
        concepts = VGroup(*[box(s, ORIGIN, width=2.65, color=c) for s, c in [("memory", BLUE), ("decisions", PURPLE), ("clock + control", GOLD), ("call + return", GREEN)]]).arrange(RIGHT, buff=.45).move_to(DOWN*.2)
        self.beat("We started with six parity coordinates and built memory, decisions, timing, loops, calls, and bounded recursion. The unoptimized compiler assembles these mechanisms into one fixed matrix.", Write(equation), FadeIn(concepts))
        small = label("Smaller circuits are possible; the construction is the point.", DOWN*1.65, 25, MUTED)
        self.beat("Compiler optimizations can make the same program much smaller. But understanding this direct construction explains what those smaller circuits are doing.", FadeIn(small))
        closing = label("Inspect a row. Follow a pulse. Watch a program run.", DOWN*2.55, 30, BLUE)
        self.beat("Put memory and control in the vector, and computation in its connections. Then repeated multiplication and ReLU become a program you can inspect one update at a time.", FadeIn(closing), duration=12)
