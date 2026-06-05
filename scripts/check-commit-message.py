#!/usr/bin/env python3
import re
import sys
from pathlib import Path


LINE_LIMIT = 75
URL_PATTERN = re.compile(r"https?://\S+")
TRAILER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]*: .+")


def collect_trailer_line_numbers(lines: list[tuple[int, str]]) -> set[int]:
    last_content_index = len(lines) - 1
    while last_content_index >= 0 and lines[last_content_index][1] == "":
        last_content_index -= 1

    trailer_start_index = last_content_index
    while trailer_start_index >= 0 and TRAILER_PATTERN.match(lines[trailer_start_index][1]):
        trailer_start_index -= 1

    first_trailer_index = trailer_start_index + 1
    if first_trailer_index > last_content_index:
        return set()

    if first_trailer_index == 0 or lines[first_trailer_index - 1][1] != "":
        return set()

    return {
        line_num
        for line_num, _line in lines[first_trailer_index : last_content_index + 1]
    }


def is_exempt(line_num: int, line: str, trailer_line_numbers: set[int]) -> bool:
    if URL_PATTERN.search(line):
        return True

    if "`" in line:
        return True

    if len(line.split()) == 1:
        return True

    if line_num in trailer_line_numbers:
        return True

    return False


def check_commit_message(filepath: str) -> int:
    message_path = Path(filepath)
    errors: list[tuple[int, str]] = []

    with message_path.open("r", encoding="utf-8") as message_file:
        lines = [
            (line_num, line.rstrip("\n"))
            for line_num, line in enumerate(message_file, start=1)
            if not line.startswith("#")
        ]

    trailer_line_numbers = collect_trailer_line_numbers(lines)

    for line_num, clean_line in lines:
        if len(clean_line) > LINE_LIMIT and not is_exempt(
            line_num,
            clean_line,
            trailer_line_numbers,
        ):
            errors.append((line_num, clean_line))

    if not errors:
        return 0

    print(
        f"\nCOMMIT REJECTED: Line length limit exceeded ({LINE_LIMIT} chars).",
        file=sys.stderr,
    )
    print("Please manually wrap the following lines:\n", file=sys.stderr)

    for line_num, text in errors:
        display_text = f"{text[:60]}..." if len(text) > 60 else text
        print(f"  Line {line_num}: {display_text}", file=sys.stderr)

    print(
        "\nTip: URLs, backticks (`), single long words, and trailers are exempt.",
        file=sys.stderr,
    )
    print(
        "Run 'git commit' again or use the up arrow to retrieve your text.\n",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: check-commit-message.py <commit-message-file>", file=sys.stderr)
        sys.exit(2)

    sys.exit(check_commit_message(sys.argv[1]))
