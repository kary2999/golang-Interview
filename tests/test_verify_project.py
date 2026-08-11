# [skill: go-team-standards · dev-dna] 验证仓库级离线与维护约束
import copy
import json
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_questions import render_questions_js
from scripts.verify_project import (
    VerificationError,
    _mask_javascript_non_code,
    parse_questions_js,
    verify_index,
    verify_pwa,
    verify_project,
    verify_question_records,
    verify_required_files,
    verify_static_code,
)


VALID_MANIFEST = {
    "name": "Go 面试冲刺营",
    "short_name": "Go 冲刺营",
    "description": "可离线安装的 Go 面试单卡快刷应用",
    "lang": "zh-CN",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "background_color": "#f7f3e9",
    "theme_color": "#6857e5",
    "icons": [
        {
            "src": "assets/icons/icon-192.png",
            "sizes": "192x192",
            "type": "image/png",
        },
        {
            "src": "assets/icons/icon-512.png",
            "sizes": "512x512",
            "type": "image/png",
        },
        {
            "src": "assets/icons/icon-maskable-512.png",
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "maskable",
        },
    ],
}

VALID_SERVICE_WORKER = """// Local test fixture
const CACHE_NAME = "go-interview-v2";
const APP_SHELL = Object.freeze([
  "./",
  "./index.html",
  "./assets/styles.css",
  "./assets/app.js",
  "./data/questions.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png"
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => (
            cacheName.startsWith("go-interview-")
            && cacheName !== CACHE_NAME
          ))
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    return await fetch(request);
  } catch (error) {
    const fallback = await cache.match("./index.html");
    if (fallback) {
      return fallback;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  return fetch(request);
}
"""


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


def write_png(path, width, height):
    def chunk(chunk_type, payload):
        checksum = zlib.crc32(chunk_type + payload) & 0xFFFFFFFF
        return (
            struct.pack(">I", len(payload))
            + chunk_type
            + payload
            + struct.pack(">I", checksum)
        )

    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    scanlines = b"".join(
        b"\x00" + (b"\x00" * width)
        for _ in range(height)
    )
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(scanlines))
        + chunk(b"IEND", b"")
    )


def write_valid_page(root):
    (root / "assets").mkdir(parents=True)
    (root / "assets" / "icons").mkdir()
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
    (root / "manifest.webmanifest").write_text(
        json.dumps(VALID_MANIFEST, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (root / "service-worker.js").write_text(
        VALID_SERVICE_WORKER,
        encoding="utf-8",
    )
    (root / "assets" / "icons" / "app-icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" '
        'viewBox="0 0 512 512"></svg>\n',
        encoding="utf-8",
    )
    write_png(root / "assets" / "icons" / "icon-192.png", 192, 192)
    write_png(root / "assets" / "icons" / "icon-512.png", 512, 512)
    write_png(
        root / "assets" / "icons" / "icon-maskable-512.png",
        512,
        512,
    )
    (root / "index.html").write_text(
        """<!doctype html>
<html lang="zh-CN">
<head>
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="stylesheet" href="assets/styles.css">
</head>
<body>
  <main id="app"></main>
  <span id="build-tag" class="build-tag">v2</span>
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

    def test_javascript_mask_tracks_regex_context_and_source_shape(self):
        source = (
            r"const marker = /[\/\]{}]+/gimu;" "\n"
            "const ratio = total / count / scale;\n"
            'const note = `outer ${/}/.test("}") '
            '? fetch("/x") : "safe"}`;\n'
        )

        masked = _mask_javascript_non_code(source)

        self.assertEqual(len(masked), len(source))
        self.assertEqual(
            [
                index
                for index, character in enumerate(masked)
                if character == "\n"
            ],
            [
                index
                for index, character in enumerate(source)
                if character == "\n"
            ],
        )
        regex_literal = r"/[\/\]{}]+/gimu"
        regex_start = source.index(regex_literal)
        self.assertEqual(
            masked[regex_start:regex_start + len(regex_literal)],
            " " * len(regex_literal),
        )
        self.assertIn("total / count / scale", masked)
        self.assertIn("fetch(", masked)

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
            "escaped slash regex before fetch": (
                r'const marker = /\/\//; fetch("/questions.json");'
            ),
            "regex brace inside template interpolation": (
                'const x = `outer ${/}/.test("}") '
                '? fetch("/x") : "safe"}`;'
            ),
            "regex class inside template interpolation": (
                r"const x = `outer ${/[}\/]/gi.test(value) "
                r'? new EventSource("/events") : "safe"}`;'
            ),
            "escaped class regex before beacon": (
                r"const marker = /[\/\]]+\/\/[a-z]/gi; "
                'navigator.sendBeacon("/telemetry", "payload");'
            ),
            "regex flags before WebSocket": (
                'const marker = /offline/giu; new WebSocket("/updates");'
            ),
            "division before fetch": (
                'const ratio = total / count / scale; fetch("/x");'
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
            "harmless regex literals": (
                r"const marker = /\/\//g; "
                r"const bracket = /[\/\]{}]+/imu;" "\n"
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

    def test_pwa_contract_accepts_valid_local_resources(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            write_valid_page(root)

            verify_pwa(root)

    def test_pwa_contract_requires_exact_manifest_essentials(self):
        invalid_values = {
            "name": "Other app",
            "short_name": "Other",
            "lang": "en",
            "start_url": "/",
            "scope": "/",
            "display": "browser",
            "background_color": "#ffffff",
            "theme_color": "#000000",
        }
        for field, invalid_value in invalid_values.items():
            with self.subTest(field=field):
                with tempfile.TemporaryDirectory() as temporary_directory:
                    root = Path(temporary_directory)
                    write_valid_page(root)
                    manifest_path = root / "manifest.webmanifest"
                    manifest = json.loads(
                        manifest_path.read_text(encoding="utf-8")
                    )
                    manifest[field] = invalid_value
                    manifest_path.write_text(
                        json.dumps(manifest, ensure_ascii=False),
                        encoding="utf-8",
                    )

                    with self.assertRaises(VerificationError):
                        verify_pwa(root)

    def test_pwa_contract_rejects_remote_manifest_urls(self):
        mutations = {
            "remote start URL": lambda manifest: manifest.update(
                {"start_url": "https://example.com/"}
            ),
            "remote scope": lambda manifest: manifest.update(
                {"scope": "https://example.com/"}
            ),
            "remote icon": lambda manifest: manifest["icons"][0].update(
                {"src": "https://example.com/icon.png"}
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                with tempfile.TemporaryDirectory() as temporary_directory:
                    root = Path(temporary_directory)
                    write_valid_page(root)
                    manifest_path = root / "manifest.webmanifest"
                    manifest = json.loads(
                        manifest_path.read_text(encoding="utf-8")
                    )
                    mutate(manifest)
                    manifest_path.write_text(
                        json.dumps(manifest, ensure_ascii=False),
                        encoding="utf-8",
                    )

                    with self.assertRaises(VerificationError):
                        verify_pwa(root)

    def test_pwa_contract_rejects_missing_or_wrong_icons(self):
        mutations = {
            "missing icon": lambda path: path.unlink(),
            "wrong signature": lambda path: path.write_bytes(b"not a PNG"),
            "wrong dimensions": lambda path: write_png(path, 191, 192),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                with tempfile.TemporaryDirectory() as temporary_directory:
                    root = Path(temporary_directory)
                    write_valid_page(root)
                    icon_path = (
                        root / "assets" / "icons" / "icon-192.png"
                    )
                    mutate(icon_path)

                    with self.assertRaises(VerificationError):
                        verify_pwa(root)

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            write_valid_page(root)
            manifest_path = root / "manifest.webmanifest"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["icons"][2]["purpose"] = "any"
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=False),
                encoding="utf-8",
            )

            with self.assertRaises(VerificationError):
                verify_pwa(root)

    def test_pwa_contract_requires_a_build_tag_matching_the_cache(self):
        mutations = {
            "missing tag": lambda source: source.replace(
                '  <span id="build-tag" class="build-tag">v2</span>\n',
                "",
            ),
            "stale tag": lambda source: source.replace(">v2<", ">v1<"),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                with tempfile.TemporaryDirectory() as temporary_directory:
                    root = Path(temporary_directory)
                    write_valid_page(root)
                    index_path = root / "index.html"
                    index_path.write_text(
                        mutate(index_path.read_text(encoding="utf-8")),
                        encoding="utf-8",
                    )

                    with self.assertRaises(VerificationError):
                        verify_pwa(root)

    def test_service_worker_rejects_remote_or_uncontrolled_cache_entries(self):
        mutations = {
            "remote entry": lambda source: source.replace(
                '  "./assets/app.js",\n',
                '  "https://example.com/app.js",\n',
            ),
            "missing shell entry": lambda source: source.replace(
                '  "./data/questions.js",\n',
                "",
            ),
            "extra shell entry": lambda source: source.replace(
                '  "./manifest.webmanifest",\n',
                '  "./manifest.webmanifest",\n  "./extra.js",\n',
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                with tempfile.TemporaryDirectory() as temporary_directory:
                    root = Path(temporary_directory)
                    write_valid_page(root)
                    worker_path = root / "service-worker.js"
                    worker_path.write_text(
                        mutate(worker_path.read_text(encoding="utf-8")),
                        encoding="utf-8",
                    )

                    with self.assertRaises(VerificationError):
                        verify_pwa(root)

    def test_service_worker_requires_same_origin_get_interception(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            write_valid_page(root)
            worker_path = root / "service-worker.js"
            worker_path.write_text(
                worker_path.read_text(encoding="utf-8").replace(
                    (
                        'request.method !== "GET" '
                        '|| url.origin !== self.location.origin'
                    ),
                    'request.method !== "GET"',
                ),
                encoding="utf-8",
            )

            with self.assertRaises(VerificationError):
                verify_pwa(root)

    def test_pwa_contract_rejects_absent_pwa_files(self):
        for relative_path in (
            "manifest.webmanifest",
            "service-worker.js",
            "assets/icons/app-icon.svg",
        ):
            with self.subTest(relative_path=relative_path):
                with tempfile.TemporaryDirectory() as temporary_directory:
                    root = Path(temporary_directory)
                    write_valid_page(root)
                    (root / relative_path).unlink()

                    with self.assertRaises(VerificationError):
                        verify_pwa(root)

    def test_complete_project_verification_calls_pwa_verifier(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            write_valid_page(root)

            with (
                mock.patch(
                    "scripts.verify_project.verify_pwa",
                    wraps=verify_pwa,
                ) as pwa_verifier,
                mock.patch("scripts.verify_project.verify_required_files"),
            ):
                verify_project(root)

            pwa_verifier.assert_called_once_with(root)

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
