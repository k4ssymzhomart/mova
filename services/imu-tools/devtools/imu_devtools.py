# Ported from Phoenix 1480ab0:devtools/imu_devtools.py
# Adapted for mova: paths, imports and branding only; the logic is unchanged.
"""mova IMU dev tools: an interactive browser UI over the IMU scripts.

Start it like any script; it opens http://127.0.0.1:8765 in your browser:

    py services/imu-tools/devtools/imu_devtools.py

Needs only what the repo already uses (numpy; `bleak` for real sensors:
`pip install -e "services/imu-tools[ble]"`). No Flask, no build step.

What it does, all through one page:
  Sensors   scan for BLE sensors, assign roles, connect, see per-sensor link
            health; or run the built-in simulator / replay a capture instead.
  Live      knee angle, live rep count, per-rep features, Execution Score,
            rep-quality KNN and signal-quality gate, on the same code the API runs.
  Record    runs tools/capture_wt901ble68.py for you (same flags, live
            output, the Live tab follows the file), then scores the take with
            tools/check_execution_score.py. A simulator/replay recorder is included.
  Captures  browse recordings, re-analyse them with tunable rep thresholds, and run
            check_execution_score.py / check_rep_quality.py / tune_reps.py on them.
  Labels    edit range/tempo labels, build the KNN reference.

Non-clinical development tool: nothing here is a measurement or a diagnosis.
The server binds to localhost only.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# devtools/ is not a package: make `analysis`/`hub`/`jobs` importable when this
# module is imported rather than run. Running it directly already does this.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import analysis  # noqa: E402
from hub import Hub, dump_json  # noqa: E402

STATIC_DIR = Path(__file__).resolve().parent / "static"


def number(value, cast=float):
    return None if value in (None, "") else cast(value)


def make_handler(hub: Hub, capture_dir: Path):
    class Handler(BaseHTTPRequestHandler):
        server_version = "MovaImuDevtools/1"

        def log_message(self, format, *args):  # noqa: A002 - stdlib signature; keep the console quiet
            return

        # ------------------------------------------------------------ plumbing

        def _send(self, payload, status=HTTPStatus.OK, content_type="application/json"):
            body = payload if isinstance(payload, bytes) else dump_json(payload)
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _body(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            if not length:
                return {}
            return json.loads(self.rfile.read(length).decode("utf-8"))

        def _guard(self, action):
            try:
                self._send(action())
            except (ValueError, FileNotFoundError, KeyError) as error:
                self._send({"ok": False, "error": str(error) or type(error).__name__},
                           HTTPStatus.BAD_REQUEST)  # fmt: skip
            except Exception as error:  # last resort: report it in the UI, keep serving
                self._send({"ok": False, "error": f"{type(error).__name__}: {error}"},
                           HTTPStatus.INTERNAL_SERVER_ERROR)  # fmt: skip

        # ----------------------------------------------------------------- GET

        def do_GET(self):  # noqa: N802 - stdlib naming
            url = urlparse(self.path)
            query = {key: values[-1] for key, values in parse_qs(url.query).items()}
            if url.path in ("/", "/index.html"):
                self._send((STATIC_DIR / "index.html").read_bytes(), content_type="text/html")
            elif url.path == "/api/live":
                self._send(hub.snapshot())
            elif url.path == "/api/exercises":
                self._guard(analysis.exercises)
            elif url.path == "/api/captures":
                self._guard(lambda: analysis.list_captures(capture_dir))
            elif url.path == "/api/captures/analyze":
                self._guard(lambda: analysis.analyze_capture_file(
                    capture_dir,
                    query["file"],
                    query["exercise"],
                    prescribed_reps=number(query.get("prescribed"), int),
                    overrides={k: query.get(k) for k in analysis.TUNABLE},
                ))  # fmt: skip
            elif url.path == "/api/labels":
                self._guard(lambda: analysis.labels_get(capture_dir, query["file"]))
            else:
                self._send({"error": "not found"}, HTTPStatus.NOT_FOUND)

        # ---------------------------------------------------------------- POST

        def do_POST(self):  # noqa: N802 - stdlib naming
            path = urlparse(self.path).path
            try:
                body = self._body()
            except (ValueError, UnicodeDecodeError):
                self._send({"ok": False, "error": "invalid JSON body"}, HTTPStatus.BAD_REQUEST)
                return
            routes = {
                "/api/scan": lambda: hub.scan(float(body.get("seconds") or 6)),
                "/api/connect": lambda: hub.connect(body.get("assign") or {}),
                "/api/disconnect": hub.stop_source,
                "/api/source/stop": hub.stop_source,
                "/api/sim/start": lambda: hub.start_sim(body),
                "/api/sim/update": lambda: hub.update_sim(body),
                "/api/replay/start": lambda: hub.start_replay(
                    body["file"], float(body.get("speed") or 1), bool(body.get("loop"))
                ),
                "/api/reset": hub.reset,
                "/api/exercise": lambda: hub.set_exercise(
                    body["exercise_id"],
                    number(body.get("prescribed"), int),
                    {k: body.get(k) for k in analysis.TUNABLE},
                ),
                "/api/capture/start": lambda: hub.start_capture(body),
                "/api/capture/stop": hub.stop_capture,
                "/api/record/start": lambda: hub.start_recording(body),
                "/api/record/stop": hub.stop_recording,
                "/api/labels/create": lambda: analysis.labels_create(
                    capture_dir,
                    body["file"],
                    exercise_id=body["exercise_id"],
                    range_label=body["range"],
                    tempo_label=body["tempo"],
                    subject=body.get("subject") or "",
                    expected=number(body.get("expected"), int),
                    force=bool(body.get("force")),
                ),
                "/api/labels/save": lambda: analysis.labels_save(
                    capture_dir, body["file"], body["labels"]
                ),
                "/api/script": lambda: self._script(body),
            }
            action = routes.get(path)
            if action is None:
                self._send({"error": "not found"}, HTTPStatus.NOT_FOUND)
                return

            def run():
                result = action()
                return result if isinstance(result, dict) else {"ok": True}

            self._guard(run)

        def _script(self, body: dict) -> dict:
            name = body["name"]
            if name == "build_reference":
                args = ["--captures", str(capture_dir)]
                if body.get("dry_run", True):
                    args.append("--dry-run")
                if body.get("exercise"):
                    args += ["--exercise", str(body["exercise"])]
                return analysis.run_script(name, args)
            if name in ("score", "quality"):
                target = analysis.resolve_capture(capture_dir, body["file"])
                args = analysis.score_args(
                    target, body["exercise"], number(body.get("prescribed"), int)
                )
                return analysis.run_script(name, args if name == "score" else args[:4])
            if name == "tune":
                target = analysis.resolve_capture(capture_dir, body["file"])
                args = ["--file", str(target)]
                if body.get("expected"):
                    args += ["--expected", str(int(body["expected"]))]
                return analysis.run_script(name, args)
            raise ValueError(f"unknown script {name!r}")

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Interactive dev tools for the mova IMU rig; not clinical use.",
        epilog=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser tab")
    parser.add_argument(
        "--captures",
        type=Path,
        default=analysis.DEFAULT_CAPTURE_DIR,
        help=f"capture folder; default: {analysis.DEFAULT_CAPTURE_DIR}",
    )
    args = parser.parse_args()

    capture_dir = args.captures.resolve()
    capture_dir.mkdir(parents=True, exist_ok=True)
    hub = Hub(capture_dir)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(hub, capture_dir))
    server.daemon_threads = True
    url = f"http://127.0.0.1:{args.port}"
    print(f"mova IMU dev tools -> {url}   (captures: {capture_dir})   Ctrl+C to stop")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping ...")
    finally:
        try:
            if hub.recording is not None:
                hub.stop_recording()
            hub.stop_source()
        finally:
            server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
