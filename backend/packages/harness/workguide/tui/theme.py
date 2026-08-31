"""Restrained colour + symbol palette for the TUI.

A soft, pastel "pink healing" palette: calm, readable on light terminals, with a
few accent hues to distinguish speakers and tool state. Rich-compatible hex
colours so the same constants drive both Rich renderables and Textual CSS
variables.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Theme:
    bg: str = "#FFF6FA"
    panel: str = "#FFE4EC"
    border: str = "#F3D6E0"
    text: str = "#4A3F3F"
    dim: str = "#655052"  # secondary info — kept dark enough to read on the pale panel
    muted: str = "#755560"  # tertiary metadata — dark enough to read on the pale panel

    primary: str = "#FFB6C1"  # headings / app accent
    user: str = "#C96A8E"  # user speaker
    assistant: str = "#5C4A52"  # assistant speaker
    tool: str = "#E884A8"  # tool activity
    accent: str = "#3E9E55"  # success / ok
    warning: str = "#D98E04"  # running / caution
    error: str = "#D9546F"  # errors


THEME = Theme()

SYMBOLS = {
    "user": "›",
    "assistant": "🐰",
    "tool": "⚙",
    "running": "◐",
    "ok": "✓",
    "error": "✗",
    "system": "·",
    "sparkle": "✧",
    "kao": "(｡•̀ᴗ-)✧",
    "spinner": ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
}