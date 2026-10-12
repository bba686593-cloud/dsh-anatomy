#!/usr/bin/env python3
"""Serve one Anatomy board and local Chinese/formula handwriting recognition.
No user image is sent to a remote service or saved to disk. Model weights are
obtained by PaddleOCR on first use; --warmup downloads/loads them at startup.
"""
import argparse
import errno
import uuid
import base64
import binascii
import io
import json
import os
from pathlib import Path
import sys
import threading
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
# Optional project-local compatibility dependencies; never modify global Python.
LOCAL_DEPS = ROOT / '.cache' / 'ocr-deps'
if LOCAL_DEPS.is_dir():
    sys.path.insert(0, str(LOCAL_DEPS))
os.environ.setdefault('PADDLE_PDX_CACHE_HOME', str(ROOT / '.cache' / 'paddlex'))
os.environ.setdefault('PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK', 'True')
os.environ.setdefault('PADDLE_PDX_MODEL_SOURCE', 'BOS')
os.environ.setdefault('FLAGS_use_mkldnn', '0')
MAX_BODY = 4 * 1024 * 1024


def decode_image(data):
    from PIL import Image, ImageOps
    if not isinstance(data, str) or not data.startswith('data:image/png;base64,'):
        raise ValueError('需要手写区域的 PNG 图像。')
    try:
        raw = base64.b64decode(data.split(',', 1)[1], validate=True)
    except (ValueError, binascii.Error):
        raise ValueError('手写图像编码无效。')
    if len(raw) > MAX_BODY:
        raise ValueError('笔迹图像过大，请分段识别。')
    image = Image.open(io.BytesIO(raw))
    if image.format != 'PNG' or image.width * image.height > 4_000_000 or min(image.size) < 8:
        raise ValueError('笔迹图像尺寸无效。')
    image.load()
    rgba = image.convert('RGBA')
    background = Image.new('RGBA', image.size, 'white')
    background.alpha_composite(rgba)
    image = background.convert('RGB')
    if ImageOps.invert(image.convert('L')).point(lambda p: 255 if p > 40 else 0).getbbox() is None:
        raise ValueError('没有检测到笔迹，请先书写。')
    return image


class RecognitionEngine:
    def __init__(self):
        self.models = {}
        self.lock = threading.Lock()
        self.status = '等待首次识别'
        self.error = None

    def load(self, mode):
        if mode not in self.models:
            self.status = '加载中文模型' if mode == 'text' else '加载公式模型'
            from paddleocr import TextRecognition, FormulaRecognition
            common = dict(device='cpu', enable_mkldnn=False, cpu_threads=4)
            if mode == 'math':
                self.models[mode] = FormulaRecognition(model_name='PP-FormulaNet_plus-S', **common)
            else:
                self.models[mode] = TextRecognition(model_name='PP-OCRv5_server_rec', **common)
            self.error = None
            self.status = '已就绪'
        return self.models[mode]

    def recognize(self, mode, image):
        import numpy as np
        # The pad supplies a handwritten line, not a photographed page. Crop
        # directly to its ink instead of asking a page detector to find it.
        from PIL import ImageOps
        bounds = ImageOps.invert(image.convert('L')).point(lambda p: 255 if p > 40 else 0).getbbox()
        if bounds:
            left, top, right, bottom = bounds
            image = image.crop((max(0, left - 12), max(0, top - 12),
                                min(image.width, right + 12), min(image.height, bottom + 12)))
        model = self.load(mode)
        results = list(model.predict(np.asarray(image)[:, :, ::-1].copy()))
        if mode == 'math':
            value = '\n'.join(str(r.get('rec_formula', '')) for r in results).strip()
            return dict(ok=True, text=value, mode=mode, engine='PP-FormulaNet_plus-S', reviewRequired=True)
        lines = [str(r.get('rec_text', '')) for r in results]
        scores = [float(r['rec_score']) for r in results if 'rec_score' in r]
        return dict(ok=True, text='\n'.join(lines), mode=mode, engine='PP-OCRv5',
                    scores=scores, reviewRequired=True)

    def warmup(self):
        with self.lock:
            try:
                self.load('text')
                self.load('math')
                print('中文和公式识别模型均已就绪。', flush=True)
            except Exception as error:
                self.error = str(error)
                self.status = '模型未就绪'
                import traceback
                traceback.print_exc()


def make_server(board_file, port, engine=None, instance_id=None):
    board_file = Path(board_file).resolve()
    engine = engine or RecognitionEngine()
    instance_id = instance_id or str(uuid.uuid4())

    class Handler(BaseHTTPRequestHandler):
        def versions(self, action, payload=None):
            try:
                result = subprocess.run([os.environ.get('ANATOMY_NODE', 'node'), str(ROOT / 'scripts' / 'board-api.mjs'), str(board_file.parent)],
                                        input=json.dumps(dict(action=action, payload=payload or {})), text=True, capture_output=True, timeout=20)
                if result.returncode:
                    raise RuntimeError(result.stderr[-1000:])
                data = json.loads(result.stdout)
                return self.send(data['status'], data['result'])
            except Exception as error:
                return self.send(503, dict(ok=False, error=dict(code='version/service', message='项目版本服务不可用：' + str(error))))

        def allowed(self):
            host = self.headers.get('Host', '')
            allowed = {'127.0.0.1:' + str(self.server.server_port), 'localhost:' + str(self.server.server_port)}
            origin = self.headers.get('Origin')
            return host in allowed and (not origin or origin in {'http://' + h for h in allowed})

        def send(self, status, data, content_type='application/json; charset=utf-8'):
            encoded = json.dumps(data, ensure_ascii=False).encode('utf-8') if isinstance(data, dict) else data
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(encoded)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            try:
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if not self.allowed():
                return self.send(403, dict(ok=False, error='仅允许从本地画板使用。'))
            path = urlsplit(self.path).path
            if path == '/api/health':
                return self.send(200, dict(service='anatomy-handwriting', protocol=2, capabilities=['project-versions'], boardFile=str(board_file), instanceId=instance_id, pid=os.getpid(),
                                          ready=len(engine.models) == 2 and not engine.error and not getattr(engine, 'initializing', False),
                                          modes=list(engine.models), status=engine.status, error=engine.error))
            if path == '/api/versions':
                return self.versions('list')
            if path == '/api/versions/current':
                return self.versions('current')
            if path in ('/', '/anatomy.html'):
                try:
                    return self.send(200, board_file.read_bytes(), 'text/html; charset=utf-8')
                except OSError:
                    return self.send(404, dict(ok=False, error='画板文件不存在，请先生成画板。'))
            self.send(404, dict(ok=False, error='没有这个资源。'))

        def do_POST(self):
            if not self.allowed():
                return self.send(403, dict(ok=False, error='仅允许从本地画板使用。'))
            if self.path not in ('/api/recognize', '/api/versions', '/api/versions/select'):
                return self.send(404, dict(ok=False, error='没有这个接口。'))
            if self.headers.get_content_type() != 'application/json':
                return self.send(415, dict(ok=False, error='请求需要 JSON。'))
            try:
                length = int(self.headers.get('Content-Length', 0))
                if length <= 0 or length > MAX_BODY:
                    raise ValueError('笔迹数据为空或过大。')
                self.connection.settimeout(15)
                payload = json.loads(self.rfile.read(length))
                if self.path != '/api/recognize':
                    if not isinstance(payload, dict):
                        raise ValueError('请求需要 JSON 对象。')
                    return self.versions('save' if self.path == '/api/versions' else 'select', payload)
                if not isinstance(payload, dict) or payload.get('mode') not in ('text', 'math'):
                    raise ValueError('请选择中文说明或数学公式。')
                image = decode_image(payload.get('image'))
            except Exception as error:
                return self.send(400, dict(ok=False, error=str(error)))
            if getattr(engine, 'initializing', False):
                return self.send(429, dict(ok=False, error='识别环境正在准备，笔迹已保留，请稍后重试。'))
            if not engine.lock.acquire(blocking=False):
                return self.send(429, dict(ok=False, error='本机正在加载模型或识别上一份笔迹，请稍后重试。'))
            try:
                result = engine.recognize(payload['mode'], image)
                self.send(200, result)
            except Exception as error:
                engine.error = str(error)
                import traceback
                traceback.print_exc()
                self.send(503, dict(ok=False, error='本地识别模型尚不可用：' + str(error)))
            finally:
                engine.lock.release()

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    return server, engine


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dir', default='anatomy-freeboard', help='含 anatomy.html 的画板目录')
    parser.add_argument('--file', help='指定生成的 HTML 文件，包括自定义文件名')
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--warmup', action='store_true', help='预先加载两个识别模型')
    parser.add_argument('--fallback-port', action='store_true', help='端口已占用时自动选择空闲端口')
    parser.add_argument('--state-file', help='向插件发布本服务的地址和身份')
    parser.add_argument('--instance-id', default=None)
    args = parser.parse_args()
    file = (Path(args.file) if args.file else Path(args.dir) / 'anatomy.html').resolve()
    if not file.is_file():
        parser.error('请先生成 HTML，或指定正确的画板文件。')
    instance_id = args.instance_id or str(uuid.uuid4())
    try:
        server, engine = make_server(file, args.port, instance_id=instance_id)
    except OSError as error:
        if not args.fallback_port or error.errno != errno.EADDRINUSE:
            raise
        server, engine = make_server(file, 0, instance_id=instance_id)
    engine.initializing = True
    engine.status = '正在准备识别环境'
    state_file = Path(args.state_file) if args.state_file else None
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    if state_file:
        state_file.parent.mkdir(parents=True, exist_ok=True)
        temp = state_file.with_name(state_file.name + '.' + instance_id + '.tmp')
        temp.write_text(json.dumps(dict(port=server.server_port, boardFile=str(file),
                                       instanceId=instance_id, pid=os.getpid())), encoding='utf-8')
        os.replace(str(temp), str(state_file))
    print('自由画板与本地手写识别：http://127.0.0.1:%d/anatomy.html' % server.server_port, flush=True)
    try:
        # Serve the page and loading status immediately; initialize the native
        # model runtime on the main thread, without blocking HTTP health checks.
        try:
            from paddleocr import TextRecognition, FormulaRecognition
            if args.warmup:
                engine.warmup()
            else:
                engine.status = '等待首次识别'
        except Exception as error:
            engine.error = '识别依赖未就绪：' + str(error) + '。请安装 scripts/requirements-ocr.txt 中的依赖。'
            engine.status = '模型未就绪'
            print(engine.error, file=sys.stderr, flush=True)
        finally:
            engine.initializing = False
        thread.join()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()
        if state_file:
            try:
                if json.loads(state_file.read_text())['instanceId'] == instance_id:
                    state_file.unlink()
            except (OSError, ValueError, KeyError):
                pass


if __name__ == '__main__':
    main()
