#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Open the shared Anatomy board in the system browser.

This entry point needs only Python's standard library and the plugin's Node.js
runtime. Editing, rendering, and versioned saving all belong to the web board.
The existing preview lifecycle owns the service, including reuse and locking.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit
import urllib.request
import webbrowser

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PROJECT = PLUGIN_ROOT / "anatomy-dsh-anatomy"

# Reuse the same lifecycle as anatomy_render instead of maintaining a second
# service implementation. argv values never pass through a shell.
PREVIEW_SCRIPT = """
import { pathToFileURL } from 'node:url';
const { ensureBoardService } = await import(pathToFileURL(process.argv[1]).href);
const options = {};
if (process.argv[3]) options.port = Number(process.argv[3]);
const result = await ensureBoardService(process.argv[2], options);
process.stdout.write(JSON.stringify(result));
"""


class LaunchError(Exception):
    """An actionable launch failure, without a Python traceback."""


def start_service(project_dir, port=None):
    """Start or reuse the plugin's persistent preview service for this board."""
    project = Path(project_dir).expanduser().resolve()
    board_file = project / "anatomy.html"
    if not board_file.is_file():
        raise LaunchError("找不到画板：%s。请先用插件生成画板。" % board_file)
    node = os.environ.get("ANATOMY_NODE") or shutil.which("node")
    if not node:
        raise LaunchError("找不到 Node.js；请安装 Node.js 18 或更新版本，或设置 ANATOMY_NODE。")
    command = [node, "--input-type=module", "-e", PREVIEW_SCRIPT,
               str(PLUGIN_ROOT / "lib" / "preview.js"), str(board_file),
               "" if port is None else str(port)]
    try:
        result = subprocess.run(command, cwd=str(PLUGIN_ROOT), capture_output=True,
                                text=True, encoding="utf-8", timeout=35, check=False)
    except FileNotFoundError as error:
        raise LaunchError("无法运行 Node.js：%s" % node) from error
    except subprocess.TimeoutExpired as error:
        raise LaunchError("画板服务启动超时；请查看工程 .anatomy-runtime 内的日志。") from error
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()[-1800:]
        raise LaunchError("无法启动画板服务：" + (detail or "Node.js 执行失败"))
    try:
        service = json.loads(result.stdout)
    except ValueError as error:
        raise LaunchError("画板服务没有返回有效的启动结果。") from error
    if not isinstance(service, dict) or not service.get("url"):
        detail = service.get("error") if isinstance(service, dict) else None
        raise LaunchError(detail or "画板服务没有返回地址。")
    return service


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_url(value):
    """Accept an existing loopback Anatomy service; preserve its query/hash."""
    try:
        parsed = urlsplit(value)
        port = parsed.port or 80
    except ValueError as error:
        raise LaunchError("画板地址格式无效。") from error
    if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
            or parsed.username is not None or parsed.password is not None
            or parsed.path not in ("", "/", "/anatomy.html")):
        raise LaunchError("--url 需要本机 Anatomy 服务地址，例如 http://127.0.0.1:8767/anatomy.html。")
    origin = urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
    # Avoid proxies and redirects: this must stay on the selected loopback host.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(origin + "/api/health", timeout=3) as response:
            health = json.loads(response.read(256 * 1024).decode("utf-8"))
    except (OSError, ValueError) as error:
        raise LaunchError("无法连接画板服务：%s。" % origin) from error
    if (not isinstance(health, dict) or health.get("service") != "anatomy-handwriting"
            or health.get("protocol") != 2
            or "project-versions" not in (health.get("capabilities") or [])
            or not isinstance(health.get("boardFile"), str)):
        raise LaunchError("此地址不是支持项目版本保存的 Anatomy 画板服务。")
    url = urlunsplit((parsed.scheme, parsed.netloc, "/anatomy.html", parsed.query, parsed.fragment))
    return {"url": url, "pid": health.get("pid"), "reused": True, "port": port}


def board_url(value, fragment=None):
    """Put the mode in the URL fragment, never append a query after '#'."""
    parsed = urlsplit(value)
    selected = fragment.lstrip("#") if fragment is not None else (parsed.fragment or "space")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, selected))


def parser():
    result = argparse.ArgumentParser(description="在系统浏览器中打开同一份 Anatomy 三维画板。")
    source = result.add_mutually_exclusive_group()
    source.add_argument("--project", help="工程目录；默认插件目录下 anatomy-dsh-anatomy")
    source.add_argument("--url", help="复用已经运行的本机 Anatomy 画板地址")
    result.add_argument("--port", type=int, help="新服务的首选端口；占用时自动选择空闲端口，0 为随机端口")
    result.add_argument("--hash", default=None, help="覆盖地址片段；默认 #space，已有片段会保留")
    result.add_argument("--no-open", action="store_true", help="只输出地址，供无头环境或手动打开")
    result.add_argument("--screenshot", "--shot", dest="screenshot", metavar="PNG",
                        help="兼容旧参数；请改用浏览器对真实画板截图")
    result.add_argument("--seconds", type=float, default=None, help=argparse.SUPPRESS)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    if args.screenshot:
        print("请使用浏览器打开画板后截图；Python 入口已停止生成独立的软件渲染截图。", file=sys.stderr)
        return 2
    if args.port is not None and not 0 <= args.port <= 65535:
        print("端口必须介于 0 和 65535 之间。", file=sys.stderr)
        return 2
    if args.url and args.port is not None:
        print("--port 仅用于 --project 启动服务。", file=sys.stderr)
        return 2
    try:
        service = verify_url(args.url) if args.url else start_service(args.project or DEFAULT_PROJECT, args.port)
        url = board_url(service["url"], args.hash)
    except LaunchError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(url, flush=True)
    print("%s画板服务（PID %s）。服务独立运行，关闭标签页或启动器不会停止服务。" %
          ("已复用" if service.get("reused") else "已启动", service.get("pid", "未知")), flush=True)
    if args.no_open:
        return 0
    if sys.platform.startswith("linux") and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        print("当前没有桌面环境，请在浏览器中打开上面的地址。", file=sys.stderr)
        return 0
    try:
        opened = webbrowser.open_new_tab(url)
    except (OSError, webbrowser.Error):
        opened = False
    if not opened:
        print("自动打开浏览器未完成，请手动打开上面的地址。", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
