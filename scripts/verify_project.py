#!/usr/bin/env python3
# [skill: go-team-standards · dev-dna] 校验离线题库、页面边界与 AI 维护契约

import json
import re
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


class VerificationError(RuntimeError):
    """Raised when the repository violates a project contract."""


def _mask_javascript_non_code(source):
    """Mask comments and literal text while retaining template expressions."""
    masked = list(source)
    source_length = len(source)

    def mask_character(index):
        if source[index] not in "\r\n":
            masked[index] = " "

    def consume_quoted(index, quote):
        mask_character(index)
        index += 1
        while index < source_length:
            character = source[index]
            mask_character(index)
            if character == "\\":
                index += 1
                if index < source_length:
                    mask_character(index)
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
            mask_character(index)
            index += 1
        return index

    def consume_block_comment(index):
        while index < source_length:
            if source.startswith("*/", index):
                mask_character(index)
                mask_character(index + 1)
                return index + 2
            mask_character(index)
            index += 1
        return index

    def consume_template(index):
        mask_character(index)
        index += 1
        while index < source_length:
            character = source[index]
            if character == "\\":
                mask_character(index)
                index += 1
                if index < source_length:
                    mask_character(index)
                    index += 1
            elif character == "`":
                mask_character(index)
                return index + 1
            elif source.startswith("${", index):
                mask_character(index)
                mask_character(index + 1)
                index = consume_template_expression(index + 2)
            else:
                mask_character(index)
                index += 1
        return index

    def consume_template_expression(index):
        brace_depth = 1
        while index < source_length:
            if source.startswith("//", index):
                index = consume_line_comment(index)
            elif source.startswith("/*", index):
                index = consume_block_comment(index)
            elif source[index] in {"'", '"'}:
                index = consume_quoted(index, source[index])
            elif source[index] == "`":
                index = consume_template(index)
            elif source[index] == "{":
                brace_depth += 1
                index += 1
            elif source[index] == "}":
                brace_depth -= 1
                if brace_depth == 0:
                    mask_character(index)
                    return index + 1
                index += 1
            else:
                index += 1
        return index

    index = 0
    while index < source_length:
        if source.startswith("//", index):
            index = consume_line_comment(index)
        elif source.startswith("/*", index):
            index = consume_block_comment(index)
        elif source[index] in {"'", '"'}:
            index = consume_quoted(index, source[index])
        elif source[index] == "`":
            index = consume_template(index)
        else:
            index += 1

    return "".join(masked)


class _IndexParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.resources = []
        self.scripts = []
        self.stylesheets = []
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

        if (
            normalized_tag == "link"
            and attributes.get("rel", "").strip().lower() == "stylesheet"
        ):
            self.stylesheets.append(attributes.get("href"))


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
        for label, pattern in _RAW_STATIC_PATTERNS.items():
            match = pattern.search(content)
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

        executable_content = _mask_javascript_non_code(content)
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
        "offline resources and AI maintenance OK".format(
            summary["questions"],
            summary["supplemented"],
        )
    )


if __name__ == "__main__":
    _main()
