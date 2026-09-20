# Ported from Phoenix 1480ab0:devtools/jobs.py
# Adapted for mova: paths, imports and branding only; the logic is unchanged.
"""Run one of the repo's own scripts as a subprocess and stream its output line by line."""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

MAX_KEPT_LINES = 2000


class Job:
    def __init__(
        self,
        title: str,
        command: list[str],
        cwd: Path,
        on_done: Callable[[Job], None] | None = None,
    ) -> None:
        self.title = title
        self.command = command
        self.cwd = cwd
        self.on_done = on_done
        self.lines: list[str] = []
        self.returncode: int | None = None
        self.exit_code: int | None = None
        self.stopped = False
        self.started = time.time()
        self.finished: float | None = None
        self._lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None

    @property
    def running(self) -> bool:
        return self.returncode is None

    def start(self) -> None:
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        self._process = subprocess.Popen(
            self.command,
            cwd=self.cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"},
            creationflags=flags,
        )
        threading.Thread(target=self._pump, daemon=True, name=f"job-{self.title}").start()

    def _pump(self) -> None:
        assert self._process is not None and self._process.stdout is not None
        for line in self._process.stdout:
            with self._lock:
                self.lines.append(line.rstrip("\r\n"))
                del self.lines[:-MAX_KEPT_LINES]
        code = self._process.wait()
        with self._lock:
            self.finished = time.time()
            self.exit_code = code
        if self.on_done is not None:
            try:
                self.on_done(self)
            finally:
                self.returncode = code
        else:
            self.returncode = code

    def stop(self) -> None:
        """Terminate the script. Anything it already wrote to disk is kept."""
        self.stopped = True
        if self._process is not None and self._process.poll() is None:
            self._process.terminate()

    def snapshot(self, tail: int = 200) -> dict[str, Any]:
        with self._lock:
            lines = list(self.lines[-tail:])
        end = self.finished or time.time()
        return {
            "title": self.title,
            "command": " ".join(self.command),
            "running": self.running,
            "returncode": self.returncode,
            "stopped": self.stopped,
            "elapsed": round(end - self.started, 1),
            "lines": lines,
        }
