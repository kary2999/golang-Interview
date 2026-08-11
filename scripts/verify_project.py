#!/usr/bin/env python3
# [skill: go-team-standards · dev-dna] 校验离线题库、页面边界与 AI 维护契约

import json
import re
import struct
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

if __package__:
    from .build_questions import render_questions_js
    from .extract_questions import validate_questions
else:
    from build_questions import render_questions_js
    from extract_questions import validate_questions


_EXPECTED_IDS = list(range(1, 101))
_SUPPLEMENTED_IDS = {73, 89, 90}
_VALID_SOURCES = {"zhihu-archive", "supplemented"}
_REQUIRED_SCRIPT_SOURCES = [
    "data/questions.js",
    "assets/app.js",
]
_REQUIRED_STYLESHEET = "assets/styles.css"
_PWA_MANIFEST_PATH = "manifest.webmanifest"
_PWA_SERVICE_WORKER_PATH = "service-worker.js"
_PWA_ICON_SOURCE_PATH = "assets/icons/app-icon.svg"
_PWA_MANIFEST_FIELDS = {
    "name": "Go 面试冲刺营",
    "short_name": "Go 冲刺营",
    "description": "可离线安装的 Go 面试单卡快刷应用",
    "lang": "zh-CN",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "background_color": "#f7f3e9",
    "theme_color": "#6857e5",
}
_PWA_ICONS = [
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
]
_PWA_APP_SHELL = [
    "./",
    "./index.html",
    "./assets/styles.css",
    "./assets/app.js",
    "./data/questions.js",
    "./manifest.webmanifest",
    "./assets/icons/icon-192.png",
    "./assets/icons/icon-512.png",
    "./assets/icons/icon-maskable-512.png",
]
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_REQUIRED_MAINTENANCE_FILES = [
    "AGENTS.md",
    "README.md",
    "docs/AI-MAINTENANCE.md",
    "docs/prompts/update-questions.md",
    "docs/prompts/improve-ui.md",
]
_DATA_ASSIGNMENT_RE = re.compile(
    r"\A"
    r"(?://[^\n]*\n)+"
    r"window\.GO_INTERVIEW_QUESTIONS = Object\.freeze\(\n"
    r"(?P<payload>\[.*\])\n"
    r"\);\n"
    r"\Z",
    re.DOTALL,
)
_REMOTE_URL_RE = re.compile(
    r"(?i)(?:https?:)?//[a-z0-9]"
)
_EXECUTABLE_JAVASCRIPT_PATTERNS = {
    "fetch 调用": re.compile(r"\bfetch\s*\("),
    "动态 import": re.compile(r"\bimport\s*\("),
    "XMLHttpRequest 调用": re.compile(
        r"\b(?:new\s+)?(?:(?:window|globalThis)\s*\.\s*)?"
        r"XMLHttpRequest\s*\("
    ),
    "WebSocket 调用": re.compile(
        r"\b(?:new\s+)?(?:(?:window|globalThis)\s*\.\s*)?"
        r"WebSocket\s*\("
    ),
    "EventSource 调用": re.compile(
        r"\b(?:new\s+)?(?:(?:window|globalThis)\s*\.\s*)?"
        r"EventSource\s*\("
    ),
    "WebTransport 调用": re.compile(
        r"\b(?:new\s+)?(?:(?:window|globalThis)\s*\.\s*)?"
        r"WebTransport\s*\("
    ),
    "sendBeacon 调用": re.compile(
        r"\b(?:(?:window|globalThis)\s*\.\s*)?"
        r"navigator\s*\.\s*sendBeacon\s*\("
    ),
}
_RAW_STATIC_PATTERNS = {
    "远程 URL": _REMOTE_URL_RE,
    "CSS @import": re.compile(r"(?i)@import\b"),
}
_SERVICE_WORKER_APP_SHELL_RE = re.compile(
    r"\bconst\s+APP_SHELL\s*=\s*Object\.freeze\(\s*"
    r"(?P<entries>\[.*?\])\s*\)\s*;",
    re.DOTALL,
)
_BUILD_TAG_RE = re.compile(
    r'<span\b[^>]*\bid="build-tag"[^>]*>(?P<tag>[^<]*)</span>'
)
_SERVICE_WORKER_CACHE_NAME_RE = re.compile(
    r'\bconst\s+CACHE_NAME\s*=\s*"(?P<name>[^"]+)"\s*;'
)


class VerificationError(RuntimeError):
    """Raised when the repository violates a project contract."""


def _lex_javascript_masks(source):
    """Return executable and raw-resource masks for focused JS verification.

    A slash starts a regex only where an expression may begin: at the start,
    after an opening delimiter or operator, or after a prefix keyword such as
    ``return``. Slashes after expression-ending tokens are treated as division.
    This focused heuristic avoids pretending to be a complete JavaScript parser.
    """
    executable_mask = list(source)
    resource_mask = list(source)
    source_length = len(source)
    regex_prefix_keywords = {
        "await",
        "case",
        "delete",
        "do",
        "else",
        "in",
        "instanceof",
        "new",
        "of",
        "return",
        "throw",
        "typeof",
        "void",
        "yield",
    }

    def mask_character(target, index):
        if source[index] not in "\r\n":
            target[index] = " "

    def mask_non_code(index):
        mask_character(executable_mask, index)

    def mask_regex(index):
        mask_character(executable_mask, index)
        mask_character(resource_mask, index)

    def consume_quoted(index, quote):
        mask_non_code(index)
        index += 1
        while index < source_length:
            character = source[index]
            mask_non_code(index)
            if character == "\\":
                index += 1
                if index < source_length:
                    mask_non_code(index)
                    index += 1
            elif character == quote:
                return index + 1
            else:
                index += 1
        return index

    def consume_line_comment(index):
        while (
            index < source_length
            and source[index] not in "\r\n"
        ):
            mask_non_code(index)
            index += 1
        return index

    def consume_block_comment(index):
        while index < source_length:
            if source.startswith("*/", index):
                mask_non_code(index)
                mask_non_code(index + 1)
                return index + 2
            mask_non_code(index)
            index += 1
        return index

    def consume_regex(index):
        cursor = index + 1
        inside_character_class = False
        while cursor < source_length:
            character = source[cursor]
            if character in "\r\n":
                return None
            if character == "\\":
                cursor += 2
                continue
            if character == "[" and not inside_character_class:
                inside_character_class = True
                cursor += 1
                continue
            if character == "]" and inside_character_class:
                inside_character_class = False
                cursor += 1
                continue
            if character == "/" and not inside_character_class:
                cursor += 1
                while (
                    cursor < source_length
                    and source[cursor] in "dgimsuvy"
                ):
                    cursor += 1
                for masked_index in range(index, cursor):
                    mask_regex(masked_index)
                return cursor
            cursor += 1
        return None

    def consume_identifier(index):
        cursor = index + 1
        while cursor < source_length and (
            source[cursor].isalnum()
            or source[cursor] in {"_", "$"}
        ):
            cursor += 1
        return cursor

    def consume_number(index):
        cursor = index + 1
        while cursor < source_length and (
            source[cursor].isalnum()
            or source[cursor] in {"_", "."}
        ):
            cursor += 1
        return cursor

    def consume_template(index):
        mask_non_code(index)
        index += 1
        while index < source_length:
            character = source[index]
            if character == "\\":
                mask_non_code(index)
                index += 1
                if index < source_length:
                    mask_non_code(index)
                    index += 1
            elif character == "`":
                mask_non_code(index)
                return index + 1
            elif source.startswith("${", index):
                mask_non_code(index)
                mask_non_code(index + 1)
                index = consume_code(index + 2, inside_template=True)
            else:
                mask_non_code(index)
                index += 1
        return index

    def consume_code(index, inside_template=False):
        brace_depth = 1 if inside_template else 0
        can_start_regex = True
        while index < source_length:
            character = source[index]
            if source.startswith("//", index):
                index = consume_line_comment(index)
            elif source.startswith("/*", index):
                index = consume_block_comment(index)
            elif character in {"'", '"'}:
                index = consume_quoted(index, character)
                can_start_regex = False
            elif character == "`":
                index = consume_template(index)
                can_start_regex = False
            elif character == "/":
                if can_start_regex:
                    regex_end = consume_regex(index)
                    if regex_end is not None:
                        index = regex_end
                        can_start_regex = False
                        continue
                index += 2 if source.startswith("/=", index) else 1
                can_start_regex = True
            elif character.isalpha() or character in {"_", "$"}:
                identifier_end = consume_identifier(index)
                identifier = source[index:identifier_end]
                can_start_regex = identifier in regex_prefix_keywords
                index = identifier_end
            elif character.isdigit() or (
                character == "."
                and index + 1 < source_length
                and source[index + 1].isdigit()
            ):
                index = consume_number(index)
                can_start_regex = False
            elif inside_template and character == "{":
                brace_depth += 1
                index += 1
                can_start_regex = True
            elif inside_template and character == "}":
                brace_depth -= 1
                if brace_depth == 0:
                    mask_non_code(index)
                    return index + 1
                index += 1
                can_start_regex = False
            elif source.startswith(("++", "--", "?."), index):
                index += 2
                can_start_regex = False
            elif character in {")", "]", "}"}:
                index += 1
                can_start_regex = False
            elif character == ".":
                index += 1
                can_start_regex = False
            elif character in {"(", "[", "{"}:
                index += 1
                can_start_regex = True
            elif character in {
                ",",
                ";",
                ":",
                "?",
                "=",
                "!",
                "&",
                "|",
                "+",
                "-",
                "*",
                "%",
                "^",
                "~",
                "<",
                ">",
            }:
                index += 1
                can_start_regex = True
            else:
                index += 1
        return index

    consume_code(0)
    return "".join(executable_mask), "".join(resource_mask)


def _mask_javascript_non_code(source):
    """Mask comments and literal text while retaining executable code."""
    executable_mask, _ = _lex_javascript_masks(source)
    return executable_mask


class _IndexParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.resources = []
        self.scripts = []
        self.stylesheets = []
        self.manifests = []
        self.inline_script_count = 0
        self.inline_event_attributes = []

    def handle_starttag(self, tag, attrs):
        self._handle_tag(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        self._handle_tag(tag, attrs)

    def _handle_tag(self, tag, attrs):
        normalized_tag = tag.lower()
        normalized_attrs = [
            (
                name.lower(),
                "" if value is None else value,
            )
            for name, value in attrs
        ]
        attributes = dict(normalized_attrs)

        for name, value in normalized_attrs:
            if name.startswith("on"):
                self.inline_event_attributes.append(name)
            if name in {"src", "href"}:
                self.resources.append(
                    (normalized_tag, name, value)
                )

        if normalized_tag == "script":
            source = attributes.get("src")
            script_type = attributes.get("type", "").strip().lower()
            if source is None:
                self.inline_script_count += 1
            self.scripts.append((source, script_type))

        if normalized_tag == "link":
            relation = attributes.get("rel", "").strip().lower()
            if relation == "stylesheet":
                self.stylesheets.append(attributes.get("href"))
            if "manifest" in relation.split():
                self.manifests.append(attributes.get("href"))


def parse_questions_js(content):
    """Parse the exact deterministic static data assignment without eval."""
    if not isinstance(content, str):
        raise VerificationError("题库 JavaScript 必须是文本")

    match = _DATA_ASSIGNMENT_RE.fullmatch(content)
    if match is None:
        raise VerificationError("data/questions.js 不是受支持的静态赋值格式")
    try:
        records = json.loads(match.group("payload"))
    except json.JSONDecodeError as error:
        raise VerificationError(
            "data/questions.js 的 JSON 数据无法解析"
        ) from error

    try:
        canonical = render_questions_js(records)
    except (TypeError, ValueError) as error:
        raise VerificationError(
            "data/questions.js 未通过确定性渲染校验：{}".format(error)
        ) from error
    if content != canonical:
        raise VerificationError(
            "data/questions.js 与构建脚本的确定性输出不一致"
        )
    return records


def verify_question_records(records):
    """Verify ordering, provenance, nonempty content, and strict markup."""
    try:
        validate_questions(records, expected_ids=_EXPECTED_IDS)
    except (TypeError, ValueError) as error:
        raise VerificationError("题库内容无效：{}".format(error)) from error

    ids = [record["id"] for record in records]
    if ids != _EXPECTED_IDS:
        raise VerificationError("题号必须按 1..100 顺序排列")

    supplemented_ids = set()
    for record in records:
        question_id = record["id"]
        source = record.get("source")
        if source not in _VALID_SOURCES:
            raise VerificationError(
                "题号 {} 使用了未知来源标签".format(question_id)
            )
        if source == "supplemented":
            supplemented_ids.add(question_id)

    if supplemented_ids != _SUPPLEMENTED_IDS:
        raise VerificationError("补充整理题号必须且只能是 73、89、90")


def _is_remote_reference(value):
    normalized = value.strip()
    if _REMOTE_URL_RE.search(normalized):
        return True
    return bool(re.match(r"(?i)^[a-z][a-z0-9+.-]*:", normalized))


def _resolve_local_reference(root, value):
    split = urlsplit(value)
    if split.scheme or split.netloc:
        raise VerificationError("页面包含远程或带协议的资源：{}".format(value))

    decoded_path = unquote(split.path)
    relative_path = Path(decoded_path)
    if (
        not decoded_path
        or relative_path.is_absolute()
        or ".." in relative_path.parts
    ):
        raise VerificationError("页面本地资源路径无效：{}".format(value))

    root_resolved = root.resolve()
    resolved = (root / relative_path).resolve()
    try:
        resolved.relative_to(root_resolved)
    except ValueError as error:
        raise VerificationError(
            "页面资源越出项目目录：{}".format(value)
        ) from error
    if not resolved.is_file():
        raise VerificationError("页面引用的文件不存在：{}".format(value))
    return resolved


def verify_index(root):
    """Verify the semantic entry page uses only the split local resources."""
    root = Path(root)
    index_path = root / "index.html"
    if not index_path.is_file():
        raise VerificationError("缺少 index.html")

    content = index_path.read_text(encoding="utf-8")
    parser = _IndexParser()
    try:
        parser.feed(content)
        parser.close()
    except Exception as error:
        raise VerificationError("index.html 无法解析") from error

    if parser.inline_script_count:
        raise VerificationError("index.html 禁止内联脚本或内嵌题库")
    if parser.inline_event_attributes:
        raise VerificationError("index.html 禁止内联事件处理器")
    if any(script_type == "module" for _, script_type in parser.scripts):
        raise VerificationError("index.html 禁止 module script")

    script_sources = [source for source, _ in parser.scripts]
    if script_sources != _REQUIRED_SCRIPT_SOURCES:
        raise VerificationError(
            "脚本必须依次加载 data/questions.js 和 assets/app.js"
        )
    if parser.stylesheets != [_REQUIRED_STYLESHEET]:
        raise VerificationError(
            "页面必须且只能加载 assets/styles.css 作为样式入口"
        )

    ordered_resources = [
        value
        for _, name, value in parser.resources
        if name in {"src", "href"}
    ]
    required_order = [
        _REQUIRED_STYLESHEET,
        *_REQUIRED_SCRIPT_SOURCES,
    ]
    try:
        required_positions = [
            ordered_resources.index(resource)
            for resource in required_order
        ]
    except ValueError as error:
        raise VerificationError("页面缺少必需的本地资源") from error
    if required_positions != sorted(required_positions):
        raise VerificationError("本地样式与脚本的加载顺序不正确")

    if "GO_INTERVIEW_QUESTIONS" in content:
        raise VerificationError("index.html 不得内嵌题库数据")

    for _, attribute, value in parser.resources:
        if not value or value.startswith("#"):
            continue
        if _is_remote_reference(value):
            raise VerificationError(
                "index.html 的 {} 包含远程资源：{}".format(
                    attribute,
                    value,
                )
            )
        _resolve_local_reference(root, value)


def verify_static_code(root):
    """Reject runtime network access and dynamic module loading."""
    root = Path(root)
    static_files = [
        root / "index.html",
        root / "assets" / "styles.css",
        root / "assets" / "app.js",
    ]
    for path in static_files:
        if not path.is_file():
            raise VerificationError(
                "缺少静态文件 {}".format(path.relative_to(root))
            )
        content = path.read_text(encoding="utf-8")
        if path.suffix == ".js":
            executable_content, resource_content = _lex_javascript_masks(
                content
            )
        else:
            executable_content = None
            resource_content = content

        for label, pattern in _RAW_STATIC_PATTERNS.items():
            match = pattern.search(resource_content)
            if match is not None:
                raise VerificationError(
                    "{}:{} 包含不允许的{}".format(
                        path.relative_to(root),
                        content.count("\n", 0, match.start()) + 1,
                        label,
                    )
                )
        if path.suffix != ".js":
            continue

        for label, pattern in _EXECUTABLE_JAVASCRIPT_PATTERNS.items():
            match = pattern.search(executable_content)
            if match is not None:
                raise VerificationError(
                    "{}:{} 包含不允许的{}".format(
                        path.relative_to(root),
                        executable_content.count(
                            "\n",
                            0,
                            match.start(),
                        ) + 1,
                        label,
                    )
                )


def _iter_json_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _iter_json_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _iter_json_strings(item)


def _verify_png(path, expected_size):
    try:
        with path.open("rb") as png_file:
            header = png_file.read(24)
    except OSError as error:
        raise VerificationError(
            "无法读取 PWA 图标 {}".format(path)
        ) from error

    if len(header) < 24 or header[:8] != _PNG_SIGNATURE:
        raise VerificationError("{} 不是有效的 PNG 图标".format(path))
    if header[8:16] != b"\x00\x00\x00\rIHDR":
        raise VerificationError("{} 缺少有效的 PNG IHDR".format(path))

    try:
        dimensions = struct.unpack(">II", header[16:24])
    except struct.error as error:
        raise VerificationError(
            "{} 的 PNG 尺寸无法读取".format(path)
        ) from error
    if dimensions != expected_size:
        raise VerificationError(
            "{} 的 PNG 尺寸必须为 {}x{}".format(
                path,
                expected_size[0],
                expected_size[1],
            )
        )


def _verify_manifest(root):
    manifest_path = root / _PWA_MANIFEST_PATH
    if not manifest_path.is_file():
        raise VerificationError("缺少 {}".format(_PWA_MANIFEST_PATH))

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise VerificationError("manifest.webmanifest 无法解析") from error
    if not isinstance(manifest, dict):
        raise VerificationError("manifest.webmanifest 顶层必须是对象")

    for value in _iter_json_strings(manifest):
        if _is_remote_reference(value):
            raise VerificationError(
                "manifest.webmanifest 包含远程或带协议的资源：{}".format(
                    value
                )
            )

    for field, expected_value in _PWA_MANIFEST_FIELDS.items():
        if manifest.get(field) != expected_value:
            raise VerificationError(
                "manifest.webmanifest 的 {} 必须为 {!r}".format(
                    field,
                    expected_value,
                )
            )

    if manifest.get("icons") != _PWA_ICONS:
        raise VerificationError("manifest.webmanifest 图标元数据不正确")

    for icon in _PWA_ICONS:
        icon_path = _resolve_local_reference(root, icon["src"])
        width, height = (
            int(dimension)
            for dimension in icon["sizes"].split("x", 1)
        )
        _verify_png(icon_path, (width, height))

    icon_source = root / _PWA_ICON_SOURCE_PATH
    if not icon_source.is_file():
        raise VerificationError(
            "缺少可维护图标源文件 {}".format(_PWA_ICON_SOURCE_PATH)
        )


def _verify_manifest_link(root):
    index_path = root / "index.html"
    if not index_path.is_file():
        raise VerificationError("缺少 index.html")

    parser = _IndexParser()
    try:
        content = index_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise VerificationError("index.html 无法读取 PWA 元数据") from error
    try:
        parser.feed(content)
        parser.close()
    except Exception as error:
        raise VerificationError("index.html 无法解析 PWA 元数据") from error

    if parser.manifests != [_PWA_MANIFEST_PATH]:
        raise VerificationError(
            "index.html 必须且只能引用 manifest.webmanifest"
        )


def _require_service_worker_pattern(source, pattern, message):
    if re.search(pattern, source, re.DOTALL) is None:
        raise VerificationError(message)


def _verify_build_tag(root, cache_name):
    """页面必须显示当前构建号，用户才能自己判断加载的是不是新版。"""
    index_path = root / "index.html"
    if not index_path.is_file():
        raise VerificationError("缺少 index.html")

    try:
        markup = index_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise VerificationError("index.html 无法读取") from error

    tag_matches = list(_BUILD_TAG_RE.finditer(markup))
    if len(tag_matches) != 1:
        raise VerificationError("index.html 必须声明唯一构建号 build-tag")

    tag = tag_matches[0].group("tag").strip()
    expected = cache_name.rsplit("-", 1)[-1]
    if tag != expected:
        raise VerificationError(
            "index.html 构建号 {} 与缓存 {} 不一致".format(tag, cache_name)
        )


def _verify_service_worker(root):
    worker_path = root / _PWA_SERVICE_WORKER_PATH
    if not worker_path.is_file():
        raise VerificationError("缺少 {}".format(_PWA_SERVICE_WORKER_PATH))

    try:
        source = worker_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise VerificationError("service-worker.js 无法读取") from error
    executable_source, resource_source = _lex_javascript_masks(source)

    remote_match = _REMOTE_URL_RE.search(resource_source)
    if remote_match is not None:
        raise VerificationError(
            "service-worker.js:{} 包含远程 URL".format(
                source.count("\n", 0, remote_match.start()) + 1
            )
        )

    for label, pattern in _EXECUTABLE_JAVASCRIPT_PATTERNS.items():
        if label == "fetch 调用":
            continue
        match = pattern.search(executable_source)
        if match is not None:
            raise VerificationError(
                "service-worker.js:{} 包含不允许的{}".format(
                    executable_source.count(
                        "\n",
                        0,
                        match.start(),
                    ) + 1,
                    label,
                )
            )
    if re.search(r"\bimportScripts\s*\(", executable_source):
        raise VerificationError("service-worker.js 禁止 importScripts")

    shell_matches = list(
        _SERVICE_WORKER_APP_SHELL_RE.finditer(source)
    )
    if len(shell_matches) != 1:
        raise VerificationError(
            "service-worker.js 必须声明唯一受控的 APP_SHELL"
        )
    try:
        app_shell = json.loads(shell_matches[0].group("entries"))
    except json.JSONDecodeError as error:
        raise VerificationError(
            "service-worker.js 的 APP_SHELL 无法解析"
        ) from error
    if app_shell != _PWA_APP_SHELL:
        raise VerificationError(
            "service-worker.js 的 APP_SHELL 条目不完整或不受控"
        )

    cache_matches = list(_SERVICE_WORKER_CACHE_NAME_RE.finditer(source))
    if len(cache_matches) != 1:
        raise VerificationError(
            "service-worker.js 必须声明唯一 CACHE_NAME"
        )
    cache_name = cache_matches[0].group("name")
    if re.fullmatch(r"go-interview-v[1-9][0-9]*", cache_name) is None:
        raise VerificationError(
            "service-worker.js 缓存名必须是版本化 go-interview 缓存"
        )
    _verify_build_tag(root, cache_name)

    listener_patterns = {
        event_name: re.compile(
            r"self\.addEventListener\s*\(\s*[\"']{}[\"']".format(
                event_name
            )
        )
        for event_name in ("install", "activate", "fetch", "message")
    }
    listener_positions = {}
    for event_name, pattern in listener_patterns.items():
        matches = list(pattern.finditer(source))
        if len(matches) != 1:
            raise VerificationError(
                "service-worker.js 必须声明唯一 {} 处理器".format(
                    event_name
                )
            )
        listener_positions[event_name] = matches[0].start()

    install_start = listener_positions["install"]
    activate_start = listener_positions["activate"]
    fetch_start = listener_positions["fetch"]
    message_start = listener_positions["message"]
    if not (
        install_start < activate_start < fetch_start < message_start
    ):
        raise VerificationError(
            "service-worker.js 生命周期处理器顺序不受控"
        )

    install_source = source[install_start:activate_start]
    _require_service_worker_pattern(
        install_source,
        r"event\.waitUntil\s*\(",
        "Service Worker install 必须等待预缓存完成",
    )
    _require_service_worker_pattern(
        install_source,
        r"caches\s*\.\s*open\s*\(\s*CACHE_NAME\s*\)",
        "Service Worker install 必须打开当前版本缓存",
    )
    _require_service_worker_pattern(
        install_source,
        r"cache\.addAll\s*\(\s*APP_SHELL\s*\)",
        "Service Worker install 必须原子预缓存完整应用壳",
    )
    if re.search(
        r"\.catch\s*\(",
        _mask_javascript_non_code(install_source),
    ):
        raise VerificationError(
            "Service Worker install 不得吞掉预缓存失败"
        )

    activate_source = source[activate_start:fetch_start]
    activate_requirements = {
        "activate 必须读取缓存列表": (
            r"caches\s*\.\s*keys\s*\(\s*\)"
        ),
        "activate 必须限定 go-interview 缓存": (
            r'cacheName\.startsWith\s*\(\s*"go-interview-"\s*\)'
        ),
        "activate 必须保留当前版本缓存": (
            r"cacheName\s*!==\s*CACHE_NAME"
        ),
        "activate 必须删除旧缓存": (
            r"caches\.delete\s*\(\s*cacheName\s*\)"
        ),
        "activate 必须接管现有客户端": (
            r"self\.clients\.claim\s*\(\s*\)"
        ),
    }
    for message, pattern in activate_requirements.items():
        _require_service_worker_pattern(
            activate_source,
            pattern,
            "Service Worker {}".format(message),
        )

    fetch_source = source[fetch_start:message_start]
    fetch_requirements = {
        "fetch 必须读取 event.request": (
            r"const\s+request\s*=\s*event\.request\s*;"
        ),
        "fetch 必须解析请求 URL": (
            r"const\s+url\s*=\s*new\s+URL\s*\(\s*request\.url\s*\)"
        ),
        "fetch 必须只处理同源 GET": (
            r"if\s*\(\s*request\.method\s*!==\s*[\"']GET[\"']\s*"
            r"\|\|\s*url\.origin\s*!==\s*self\.location\.origin\s*\)"
        ),
        "fetch 必须区分页面导航": (
            r"request\.mode\s*===\s*[\"']navigate[\"']"
        ),
        "页面导航必须使用 network-first": (
            r"networkFirstNavigation\s*\(\s*request\s*\)"
        ),
        "静态资源必须使用 cache-first": (
            r"cacheFirst\s*\(\s*request\s*\)"
        ),
    }
    for message, pattern in fetch_requirements.items():
        _require_service_worker_pattern(
            fetch_source,
            pattern,
            "Service Worker {}".format(message),
        )
    guard_position = re.search(
        fetch_requirements["fetch 必须只处理同源 GET"],
        fetch_source,
        re.DOTALL,
    ).start()
    response_position = fetch_source.find("event.respondWith")
    if response_position < guard_position:
        raise VerificationError(
            "Service Worker 必须先校验同源 GET 再拦截请求"
        )

    message_end = source.find("async function", message_start)
    if message_end == -1:
        message_end = len(source)
    message_source = source[message_start:message_end]
    _require_service_worker_pattern(
        message_source,
        r"event\.data\.type\s*===\s*[\"']SKIP_WAITING[\"']",
        "Service Worker 只能响应显式 SKIP_WAITING 消息",
    )
    if source.count("self.skipWaiting()") != 1:
        raise VerificationError(
            "Service Worker 不得自动或重复调用 skipWaiting"
        )
    if message_source.find("self.skipWaiting()") == -1:
        raise VerificationError(
            "Service Worker skipWaiting 必须位于 message 处理器"
        )

    navigation_requirements = {
        "缺少 network-first 导航函数": (
            r"async\s+function\s+networkFirstNavigation\s*\("
        ),
        "导航必须优先请求网络": r"\bfetch\s*\(\s*request\s*\)",
        "导航失败必须捕获错误": r"\bcatch\s*\(",
        "导航失败必须回退缓存首页": (
            r"cache\.match\s*\(\s*[\"']\./index\.html[\"']\s*\)"
        ),
        "缺少 cache-first 静态资源函数": (
            r"async\s+function\s+cacheFirst\s*\("
        ),
        "静态资源必须先查缓存": (
            r"caches\.match\s*\(\s*request\s*\)"
        ),
    }
    for message, pattern in navigation_requirements.items():
        _require_service_worker_pattern(source, pattern, message)

    fetch_calls = list(re.finditer(r"\bfetch\s*\(", executable_source))
    allowed_fetch_call = re.compile(
        r"\bfetch\s*\(\s*request\s*\)"
    )
    for fetch_call in fetch_calls:
        if allowed_fetch_call.match(
            executable_source,
            fetch_call.start(),
        ) is None:
            raise VerificationError(
                "service-worker.js 只能 fetch 当前同源 event.request"
            )


def verify_pwa(root):
    """Verify install metadata, local icons, and scoped offline caching."""
    root = Path(root)
    _verify_manifest(root)
    _verify_manifest_link(root)
    _verify_service_worker(root)


def _verify_markdown_marker(path):
    first_lines = path.read_text(encoding="utf-8").splitlines()[:10]
    if not any(
        "[skill: go-team-standards" in line
        for line in first_lines
    ):
        raise VerificationError(
            "{} 缺少技术文档 skill 标记".format(path)
        )


def _verify_cursor_rule(path):
    lines = path.read_text(encoding="utf-8").splitlines()
    if len(lines) >= 50:
        raise VerificationError("project-maintenance.mdc 必须少于 50 行")
    if not lines or lines[0].strip() != "---":
        raise VerificationError("Cursor 规则缺少 frontmatter")
    try:
        frontmatter_end = lines.index("---", 1)
    except ValueError as error:
        raise VerificationError("Cursor 规则 frontmatter 未闭合") from error

    frontmatter = lines[1:frontmatter_end]
    if not any(
        line.strip().lower() == "alwaysapply: true"
        for line in frontmatter
    ):
        raise VerificationError("Cursor 规则必须 alwaysApply: true")
    if not any(
        line.strip().lower().startswith("description:")
        for line in frontmatter
    ):
        raise VerificationError("Cursor 规则必须包含 description")


def verify_required_files(root):
    """Verify future-agent entry points and the always-applied rule."""
    root = Path(root)
    for relative_path in _REQUIRED_MAINTENANCE_FILES:
        path = root / relative_path
        if not path.is_file():
            raise VerificationError("缺少 AI 维护文件 {}".format(relative_path))
        _verify_markdown_marker(path)

    cursor_rule = (
        root / ".cursor" / "rules" / "project-maintenance.mdc"
    )
    if not cursor_rule.is_file():
        raise VerificationError(
            "缺少 .cursor/rules/project-maintenance.mdc"
        )
    _verify_cursor_rule(cursor_rule)


def verify_project(root):
    """Run the complete repository contract and return summary counts."""
    root = Path(root)
    data_path = root / "data" / "questions.js"
    if not data_path.is_file():
        raise VerificationError("缺少 data/questions.js")

    records = parse_questions_js(data_path.read_text(encoding="utf-8"))
    verify_question_records(records)
    verify_index(root)
    verify_static_code(root)
    verify_pwa(root)
    verify_required_files(root)
    return {
        "questions": len(records),
        "supplemented": len(_SUPPLEMENTED_IDS),
    }


def _main():
    root = Path(__file__).resolve().parents[1]
    try:
        summary = verify_project(root)
    except VerificationError as error:
        print("verification failed: {}".format(error), file=sys.stderr)
        raise SystemExit(1) from error

    print(
        "verified {} questions; {} supplemented; "
        "offline resources, PWA, and AI maintenance OK".format(
            summary["questions"],
            summary["supplemented"],
        )
    )


if __name__ == "__main__":
    _main()
