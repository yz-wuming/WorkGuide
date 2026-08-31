#!/usr/bin/env python3
"""One-command launcher for WorkGuide (backend + frontend + browser).

Usage:
    workguide
    workguide --no-browser
    workguide --stop
"""

from __future__ import annotations

import argparse
import os
import platform
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
BACKEND_URL = "http://localhost:8001/api/models"
FRONTEND_URL = "http://localhost:3000"


def log(msg: str, color: str = "") -> None:
    """Print a colored log line."""
    colors = {
        "red": "\033[91m",
        "green": "\033[92m",
        "yellow": "\033[93m",
        "blue": "\033[94m",
        "cyan": "\033[96m",
        "reset": "\033[0m",
    }
    print(f"{colors.get(color, '')}{msg}{colors['reset']}", flush=True)


def is_windows() -> bool:
    return platform.system() == "Windows"


def kill_existing_ports() -> None:
    """Kill any existing processes on ports 8001 and 3000."""
    for port in (8001, 3000):
        try:
            if is_windows():
                result = subprocess.run(
                    ["netstat", "-ano"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                for line in result.stdout.splitlines():
                    if f":{port}" in line and "LISTENING" in line:
                        parts = line.split()
                        if parts:
                            pid = parts[-1]
                            subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True, check=False)
            else:
                subprocess.run(
                    f"lsof -ti:{port} | xargs kill -9 2>/dev/null || true",
                    shell=True,
                    capture_output=True,
                    check=False,
                )
        except Exception:
            pass


def wait_for_url(url: str, timeout: float = 60.0) -> bool:
    """Poll URL until it responds 200 or timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def open_browser(url: str) -> None:
    """Open the default browser (cross-platform)."""
    if is_windows():
        os.startfile(url)
    else:
        subprocess.run(["open", url] if platform.system() == "Darwin" else ["xdg-open", url], check=False)


def run_workguide(no_browser: bool = False) -> int:
    """Start backend and frontend, optionally open browser."""
    log("🐰 WorkGuide launcher", "cyan")

    log("Cleaning up stale ports...", "yellow")
    kill_existing_ports()
    time.sleep(1)

    env = os.environ.copy()
    # Ensure HOME and PATH are reasonable on Windows Git Bash / WSL mixups.
    if is_windows():
        env.setdefault("PYTHONIOENCODING", "utf-8")

    log("Starting backend on http://localhost:8001 ...", "blue")
    backend_proc = subprocess.Popen(
        ["uv", "run", "--locked", "uvicorn", "app.gateway.app:app", "--port", "8001"],
        cwd=str(BACKEND),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        # On Windows, creating a new process group lets us kill children cleanly.
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if is_windows() else 0,
    )

    log("Starting frontend on http://localhost:3000 ...", "blue")
    frontend_proc = subprocess.Popen(
        ["node", "node_modules/vite/bin/vite.js", "--port", "3000"],
        cwd=str(FRONTEND),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if is_windows() else 0,
    )

    def tail_logs(proc: subprocess.Popen, label: str, color: str) -> None:
        """Stream a process stdout to console."""
        try:
            for line in proc.stdout or []:
                line = line.rstrip()
                if line:
                    log(f"[{label}] {line}", color)
        except Exception:
            pass

    import threading

    threading.Thread(target=tail_logs, args=(backend_proc, "backend", "green"), daemon=True).start()
    threading.Thread(target=tail_logs, args=(frontend_proc, "frontend", "yellow"), daemon=True).start()

    log("Waiting for backend to be ready...", "yellow")
    if not wait_for_url(BACKEND_URL, timeout=60.0):
        log("Backend did not start in time. Check logs above.", "red")
        backend_proc.terminate()
        frontend_proc.terminate()
        return 1
    log("Backend ready.", "green")

    log("Waiting for frontend to be ready...", "yellow")
    if not wait_for_url(FRONTEND_URL, timeout=60.0):
        log("Frontend did not start in time. Check logs above.", "red")
        backend_proc.terminate()
        frontend_proc.terminate()
        return 1
    log("Frontend ready.", "green")

    if no_browser:
        log(f"WorkGuide is running. Open {FRONTEND_URL} manually.", "cyan")
    else:
        log(f"Opening {FRONTEND_URL} ...", "cyan")
        open_browser(FRONTEND_URL)

    log("Press Ctrl+C to stop both services.", "cyan")

    try:
        while backend_proc.poll() is None and frontend_proc.poll() is None:
            time.sleep(0.5)
    except KeyboardInterrupt:
        log("Shutting down...", "yellow")
        if is_windows():
            backend_proc.send_signal(signal.CTRL_BREAK_EVENT)
            frontend_proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            backend_proc.terminate()
            frontend_proc.terminate()
        try:
            backend_proc.wait(timeout=5)
            frontend_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            backend_proc.kill()
            frontend_proc.kill()
        log("Stopped.", "green")
        return 0

    # One of the processes exited unexpectedly.
    backend_proc.terminate()
    frontend_proc.terminate()
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Launch WorkGuide backend and frontend.")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically.")
    parser.add_argument("--stop", action="store_true", help="Kill existing WorkGuide processes on ports 8001/3000.")
    args = parser.parse_args(argv)

    if args.stop:
        kill_existing_ports()
        log("Stopped existing WorkGuide processes.", "green")
        return 0

    return run_workguide(no_browser=args.no_browser)


if __name__ == "__main__":
    sys.exit(main())
