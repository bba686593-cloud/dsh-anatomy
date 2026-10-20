#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Headless checks for the shared launcher and real preview-service lifecycle."""

import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.request

import app


class LauncherTests(unittest.TestCase):
    def test_fragment_is_separate_from_query(self):
        self.assertEqual(app.board_url("http://127.0.0.1:8767/anatomy.html?q=1"),
                         "http://127.0.0.1:8767/anatomy.html?q=1#space")

    def test_existing_fragment_is_preserved(self):
        self.assertEqual(app.board_url("http://127.0.0.1:8767/anatomy.html?q=1#space"),
                         "http://127.0.0.1:8767/anatomy.html?q=1#space")

    def test_explicit_fragment_wins(self):
        self.assertEqual(app.board_url("http://127.0.0.1/anatomy.html?q=1#space", "#reading"),
                         "http://127.0.0.1/anatomy.html?q=1#reading")

    def test_non_board_addresses_are_rejected(self):
        for value in ("https://example.com/anatomy.html", "http://127.0.0.1/private",
                      "file:///tmp/anatomy.html", "http://user:pass@localhost/anatomy.html",
                      "http://localhost:99999/anatomy.html"):
            with self.subTest(value=value), self.assertRaises(app.LaunchError):
                app.verify_url(value)

    def test_missing_generated_board_reports_action(self):
        with tempfile.TemporaryDirectory() as project, self.assertRaises(app.LaunchError):
            app.start_service(project)

    def test_screenshot_never_starts_a_separate_renderer(self):
        with patch.object(app, "start_service") as start, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(app.main(["--screenshot", "/tmp/unused.png"]), 2)
            start.assert_not_called()

    def test_open_failure_still_returns_the_usable_url(self):
        service = {"url": "http://127.0.0.1:12345/anatomy.html", "reused": True, "pid": 1}
        output = io.StringIO()
        with patch.object(app, "start_service", return_value=service), \
                patch.dict(os.environ, {"DISPLAY": ":test"}), \
                patch.object(app.webbrowser, "open_new_tab", side_effect=app.webbrowser.Error("unavailable")), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(app.main([]), 0)
        self.assertIn(service["url"] + "#space", output.getvalue())


class ServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory(prefix="anatomy-launcher-test-")
        cls.addClassCleanup(cls.workspace.cleanup)
        cls.project = Path(cls.workspace.name) / "工程 with spaces"
        cls.project.mkdir()
        cls.board_file = cls.project / "anatomy.html"
        cls.html = b"<!doctype html><title>Anatomy launcher fixture</title><p>shared board</p>"
        cls.body = b'{"board":{"version":1,"elements":[]},"sentinel":"leave unchanged"}\n'
        cls.board_file.write_bytes(cls.html)
        (cls.project / "body.json").write_bytes(cls.body)
        blocker = Path(cls.workspace.name) / "test-imports"
        blocker.mkdir()
        (blocker / "paddleocr.py").write_text("raise ImportError('OCR intentionally disabled in launcher selftest')\n")
        cls.env = dict(os.environ, ANATOMY_RECOGNITION_HOME=str(Path(cls.workspace.name) / "recognition"),
                       ANATOMY_MANAGED_OCR_ENV="1", PYTHONPATH=str(blocker), PYTHONNOUSERSITE="1")
        cls.env.pop("ANATOMY_RECOGNITION_AGENT_CONFIG", None)
        cls.state = None
        cls.addClassCleanup(cls.stop_owned_service)
        result = cls.run_launcher("app.py", "--project", str(cls.project), "--port", "0", "--no-open")
        if result.returncode:
            raise RuntimeError(result.stderr or result.stdout)
        cls.url = result.stdout.splitlines()[0]
        state_id = hashlib.sha256(str(cls.board_file.resolve()).encode("utf-8")).hexdigest()[:16]
        cls.state_file = cls.project / ".anatomy-runtime" / (state_id + ".json")
        cls.state = json.loads(cls.state_file.read_text(encoding="utf-8"))

    @classmethod
    def run_launcher(cls, filename, *args):
        return subprocess.run([sys.executable, str(Path(__file__).parent / filename), *args],
                              cwd=str(app.PLUGIN_ROOT), env=cls.env, capture_output=True,
                              text=True, encoding="utf-8", timeout=40)

    @classmethod
    def health(cls):
        origin = cls.url.split("/anatomy.html", 1)[0]
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), app.NoRedirect())
        with opener.open(origin + "/api/health", timeout=2) as response:
            return json.load(response)

    @classmethod
    def stop_owned_service(cls):
        if not cls.state:
            return
        try:
            health = cls.health()
            if (health.get("instanceId") != cls.state["instanceId"]
                    or health.get("pid") != cls.state["pid"]
                    or health.get("boardFile") != str(cls.board_file.resolve())):
                raise RuntimeError("Refusing to stop a service that is not owned by this selftest")
            os.kill(cls.state["pid"], signal.SIGTERM)
        except (OSError, ValueError):
            return
        for _ in range(30):
            try:
                cls.health()
            except (OSError, ValueError):
                return
            time.sleep(0.1)
        raise RuntimeError("Selftest service did not stop after SIGTERM")

    def test_service_survives_launcher_exit(self):
        health = self.health()
        self.assertEqual(health["instanceId"], self.state["instanceId"])
        self.assertEqual(health["boardFile"], str(self.board_file.resolve()))
        with urllib.request.urlopen(self.url, timeout=2) as response:
            self.assertEqual(response.read(), self.html)

    def test_repeated_project_launch_reuses_identity(self):
        result = self.run_launcher("app.py", "--project", str(self.project), "--port", "0", "--no-open")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines()[0], self.url)
        self.assertIn("已复用", result.stdout)
        self.assertEqual(self.health()["instanceId"], self.state["instanceId"])

    def test_old_entry_reuses_url_and_preserves_hash(self):
        base = self.url.split("#", 1)[0]
        result = self.run_launcher("anatomy3d.py", "--url", base + "?q=1#space", "--no-open")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines()[0], base + "?q=1#space")
        self.assertEqual(self.health()["pid"], self.state["pid"])

    @unittest.skipIf(os.name == "nt", "run.sh is the POSIX launcher")
    def test_shell_entry_forwards_project_and_options(self):
        result = subprocess.run(["bash", str(Path(__file__).parent / "run.sh"),
                                 str(self.project), "--no-open"], cwd=str(app.PLUGIN_ROOT),
                                env=self.env, capture_output=True, text=True, encoding="utf-8", timeout=40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines()[0], self.url)
        self.assertIn("已复用", result.stdout)

    def test_startup_preserves_project_files(self):
        self.assertEqual((self.project / "body.json").read_bytes(), self.body)
        self.assertEqual(self.board_file.read_bytes(), self.html)
        self.assertFalse((self.project / "body.json.bak").exists())

    def test_legacy_screenshot_returns_clear_error(self):
        target = self.project / "fake.png"
        result = self.run_launcher("anatomy3d.py", "--project", str(self.project), "--screenshot", str(target))
        self.assertEqual(result.returncode, 2)
        self.assertIn("浏览器", result.stderr)
        self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
