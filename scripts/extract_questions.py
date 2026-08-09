#!/usr/bin/env python3
# [skill: go-team-standards · dev-dna] 提取并严格清理本地文章题目

import argparse
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path


_QUESTION_HEADING_RE = re.compile(r"^\s*(\d{1,3})\s+(.+)$")
_CODE_CLASS_RE = re.compile(r"language-[a-z0-9_-]+")
_EMPTY_BLOCK_RE = re.compile(
    r'<(?P<tag>p|ul|ol|li|pre|code|strong|b|em|i|blockquote)'
    r'(?: class="language-[a-z0-9_-]+")?>'
    r"(?:\s|<br>)*"
    r"</(?P=tag)>"
)

_ALLOWED_TAGS = {
    "p",
    "ul",
    "ol",
    "li",
    "pre",
    "code",
    "strong",
    "b",
    "em",
    "i",
    "blockquote",
    "br",
}
_SKIPPED_TAGS = {"script", "style", "svg", "button", "form", "noscript"}


def _has_article_class(attrs):
    return any(
        name == "class"
        and value is not None
        and "Post-RichText" in value.split()
        for name, value in attrs
    )


def _safe_start_tag(tag, attrs):
    if tag == "br":
        return "<br>"
    if tag != "code":
        return "<{}>".format(tag)

    for name, value in attrs:
        if name != "class" or value is None:
            continue
        for class_name in value.split():
            if _CODE_CLASS_RE.fullmatch(class_name):
                return '<code class="{}">'.format(class_name)
    return "<code>"


def _normalize_answer(parts):
    answer = "".join(parts).strip()
    while answer:
        normalized = _EMPTY_BLOCK_RE.sub("", answer).strip()
        if normalized == answer:
            break
        answer = normalized
    return answer


class _ArticleParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.questions = []
        self._inside_article = False
        self._article_div_depth = 0
        self._skip_stack = []
        self._in_heading = False
        self._heading_parts = []
        self._current_id = None
        self._current_question = None
        self._answer_parts = []
        self._stopped = False

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()

        if self._skip_stack:
            if tag in _SKIPPED_TAGS:
                self._skip_stack.append(tag)
            return
        if tag in _SKIPPED_TAGS:
            self._skip_stack.append(tag)
            return

        if not self._inside_article:
            if (
                not self._stopped
                and tag == "div"
                and _has_article_class(attrs)
            ):
                self._inside_article = True
                self._article_div_depth = 1
            return

        if tag == "div":
            self._article_div_depth += 1

        if self._stopped:
            return

        if tag == "h2" and self._current_id is not None:
            self._finish_current()
            self._stopped = True
            return

        if tag == "h3":
            self._in_heading = True
            self._heading_parts = []
            return

        if self._in_heading or self._current_id is None:
            return

        if tag in _ALLOWED_TAGS:
            self._answer_parts.append(_safe_start_tag(tag, attrs))

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()

        if self._skip_stack or tag in _SKIPPED_TAGS:
            return
        if not self._inside_article or self._stopped:
            return
        if tag == "h2" and self._current_id is not None:
            self._finish_current()
            self._stopped = True
            return
        if self._in_heading or self._current_id is None:
            return
        if tag in _ALLOWED_TAGS:
            self._answer_parts.append(_safe_start_tag(tag, attrs))
            if tag != "br":
                self._answer_parts.append("</{}>".format(tag))

    def handle_endtag(self, tag):
        tag = tag.lower()

        if self._skip_stack:
            if tag == self._skip_stack[-1]:
                self._skip_stack.pop()
            return
        if not self._inside_article:
            return

        if tag == "h3" and self._in_heading and not self._stopped:
            self._in_heading = False
            self._handle_heading("".join(self._heading_parts))
            self._heading_parts = []
            return

        if tag == "div":
            self._article_div_depth -= 1
            if self._article_div_depth == 0:
                self._finish_current()
                self._inside_article = False
            return

        if self._stopped or self._in_heading or self._current_id is None:
            return
        if tag in _ALLOWED_TAGS and tag != "br":
            self._answer_parts.append("</{}>".format(tag))

    def handle_data(self, data):
        if (
            self._skip_stack
            or not self._inside_article
            or self._stopped
        ):
            return
        if self._in_heading:
            self._heading_parts.append(data)
        elif self._current_id is not None:
            self._answer_parts.append(html.escape(data))

    def finish(self):
        self._finish_current()

    def _handle_heading(self, heading):
        normalized_heading = " ".join(heading.split())
        match = _QUESTION_HEADING_RE.fullmatch(normalized_heading)
        if match is None:
            return

        self._finish_current()
        self._current_id = int(match.group(1))
        self._current_question = match.group(2).replace("❤", "").strip()
        self._answer_parts = []

    def _finish_current(self):
        if self._current_id is None:
            return
        self.questions.append(
            {
                "id": self._current_id,
                "question": self._current_question,
                "answerHtml": _normalize_answer(self._answer_parts),
            }
        )
        self._current_id = None
        self._current_question = None
        self._answer_parts = []


class _MarkupSafetyParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._open_tags = []

    def handle_starttag(self, tag, attrs):
        normalized_tag = self._check(tag, attrs)
        if normalized_tag != "br":
            self._open_tags.append(normalized_tag)

    def handle_startendtag(self, tag, attrs):
        self._check(tag, attrs)

    def handle_endtag(self, tag):
        normalized_tag = self._check_tag(tag)
        if not self._open_tags or self._open_tags[-1] != normalized_tag:
            raise ValueError("标签 </{}> 嵌套不匹配".format(tag))
        self._open_tags.pop()

    def finish(self):
        if self._open_tags:
            raise ValueError(
                "标签 <{}> 未闭合".format(self._open_tags[-1])
            )

    @staticmethod
    def _check(tag, attrs):
        normalized_tag = _MarkupSafetyParser._check_tag(tag)
        if not attrs:
            return normalized_tag
        if (
            normalized_tag == "code"
            and len(attrs) == 1
            and attrs[0][0].lower() == "class"
            and attrs[0][1] is not None
            and _CODE_CLASS_RE.fullmatch(attrs[0][1])
        ):
            return normalized_tag

        attribute_names = ", ".join(name for name, _ in attrs)
        raise ValueError(
            "标签 <{}> 包含不允许的属性 {}".format(
                normalized_tag,
                attribute_names,
            )
        )

    @staticmethod
    def _check_tag(tag):
        normalized_tag = tag.lower()
        if normalized_tag not in _ALLOWED_TAGS:
            raise ValueError("包含不允许的标签 <{}>".format(tag))
        return normalized_tag


class _TextContentParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def _validate_safe_markup(fragment):
    parser = _MarkupSafetyParser()
    parser.feed(fragment)
    parser.close()
    parser.finish()


def _has_visible_text(fragment):
    parser = _TextContentParser()
    parser.feed(fragment)
    parser.close()
    return bool("".join(parser.parts).strip())


def extract_questions(source_html: str) -> list[dict]:
    """Return [{"id": int, "question": str, "answerHtml": str}, ...]."""
    parser = _ArticleParser()
    parser.feed(source_html)
    parser.close()
    parser.finish()
    return parser.questions


def validate_questions(
    questions: list[dict],
    expected_ids: list[int] = list(range(1, 101)),
) -> None:
    """Raise ValueError for missing, duplicate, empty, or unsafe content."""
    if not isinstance(questions, list):
        raise ValueError("题库必须是列表")

    ids = []
    for index, item in enumerate(questions):
        if not isinstance(item, dict):
            raise ValueError("第 {} 条题目记录格式错误".format(index + 1))
        question_id = item.get("id")
        if not isinstance(question_id, int) or isinstance(question_id, bool):
            raise ValueError("第 {} 条题号无效".format(index + 1))
        ids.append(question_id)

    if len(ids) != len(set(ids)):
        raise ValueError("题号重复")

    if len(expected_ids) != len(set(expected_ids)):
        raise ValueError("预期题号重复")

    actual_id_set = set(ids)
    expected_id_set = set(expected_ids)
    missing = [
        question_id
        for question_id in expected_ids
        if question_id not in actual_id_set
    ]
    unexpected = [
        question_id
        for question_id in ids
        if question_id not in expected_id_set
    ]
    if missing or unexpected:
        details = []
        if missing:
            details.append("缺少 {}".format(missing))
        if unexpected:
            details.append("多出 {}".format(unexpected))
        raise ValueError("题号不匹配：{}".format("；".join(details)))

    for item in questions:
        question_id = item["id"]
        question = item.get("question")
        answer = item.get("answerHtml")
        if not isinstance(question, str) or not question.strip():
            raise ValueError("题号 {} 的问题为空".format(question_id))
        if (
            not isinstance(answer, str)
            or not answer.strip()
            or not _has_visible_text(answer)
        ):
            raise ValueError("题号 {} 的答案为空".format(question_id))

        try:
            _validate_safe_markup(question)
            _validate_safe_markup(answer)
        except ValueError as error:
            raise ValueError(
                "题号 {} 的内容不安全：{}".format(question_id, error)
            ) from error


def _main():
    argument_parser = argparse.ArgumentParser(
        description="Extract sanitized interview questions from an HTML file."
    )
    argument_parser.add_argument("source_html", type=Path)
    argument_parser.add_argument("output_json", type=Path)
    args = argument_parser.parse_args()

    questions = extract_questions(
        args.source_html.read_text(encoding="utf-8")
    )
    validate_questions(questions)
    args.output_json.write_text(
        json.dumps(questions, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    ids = sorted(item["id"] for item in questions)
    print(
        "extracted {} questions: {}..{}".format(
            len(questions),
            ids[0],
            ids[-1],
        )
    )


if __name__ == "__main__":
    _main()
