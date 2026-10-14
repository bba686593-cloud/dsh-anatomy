#!/usr/bin/env python3
"""Serve one Anatomy board, local OCR, and explicit host-agent handoffs.
Local OCR images stay in memory; agent handoffs use the project request queue.
PaddleOCR obtains model weights on first use; --warmup loads them at startup.
"""
import argparse
import errno
import uuid
import base64
import binascii
import io
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys
import threading
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
# Optional project-local compatibility dependencies; never modify global Python.
LOCAL_DEPS = ROOT / '.cache' / 'ocr-deps'
if os.environ.get('ANATOMY_MANAGED_OCR_ENV') != '1' and LOCAL_DEPS.is_dir():
    sys.path.insert(0, str(LOCAL_DEPS))
os.environ.setdefault('PADDLE_PDX_CACHE_HOME', str(ROOT / '.cache' / 'paddlex'))
os.environ.setdefault('PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK', 'True')
os.environ.setdefault('PADDLE_PDX_MODEL_SOURCE', 'BOS')
os.environ.setdefault('FLAGS_use_mkldnn', '0')
MAX_BODY = 4 * 1024 * 1024
MAX_VERSION_BODY = 12 * 1024 * 1024
SERVICE_VERSION = 3
SERVICE_HASH = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
RECOGNITION_TOKEN_TTL = 600
MAX_RECOGNITION_SESSIONS = 32
MANUAL_RECOGNITION_PATHS = {'/api/recognition/health', '/api/recognition/connect', '/api/recognition/local'}
LOOPBACK_ORIGIN = re.compile(r'^http://(?:127\.0\.0\.1|localhost|\[::1\])(?::([1-9][0-9]{0,4}))?$')
try:
    PLUGIN_VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
except (OSError, ValueError, KeyError):
    PLUGIN_VERSION = 'unknown'


def valid_recognition_origin(origin):
    if origin is None or origin == 'null':
        return True
    match = LOOPBACK_ORIGIN.fullmatch(origin)
    return bool(match and (match.group(1) is None or int(match.group(1)) <= 65535))


def without_job_images(value):
    if isinstance(value, dict):
        return {key: without_job_images(item) for key, item in value.items() if key not in ('image', 'imageData', 'imageSrc')}
    if isinstance(value, list):
        return [without_job_images(item) for item in value]
    return value


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
    recognition_sessions = {}
    recognition_sessions_lock = threading.Lock()
    agent_config = os.environ.get('ANATOMY_RECOGNITION_AGENT_CONFIG')
    try:
        agent_configuration_hash = hashlib.sha256(Path(agent_config).read_bytes()).hexdigest() if agent_config else None
    except OSError:
        agent_configuration_hash = None

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

        def agent_recognition(self, action, payload=None):
            try:
                result = subprocess.run([os.environ.get('ANATOMY_NODE', 'node'), str(ROOT / 'scripts' / 'recognition-api.mjs'), str(board_file.parent)],
                                        input=json.dumps(dict(action=action, payload=payload or {})), text=True, capture_output=True, timeout=20)
                if result.returncode:
                    raise RuntimeError(result.stderr[-1000:])
                data = json.loads(result.stdout)
                return self.send(data['status'], without_job_images(data['result']))
            except Exception:
                return self.send(503, dict(ok=False, error=dict(code='recognition/service', message='智能体识别交接服务暂不可用，请稍后重试。')))

        def host_allowed(self):
            return self.headers.get('Host', '') in {'127.0.0.1:' + str(self.server.server_port), 'localhost:' + str(self.server.server_port), '[::1]:' + str(self.server.server_port)}

        def allowed(self):
            host = self.headers.get('Host', '')
            allowed = {'127.0.0.1:' + str(self.server.server_port), 'localhost:' + str(self.server.server_port), '[::1]:' + str(self.server.server_port)}
            origin = self.headers.get('Origin')
            return host in allowed and (not origin or origin in {'http://' + h for h in allowed})

        def manual_allowed(self):
            origin = self.headers.get('Origin')
            if not self.host_allowed() or not valid_recognition_origin(origin):
                return False
            self.recognition_cors_origin = origin
            return True

        def health(self, manual=False):
            ready = len(engine.models) == 2 and not engine.error and not getattr(engine, 'initializing', False)
            error = ('本地识别模型尚未就绪。' if engine.error else None) if manual else engine.error
            data = dict(service='anatomy-handwriting', protocol=2, serviceVersion=SERVICE_VERSION, serviceHash=SERVICE_HASH, pluginVersion=PLUGIN_VERSION,
                        agentConfigurationHash=agent_configuration_hash,
                        capabilities=['project-versions', 'manual-recognition', 'agent-recognition'], ready=ready,
                        modes=list(engine.models), status=engine.status, error=error,
                        providers=dict(local=dict(available=True, ready=ready, modes=list(engine.models), status=engine.status, error=error),
                                       agent=dict(available=True, mode='executor' if agent_config else 'handoff',
                                                  status='独立执行器已配置' if agent_config else '等待宿主智能体接管')))
            if not manual:
                data.update(boardFile=str(board_file), instanceId=instance_id, pid=os.getpid())
            return data

        def connect_recognition(self):
            now = time.time()
            with recognition_sessions_lock:
                expired = [token for token, session in recognition_sessions.items() if session['expires'] <= now]
                for token in expired:
                    recognition_sessions.pop(token, None)
                if len(recognition_sessions) >= MAX_RECOGNITION_SESSIONS:
                    return self.send(429, dict(ok=False, error='识别连接已达上限，请稍后重试。'))
                token = secrets.token_urlsafe(32)
                expires = now + RECOGNITION_TOKEN_TTL
                recognition_sessions[token] = dict(origin=self.headers.get('Origin'), expires=expires)
            state = self.health(manual=True)
            return self.send(200, dict(ok=True, token=token, expiresAt=int(expires * 1000), service=state['service'],
                                       ready=state['ready'], modes=state['modes'], pluginVersion=PLUGIN_VERSION, serviceVersion=SERVICE_VERSION))

        def recognition_token_valid(self):
            token = self.headers.get('X-Anatomy-Recognition-Token', '')
            with recognition_sessions_lock:
                session = recognition_sessions.get(token)
                if not session:
                    return False
                if session['expires'] <= time.time():
                    recognition_sessions.pop(token, None)
                    return False
                return session['origin'] == self.headers.get('Origin')

        def send(self, status, data, content_type='application/json; charset=utf-8'):
            encoded = json.dumps(data, ensure_ascii=False).encode('utf-8') if isinstance(data, dict) else data
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(encoded)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            origin = getattr(self, 'recognition_cors_origin', None)
            if origin is not None:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            self.end_headers()
            try:
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_OPTIONS(self):
            path = urlsplit(self.path).path
            if path not in MANUAL_RECOGNITION_PATHS:
                return self.send(403, dict(ok=False, error='这个接口不允许跨源连接。'))
            if not self.manual_allowed():
                return self.send(403, dict(ok=False, error='仅允许本机画板连接识别。'))
            method = self.headers.get('Access-Control-Request-Method')
            expected = 'GET' if path == '/api/recognition/health' else 'POST'
            headers = {value.strip().lower() for value in self.headers.get('Access-Control-Request-Headers', '').split(',') if value.strip()}
            if method != expected or not headers <= {'content-type', 'x-anatomy-recognition-token'}:
                return self.send(403, dict(ok=False, error='识别连接的预检请求无效。'))
            self.send_response(204)
            if self.headers.get('Origin') is not None:
                self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', expected)
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Anatomy-Recognition-Token')
            self.send_header('Access-Control-Max-Age', '600')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == '/api/recognition/health':
                if not self.manual_allowed():
                    return self.send(403, dict(ok=False, error='仅允许本机画板连接识别。'))
                return self.send(200, self.health(manual=True))
            if not self.allowed():
                return self.send(403, dict(ok=False, error='仅允许从本地画板使用。'))
            if path == '/api/health':
                return self.send(200, self.health())
            agent = re.fullmatch(r'/api/recognition/agent/([A-Za-z0-9_-]{1,128})', path)
            if agent:
                return self.agent_recognition('read', dict(id=agent.group(1)))
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
            path = urlsplit(self.path).path
            manual = path in {'/api/recognition/connect', '/api/recognition/local'}
            if not (self.manual_allowed() if manual else self.allowed()):
                return self.send(403, dict(ok=False, error='仅允许从本地画板使用。'))
            agent_cancel = re.fullmatch(r'/api/recognition/agent/([A-Za-z0-9_-]{1,128})/cancel', path)
            if path not in ('/api/recognize', '/api/versions', '/api/versions/select', '/api/recognition/connect', '/api/recognition/local', '/api/recognition/agent') and not agent_cancel:
                return self.send(404, dict(ok=False, error='没有这个接口。'))
            if path == '/api/recognition/local' and not self.recognition_token_valid():
                return self.send(403, dict(ok=False, error='识别连接已失效，请重新连接本地服务。'))
            if self.headers.get_content_type() != 'application/json':
                return self.send(415, dict(ok=False, error='请求需要 JSON。'))
            try:
                length = int(self.headers.get('Content-Length', 0))
                limit = MAX_VERSION_BODY if path in ('/api/versions', '/api/versions/select') else MAX_BODY
                if length <= 0:
                    raise ValueError('请求数据为空。')
                if length > limit:
                    return self.send(413, dict(ok=False, error='笔迹请求不能超过 4 MiB。' if limit == MAX_BODY else '画板请求不能超过 12 MiB。'))
                self.connection.settimeout(15)
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError('请求需要 JSON 对象。')
                if path == '/api/recognition/connect':
                    return self.connect_recognition()
                if path in ('/api/versions', '/api/versions/select'):
                    return self.versions('save' if path == '/api/versions' else 'select', payload)
                if agent_cancel:
                    return self.agent_recognition('cancel', dict(id=agent_cancel.group(1)))
                if path == '/api/recognition/agent':
                    return self.agent_recognition('create', payload)
                if payload.get('mode') not in ('text', 'math'):
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
