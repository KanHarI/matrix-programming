"""Layout regressions; no movie rendering required."""
import tempfile
import unittest

from manim import tempconfig

from video.matrix_programming import code


class CodeLayoutTest(unittest.TestCase):
    def test_blank_lines_preserve_left_edge_and_indentation(self):
        with tempfile.TemporaryDirectory() as directory:
            with tempconfig({"media_dir": directory, "text_dir": directory + "/texts"}):
                rows = code([
                    "fn bump(v) { return v + 1; }", "",
                    "fn main(n) {", "  let first = bump(n);",
                    "  return bump(first);", "}",
                ], width=6.2)
        left = lambda index: rows[index].get_left()[0]
        self.assertAlmostEqual(left(0), left(2))
        self.assertAlmostEqual(left(0), left(5))
        self.assertAlmostEqual(left(3), left(4))
        self.assertGreater(left(3), left(2))
        self.assertGreater(rows[1].height, 0)
        self.assertLessEqual(rows.width, 6.2 + 1e-8)


if __name__ == "__main__":
    unittest.main()
