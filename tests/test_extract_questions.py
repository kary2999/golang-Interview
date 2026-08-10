# [skill: go-team-standards · dev-dna] 验证文章提取与安全 HTML 边界
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.extract_questions import extract_questions, validate_questions


class ExtractQuestionsTest(unittest.TestCase):
    def setUp(self):
        source = ROOT / "tests" / "fixtures" / "article_sample.html"
        self.questions = extract_questions(source.read_text(encoding="utf-8"))

    @staticmethod
    def question(
        answer_html,
        question="Q",
        question_id=1,
        prompt_html="",
    ):
        return {
            "id": question_id,
            "question": question,
            "promptHtml": prompt_html,
            "answerHtml": answer_html,
        }

    def test_extracts_only_numeric_question_headings(self):
        self.assertEqual([item["id"] for item in self.questions], [1, 2])
        self.assertEqual(self.questions[0]["question"], "Go 的 slice 是什么？")
        self.assertIn("补充：", self.questions[0]["answerHtml"])

    def test_ignores_outside_content_and_flattens_links_and_spans(self):
        answer = self.questions[0]["answerHtml"]
        self.assertNotIn("OUTSIDE_CONTENT_MUST_NOT_SURVIVE", answer)
        self.assertIn("指针、长度和容量", answer)
        self.assertNotIn("<a", answer)
        self.assertNotIn("<span", answer)
        self.assertNotIn("https://", answer)

    def test_removes_skipped_subtrees_and_promotional_content(self):
        answer = "".join(item["answerHtml"] for item in self.questions)
        self.assertNotIn("<script", answer)
        self.assertNotIn("<svg", answer)
        self.assertNotIn("SCRIPT_BODY_MUST_NOT_SURVIVE", answer)
        self.assertNotIn("SVG_BODY_MUST_NOT_SURVIVE", answer)
        self.assertNotIn("推广内容", answer)

    def test_escapes_emitted_text(self):
        answer = self.questions[0]["answerHtml"]
        self.assertIn(
            "转义示例：&lt;unsafe&gt; &amp; &quot;quoted&quot;",
            answer,
        )
        self.assertNotIn("<unsafe>", answer)

    def test_preserves_readable_code_and_drops_invalid_code_classes(self):
        answer = self.questions[1]["answerHtml"]
        self.assertIn(
            '<pre><code class="language-text">',
            answer,
        )
        self.assertIn("defer first()", answer)
        self.assertIn("<code>invalid class text</code>", answer)
        self.assertNotIn("Language-Go", answer)
        self.assertNotIn("data-x", answer)

    def test_separates_leading_code_prompt_from_marked_answer(self):
        source = """
        <div class="RichText ztext Post-RichText">
          <h3>35 下面这句代码是什么作用？</h3>
          <div class="highlight">
            <pre><code class="language-text">var _ Codec = (*GobCodec)(nil)</code></pre>
          </div>
          <p>答：用于在编译期检查接口实现。</p>
          <h2>文章结束</h2>
        </div>
        """

        questions = extract_questions(source)

        self.assertEqual(
            questions[0]["promptHtml"],
            (
                '<pre><code class="language-text">'
                "var _ Codec = (*GobCodec)(nil)"
                "</code></pre>"
            ),
        )
        self.assertEqual(
            questions[0]["answerHtml"],
            "<p>答：用于在编译期检查接口实现。</p>",
        )

    def test_keeps_leading_code_as_answer_without_an_answer_marker(self):
        source = """
        <div class="RichText ztext Post-RichText">
          <h3>08 如何判断 map 中是否包含一个 key？</h3>
          <pre><code class="language-text">_, ok := values[key]</code></pre>
          <h2>文章结束</h2>
        </div>
        """

        questions = extract_questions(source)

        self.assertEqual(questions[0]["promptHtml"], "")
        self.assertIn("_, ok := values[key]", questions[0]["answerHtml"])

    def test_validates_expected_ids(self):
        validate_questions(self.questions, expected_ids=[1, 2])
        with self.assertRaisesRegex(ValueError, "题号"):
            validate_questions(self.questions, expected_ids=[1, 2, 3])

    def test_validation_accepts_only_allowed_tags_and_code_class(self):
        validate_questions(
            [self.question(
                '<p>Visit https://example.com</p>'
                '<pre><code class="language-go">safe()</code></pre>'
            )],
            expected_ids=[1],
        )

        unsafe_answers = {
            "arbitrary tag": "<marquee>A</marquee>",
            "attribute on allowed tag": '<p data-x="1">A</p>',
            "javascript href": '<p href="javascript:alert(1)">A</p>',
            "remote src": '<p src="https://example.com/x">A</p>',
            "remote href": '<p href="//example.com/x">A</p>',
            "style attribute": (
                '<p style="background:url(https://example.com/x)">A</p>'
            ),
            "remote stylesheet": (
                '<link rel="stylesheet" href="https://example.com/x.css">'
                "<p>A</p>"
            ),
            "style tag": (
                "<style>@import url(https://example.com/x.css)</style>"
                "<p>A</p>"
            ),
            "iframe srcdoc": '<iframe srcdoc="<p>unsafe</p>">A</iframe>',
            "invalid code class": '<code class="Language-Go">A</code>',
            "extra code attribute": (
                '<code class="language-go" title="unsafe">A</code>'
            ),
            "closing unsafe tag": "</script><p>A</p>",
            "misnested allowed tags": "<p><strong>A</p></strong>",
            "unclosed allowed tag": "<p>A",
        }
        for label, answer_html in unsafe_answers.items():
            with self.subTest(label=label):
                with self.assertRaises(ValueError):
                    validate_questions(
                        [self.question(answer_html)],
                        expected_ids=[1],
                    )

        with self.assertRaises(ValueError):
            validate_questions(
                [self.question(
                    "<p>A</p>",
                    prompt_html="<script>alert(1)</script>",
                )],
                expected_ids=[1],
            )

    def test_validation_rejects_duplicate_and_empty_records(self):
        invalid_questions = {
            "duplicate IDs": [
                self.question("<p>A</p>"),
                self.question("<p>B</p>"),
            ],
            "empty question": [
                self.question("<p>A</p>", question="  "),
            ],
            "empty answer": [
                self.question("  "),
            ],
            "markup-only answer": [
                self.question("<p><br></p>"),
            ],
        }
        for label, questions in invalid_questions.items():
            with self.subTest(label=label):
                with self.assertRaises(ValueError):
                    validate_questions(
                        questions,
                        expected_ids=[1],
                    )


if __name__ == "__main__":
    unittest.main()
