"""Compact, tolerant JSON extraction used to parse Planner / Reviewer output.

The production role engines and the deterministic test models both emit their
structured payload either as a bare JSON document or embedded in prose; this
helper locates the first plausible JSON value so the graph's routing decisions
never break on minor formatting differences between model providers.
"""

from __future__ import annotations

import json
import re
from typing import Any

_JSON_START = re.compile(r"[{\[]")
_find_json_end = re.compile(r"[}\]]")


def extract_json(text: str) -> Any | None:
    """Return the first JSON object/list found in ``text``, or ``None``."""
    if not text:
        return None
    # Fast path: text is already a JSON document.
    stripped = text.strip()
    if stripped.startswith(("{", "[")):
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass  # fall through to scanning
    # Scan for the first open brace/bracket and walk to a balanced close.
    for match in _JSON_START.finditer(text):
        open_ch = match.group(0)
        close_ch = "}" if open_ch == "{" else "]"
        depth = 0
        in_string = False
        escape = False
        for i in range(match.start(), len(text)):
            ch = text[i]
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == open_ch:
                depth += 1
            elif ch == close_ch:
                depth -= 1
                if depth == 0:
                    candidate = text[match.start() : i + 1]
                    try:
                        return json.loads(candidate)
                    except json.JSONDecodeError:
                        break  # unbalanced inner strings; try next opening
    return None