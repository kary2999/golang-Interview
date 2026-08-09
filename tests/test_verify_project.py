# [skill: go-team-standards · dev-dna] 验证仓库级离线与维护约束
import copy
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_questions import render_questions_js
from scripts.verify_project import (
    VerificationError,
    parse_questions_js,
    verify_index,
    verify_question_records,
    verify_required_files,
    verify_static_code,
)


def valid_questions():
    records = []
    for question_id in range(1, 101):
        records.append(
            {
                "id": question_id,
                "question": "问题 {}？".format(question_id),
                "answerHtml": "<p>答案 {}</p>".format(question_id),
                "source": (
                    "supplemented"
                    if question_id in {73, 89, 90}
                    else "zhihu-archive"
                ),
            }
        )
    return records


def write_valid_page(root):
    (root / "assets").mkdir(parents=True)
    (root / "data").mkdir()
    (root / "assets" / "styles.css").write_text(
        "/* [skill: go-team-standards · dev-dna] 离线样式 */\n",
        encoding="utf-8",
    )
    (root / "assets" / "app.js").write_text(
        "// [skill: go-team-standards · dev-dna] 离线应用\n",
        encoding="utf-8",
    )
    (root / "data" / "questions.js").write_text(
        render_questions_js(valid_questions()),
        encoding="utf-8",
    )
    (root / "index.html").write_text(
        """<!doctype html>
<html lang="zh-CN">
<head>
  <link rel="stylesheet" href="assets/styles.css">
</head>
<body>
  <main id="app"></main>
  <script src="data/questions.js"></script>
  <script src="assets/app.js"></script>
</body>
</html>
""",
        encoding="utf-8",
    )


class VerifyProjectTest(unittest.TestCase):
    def test_parses_only_the_deterministic_static_data_assignment(self):
        records = valid_questions()
        rendered = render_questions_js(records)

        self.assertEqual(parse_questions_js(rendered), records)

        invalid_outputs = {
            "trailing code": rendered + "alert(1);\n",
            "direct assignment": rendered.replace(
                "Object.freeze(\n",
                "",
                1,
            ).replace("\n);\n", ";\n", 1),
            "non-JSON expression": rendered.replace(
                '"id": 1',
                '"id": 1 + 0',
                1,
            ),
        }
        for label, output in invalid_outputs.items():
            with self.subTest(label=label):
                with self.assertRaises(VerificationError):
                    parse_questions_js(output)

    def test_question_contract_rejects_order_source_and_markup_regressions(self):
        records = valid_questions()
        verify_question_records(records)

        invalid_sets = {}

        wrong_order = copy.deepcopy(records)
        wrong_order[0], wrong_order[1] = wrong_order[1], wrong_order[0]
        invalid_sets["wrong order"] = wrong_order

        wrong_source = copy.deepcopy(records)
        wrong_source[72]["source"] = "zhihu-archive"
        invalid_sets["wrong supplemented IDs"] = wrong_source

        unknown_source = copy.deepcopy(records)
        unknown_source[0]["source"] = "unknown"
        invalid_sets["unknown source"] = unknown_source

        unsafe_answer = copy.deepcopy(records)
        unsafe_answer[0]["answerHtml"] = '<p onclick="alert(1)">答案</p>'
        invalid_sets["unsafe answer"] = unsafe_answer

        for label, candidate in invalid_sets.items():
            with self.subTest(label=label):
                with self.assertRaises(VerificationError):
                    verify_question_records(candidate)

    def test_index_requires_ordered_local_files_and_no_embedded_behavior(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            write_valid_page(root)

            verify_index(root)

            original = (root / "index.html").read_text(encoding="utf-8")
            invalid_pages = {
                "remote URL": original.replace(
                    'href="assets/styles.css"',
                    'href="https://example.com/styles.css"',
                ),
                "module script": original.replace(
                    '<script src="assets/app.js">',
                    '<script type="module" src="assets/app.js">',
                ),
                "inline event": original.replace(
                    '<main id="app">',
                    '<main id="app" onclick="alert(1)">',
                ),
                "embedded dataset": original.replace(
                    '<main id="app">',
                    "<main id=\"app\"><script>"
                    "window.GO_INTERVIEW_QUESTIONS = [];"
                    "</script>",
                ),
                "wrong script order": original.replace(
                    '  <script src="data/questions.js"></script>\n'
                    '  <script src="assets/app.js"></script>',
                    '  <script src="assets/app.js"></script>\n'
                    '  <script src="data/questions.js"></script>',
                ),
            }

            for label, page in invalid_pages.items():
                with self.subTest(label=label):
                    (root / "index.html").write_text(page, encoding="utf-8")
                    with self.assertRaises(VerificationError):
                        verify_index(root)

            (root / "index.html").write_text(original, encoding="utf-8")
            (root / "assets" / "app.js").unlink()
            with self.assertRaises(VerificationError):
                verify_index(root)

    def test_static_code_rejects_network_and_dynamic_loading(self):
        forbidden_snippets = {
            "fetch": 'fetch("/questions.json");',
            "dynamic import": 'import("./feature.js");',
            "remote CSS": '@import url("https://example.com/theme.css");',
            "protocol-relative URL": 'const asset = "//example.com/a.png";',
            "relative XMLHttpRequest": (
                "const request = new XMLHttpRequest();\n"
                'request.open("GET", "./questions.json");\n'
                "request.send();"
            ),
            "window XMLHttpRequest": (
                "const request = new window.XMLHttpRequest();"
            ),
            "relative WebSocket": 'new WebSocket("/updates");',
            "relative EventSource": 'new EventSource("/events");',
            "relative WebTransport": 'new WebTransport("/transport");',
            "sendBeacon": (
                'navigator.sendBeacon("/telemetry", "payload");'
            ),
            "template interpolation call": (
                "const warning = "
                "`request: ${new XMLHttpRequest()}`;"
            ),
        }

        for label, snippet in forbidden_snippets.items():
            with self.subTest(label=label):
                with tempfile.TemporaryDirectory() as temporary_directory:
                    root = Path(temporary_directory)
                    write_valid_page(root)
                    (root / "assets" / "app.js").write_text(
                        snippet,
                        encoding="utf-8",
                    )
                    with self.assertRaises(VerificationError):
                        verify_static_code(root)

        allowed_documentation = {
            "double-quoted text": (
                'const note = "Do not use XMLHttpRequest() '
                'in this offline app.";\n'
            ),
            "single-quoted text": (
                "const note = 'Do not use WebSocket() "
                "in this offline app.';\n"
            ),
            "escaped quote and comment markers in text": (
                'const note = "Avoid \\"EventSource()\\" and '
                '// this is still text";\n'
            ),
            "line comment": (
                "// navigator.sendBeacon() is forbidden\n"
                "const isOffline = true;\n"
            ),
            "block comment": (
                "/* new WebTransport() is forbidden here. */\n"
                "const isOffline = true;\n"
            ),
            "template literal text": (
                "const note = `Do not use XMLHttpRequest() "
                "or navigator.sendBeacon()`;\n"
            ),
        }
        for label, source in allowed_documentation.items():
            with self.subTest(label=label):
                with tempfile.TemporaryDirectory() as temporary_directory:
                    root = Path(temporary_directory)
                    write_valid_page(root)
                    (root / "assets" / "app.js").write_text(
                        source,
                        encoding="utf-8",
                    )
                    verify_static_code(root)

    def test_required_maintenance_files_and_cursor_rule_are_enforced(self):
        required_files = [
            "AGENTS.md",
            "README.md",
            "docs/AI-MAINTENANCE.md",
            "docs/prompts/update-questions.md",
            "docs/prompts/improve-ui.md",
        ]
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            for relative_path in required_files:
                path = root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(
                    "<!-- [skill: go-team-standards · dev-dna] 文档 -->\n",
                    encoding="utf-8",
                )

            rule = root / ".cursor" / "rules" / "project-maintenance.mdc"
            rule.parent.mkdir(parents=True)
            rule.write_text(
                "---\ndescription: Maintain the offline project\n"
                "alwaysApply: true\n---\n# Rules\n",
                encoding="utf-8",
            )

            verify_required_files(root)

            rule.write_text(
                "---\ndescription: Invalid rule\nalwaysApply: false\n---\n"
                + "\n".join("# line" for _ in range(50)),
                encoding="utf-8",
            )
            with self.assertRaises(VerificationError):
                verify_required_files(root)


if __name__ == "__main__":
    unittest.main()
