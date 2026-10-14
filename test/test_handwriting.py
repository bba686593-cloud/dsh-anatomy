import base64
import importlib.util
import io
import hashlib
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from http.client import HTTPConnection
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('anatomy_handwriting', Path(__file__).resolve().parents[1] / 'scripts/serve_board.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def image_data(blank=False):
    image = Image.new('RGB', (240, 120), 'white')
    if not blank:
        draw = ImageDraw.Draw(image)
        draw.line([(30, 60), (200, 60)], fill='black', width=5)
        draw.line([(115, 20), (115, 100)], fill='black', width=5)
    out = io.BytesIO()
    image.save(out, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode()


class FakeEngine:
    def __init__(self):
        self.models = {'text': True, 'math': True}
        self.lock = threading.Lock()
        self.status = '已就绪'
        self.error = None
        self.calls = []

    def recognize(self, mode, image):
        self.calls.append((mode, image.size))
        return {'ok': True, 'text': '接收输入' if mode == 'text' else r'x^2+1', 'reviewRequired': True}


class HandwritingServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        board = Path(self.temp.name) / 'anatomy.html'
        board.write_text('<html>工程画板</html>', encoding='utf-8')
        self.engine = FakeEngine()
        self.server, _ = module.make_server(board, 0, self.engine)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:%d' % self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, data=None, headers=None, method=None, return_headers=False):
        headers = headers or {}
        if data is not None:
            headers.setdefault('Content-Type', 'application/json')
            data = json.dumps(data).encode()
        req = Request(self.url + path, data=data, headers=headers, method=method)
        try:
            response = urlopen(req, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            result = response.status, response.read()
            return (*result, dict(response.headers)) if return_headers else result

    def test_serves_only_board_and_health(self):
        self.assertEqual(self.request('/anatomy.html')[0], 200)
        status, body = self.request('/api/health')
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)['ready'])
        self.assertEqual(self.request('/../body.json')[0], 404)
        self.assertEqual(self.request('/scripts/serve_board.py')[0], 404)

    def test_health_identifies_board_and_stays_available_during_initialization(self):
        self.engine.initializing = True
        status, body = self.request('/api/health')
        result = json.loads(body)
        self.assertEqual(status, 200)
        self.assertFalse(result['ready'])
        self.assertEqual(result['protocol'], 2)
        self.assertIn('project-versions', result['capabilities'])
        self.assertEqual(result['boardFile'], str(Path(self.temp.name) / 'anatomy.html'))
        self.assertTrue(result['instanceId'])
        self.assertEqual(self.request('/anatomy.html')[0], 200)
        self.assertEqual(self.request('/api/recognize', {'mode': 'math', 'image': image_data()})[0], 429)
        self.assertFalse(self.engine.calls)
        self.engine.initializing = False
        self.engine.error = '模型不可用'
        self.assertFalse(json.loads(self.request('/api/health')[1])['ready'])

    def test_health_reports_local_and_real_agent_handoff_and_public_health_has_no_paths(self):
        result = json.loads(self.request('/api/health')[1])
        self.assertTrue(result['providers']['local']['ready'])
        self.assertEqual(result['providers']['agent'], {'available': True, 'mode': 'handoff', 'status': '等待宿主智能体接管'})
        self.assertEqual(result['serviceVersion'], module.SERVICE_VERSION)
        self.assertEqual(result['serviceHash'], module.SERVICE_HASH)
        self.assertEqual(result['pluginVersion'], module.PLUGIN_VERSION)
        self.engine.error = 'model failed under ' + self.temp.name
        status, body, headers = self.request('/api/recognition/health', headers={'Origin': 'http://localhost:5173'}, return_headers=True)
        result = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'http://localhost:5173')
        self.assertFalse(result['ready'])
        self.assertNotIn('boardFile', result)
        self.assertNotIn('pid', result)
        self.assertNotIn(self.temp.name.encode(), body)

    def test_agent_configuration_health_uses_startup_hash_without_exposing_config_path(self):
        config = Path(self.temp.name) / 'agent-private.json'
        config.write_text(json.dumps({'engine': 'dsh', 'command': 'configured-runner'}))
        expected = hashlib.sha256(config.read_bytes()).hexdigest()
        with patch.dict(module.os.environ, {'ANATOMY_RECOGNITION_AGENT_CONFIG': str(config)}):
            server, _ = module.make_server(Path(self.temp.name) / 'anatomy.html', 0, self.engine)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            config.write_text('{}')
            with urlopen('http://127.0.0.1:%d/api/health' % server.server_port, timeout=3) as response:
                raw = response.read()
            result = json.loads(raw)
            self.assertEqual(result['agentConfigurationHash'], expected)
            self.assertEqual(result['providers']['agent']['mode'], 'executor')
            self.assertNotIn(str(config).encode(), raw)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_manual_loopback_and_file_connections_bind_token_to_origin_and_reuse_ocr(self):
        for origin in ['http://127.0.0.1:5173', 'http://localhost:8765', 'http://[::1]:5173', 'null']:
            status, body, headers = self.request('/api/recognition/connect', {}, {'Origin': origin}, return_headers=True)
            connected = json.loads(body)
            self.assertEqual(status, 200)
            self.assertTrue(connected['ready'])
            self.assertEqual(connected['service'], 'anatomy-handwriting')
            self.assertEqual(set(connected['modes']), {'text', 'math'})
            self.assertGreater(connected['expiresAt'], 0)
            self.assertEqual(headers['Access-Control-Allow-Origin'], origin)
            token_headers = {'Origin': origin, 'X-Anatomy-Recognition-Token': connected['token']}
            status, body, headers = self.request('/api/recognition/local', {'mode': 'text', 'image': image_data()}, token_headers, return_headers=True)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['text'], '接收输入')
            self.assertEqual(headers['Access-Control-Allow-Origin'], origin)
            changed_origin = 'http://localhost:9999' if origin != 'http://localhost:9999' else 'null'
            self.assertEqual(self.request('/api/recognition/local', {'mode': 'text', 'image': image_data()}, {'Origin': changed_origin, 'X-Anatomy-Recognition-Token': connected['token']})[0], 403)
        self.assertEqual(len(self.engine.calls), 4)
        self.assertEqual(self.request('/api/recognition/local', {'mode': 'text', 'image': image_data()}, {'Origin': 'null'})[0], 403)

    def test_manual_tokens_expire_and_session_count_is_bounded(self):
        origin = 'http://localhost:5173'
        with patch.object(module.time, 'time', return_value=1000):
            token = json.loads(self.request('/api/recognition/connect', {}, {'Origin': origin})[1])['token']
        with patch.object(module.time, 'time', return_value=1000 + module.RECOGNITION_TOKEN_TTL):
            self.assertEqual(self.request('/api/recognition/local', {'mode': 'text', 'image': image_data()}, {'Origin': origin, 'X-Anatomy-Recognition-Token': token})[0], 403)
            for _ in range(module.MAX_RECOGNITION_SESSIONS):
                self.assertEqual(self.request('/api/recognition/connect', {}, {'Origin': origin})[0], 200)
            self.assertEqual(self.request('/api/recognition/connect', {}, {'Origin': origin})[0], 429)
        with patch.object(module.time, 'time', return_value=1000 + 2 * module.RECOGNITION_TOKEN_TTL):
            self.assertEqual(self.request('/api/recognition/connect', {}, {'Origin': origin})[0], 200)
        self.assertFalse(self.engine.calls)

    def test_manual_origins_reject_external_userinfo_paths_and_invalid_ports(self):
        bad_origins = ['https://outside.example', 'http://outside.example', 'https://localhost:5173',
                       'http://127.0.0.1.evil.example:5173', 'http://localhost@outside.example',
                       'http://outside.example@localhost:5173', 'http://localhost:5173/',
                       'http://localhost:5173/path', 'http://localhost:5173?x=1',
                       'http://localhost:5173#fragment', 'http://localhost:65536', 'http://localhost:0',
                       'http://127.1:5173', 'http://[::ffff:127.0.0.1]:5173']
        for origin in bad_origins:
            self.assertEqual(self.request('/api/recognition/health', headers={'Origin': origin})[0], 403, origin)
            self.assertEqual(self.request('/api/recognition/connect', {}, {'Origin': origin})[0], 403, origin)
        self.assertEqual(self.request('/api/recognition/health', headers={'Host': 'outside.example', 'Origin': 'null'})[0], 403)
        self.assertFalse(self.engine.calls)

    def test_cors_preflight_is_limited_to_manual_recognition_routes(self):
        origin = 'http://localhost:5173'
        for path, method in [('/api/recognition/health', 'GET'), ('/api/recognition/connect', 'POST'), ('/api/recognition/local', 'POST')]:
            status, _, headers = self.request(path, headers={'Origin': origin, 'Access-Control-Request-Method': method,
                                                         'Access-Control-Request-Headers': 'Content-Type, X-Anatomy-Recognition-Token'}, method='OPTIONS', return_headers=True)
            self.assertEqual(status, 204)
            self.assertEqual(headers['Access-Control-Allow-Origin'], origin)
            self.assertEqual(headers['Access-Control-Allow-Methods'], method)
            self.assertIn('X-Anatomy-Recognition-Token', headers['Access-Control-Allow-Headers'])
        for path in ['/api/versions', '/api/versions/select', '/api/recognition/agent', '/api/recognize', '/api/settings']:
            status, _, headers = self.request(path, headers={'Origin': origin, 'Access-Control-Request-Method': 'POST'}, method='OPTIONS', return_headers=True)
            self.assertEqual(status, 403)
            self.assertNotIn('Access-Control-Allow-Origin', headers)
        self.assertEqual(self.request('/api/recognition/local', headers={'Origin': origin, 'Access-Control-Request-Method': 'DELETE'}, method='OPTIONS')[0], 403)
        self.assertEqual(self.request('/api/recognition/local', headers={'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization'}, method='OPTIONS')[0], 403)
        self.assertEqual(self.request('/api/recognition/connect', headers={'Origin': 'https://outside.example', 'Access-Control-Request-Method': 'POST'}, method='OPTIONS')[0], 403)
        for local_origin in [origin, 'null']:
            self.assertEqual(self.request('/api/versions', headers={'Origin': local_origin})[0], 403)
            self.assertEqual(self.request('/api/versions', {}, {'Origin': local_origin})[0], 403)
            self.assertEqual(self.request('/api/recognition/agent', {}, {'Origin': local_origin})[0], 403)
            self.assertEqual(self.request('/api/recognize', {'mode': 'text', 'image': image_data()}, {'Origin': local_origin})[0], 403)

    def test_agent_request_read_cancel_bridge_keeps_images_out_of_web_responses(self):
        actions = []
        def bridge(argv, **kwargs):
            payload = json.loads(kwargs['input'])
            actions.append(payload)
            self.assertEqual(argv[-2], str(module.ROOT / 'scripts' / 'recognition-api.mjs'))
            self.assertEqual(argv[-1], self.temp.name)
            action = payload['action']
            if action == 'create':
                result = {'ok': True, 'request': {'id': 'request-123', 'status': 'pending', 'mode': payload['payload']['mode'], 'image': payload['payload']['image']}}
                return SimpleNamespace(returncode=0, stderr='', stdout=json.dumps({'status': 202, 'result': result}))
            result = {'ok': True, 'request': {'id': payload['payload']['id'], 'status': 'cancelled' if action == 'cancel' else 'completed',
                                            'result': {'text': '接收输入', 'engine': 'host-agent', 'mode': 'text'}, 'image': image_data(), 'sourceElements': ['part']}}
            return SimpleNamespace(returncode=0, stderr='', stdout=json.dumps({'status': 200, 'result': result}))
        with patch.object(module.subprocess, 'run', side_effect=bridge):
            payload = {'mode': 'text', 'image': image_data(), 'selectionRevision': 'selected-1', 'sourceRevision': 'source-1', 'sourceElements': ['part'], 'id': 'request-123'}
            status, body = self.request('/api/recognition/agent', payload)
            self.assertEqual(status, 202)
            self.assertNotIn('image', json.loads(body)['request'])
            status, body = self.request('/api/recognition/agent/request-123')
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['request']['result']['text'], '接收输入')
            self.assertNotIn('image', json.loads(body)['request'])
            self.assertEqual(self.request('/api/recognition/agent/request-123/cancel', {})[0], 200)
            self.assertEqual([item['action'] for item in actions], ['create', 'read', 'cancel'])
            self.assertEqual(actions[0]['payload'], payload)
            self.assertEqual(actions[1]['payload'], {'id': 'request-123'})
            self.assertEqual(actions[2]['payload'], {'id': 'request-123'})
            self.assertEqual(self.request('/api/recognition/agent/request-123', headers={'Origin': 'http://localhost:5173'})[0], 403)
            self.assertEqual(self.request('/api/recognition/agent/request-123/cancel', {}, {'Origin': 'null'})[0], 403)
        self.assertFalse(self.engine.calls)

    def test_agent_bridge_failure_is_reported_without_claiming_recognition(self):
        with patch.object(module.subprocess, 'run', side_effect=OSError('runner absent at private path')):
            status, raw = self.request('/api/recognition/agent', {'mode': 'text', 'image': image_data()})
            self.assertEqual(status, 503)
            result = json.loads(raw)
            self.assertFalse(result['ok'])
            self.assertEqual(result['error']['code'], 'recognition/service')
            self.assertNotIn(b'private path', raw)
        self.assertFalse(self.engine.calls)

    def test_project_versions_save_select_conflicts_and_local_boundary(self):
        project = Path(self.temp.name)
        (project / 'body.json').write_text(json.dumps({'schema': 'anatomy/1', 'slug': 'test', 'title': '测试', 'board': {'version': 1, 'elements': []}}))
        status, raw = self.request('/api/versions')
        self.assertEqual(status, 200)
        head = json.loads(raw)
        board = {'version': 1, 'elements': [{'id': 'part', 'type': 'text', 'x': 0, 'y': 0, 'width': 200, 'height': 100, 'text': '接收输入'}]}
        payload = {'body': 'test', 'board': board, 'baseHash': head['currentHash'], 'expectedSelection': None}
        self.assertEqual(self.request('/api/versions', payload, {'Origin': 'https://outside.example'})[0], 403)
        status, raw = self.request('/api/versions', payload)
        self.assertEqual(status, 200)
        saved = json.loads(raw)
        self.assertTrue((project / 'edits' / 'versions' / (saved['saved'] + '.json')).is_file())
        self.assertEqual(self.request('/api/versions', payload)[0], 409)
        status, raw = self.request('/api/versions/current')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['board'], board)
        self.assertEqual(self.request('/api/versions/select', {'id': '../body', 'baseHash': head['currentHash'], 'expectedSelection': saved['selected']['revision']})[0], 400)
        self.assertEqual(self.request('/api/versions/select', {'id': saved['saved'], 'baseHash': head['currentHash'], 'expectedSelection': saved['selected']['revision']})[0], 200)

    def test_two_modes_reach_recognition_with_image_and_review_required(self):
        for mode, expected in [('text', '接收输入'), ('math', r'x^2+1')]:
            status, body = self.request('/api/recognize', {'mode': mode, 'image': image_data()})
            result = json.loads(body)
            self.assertEqual(status, 200)
            self.assertEqual(result['text'], expected)
            self.assertTrue(result['reviewRequired'])
        self.assertEqual(self.engine.calls, [('text', (240, 120)), ('math', (240, 120))])

    def test_image_board_versions_allow_large_json_and_keep_embedded_data(self):
        project = Path(self.temp.name)
        (project / 'body.json').write_text(json.dumps({'schema': 'anatomy/1', 'slug': 'test', 'title': '测试', 'board': {'version': 1, 'elements': []}}))
        head = json.loads(self.request('/api/versions')[1])
        board = {'version': 1, 'elements': [{'id': 'picture', 'type': 'image', 'x': 0, 'y': 0, 'width': 240, 'height': 170,
                  'image': {'src': image_data(), 'alt': '工程输入的图示', 'width': 240, 'height': 120}}],
                 'extension': {'preserve': '大' * (module.MAX_BODY // 3 + 1024)}}
        payload = {'body': 'test', 'board': board, 'baseHash': head['currentHash'], 'expectedSelection': None}
        self.assertGreater(len(json.dumps(payload, ensure_ascii=False).encode()), module.MAX_BODY)
        status, raw = self.request('/api/versions', payload)
        self.assertEqual(status, 200)
        saved = json.loads(raw)
        self.assertEqual(saved['board']['elements'][0]['image'], board['elements'][0]['image'])
        self.assertEqual(json.loads(self.request('/api/versions/current')[1])['board'], board)

    def test_project_and_recognition_requests_keep_distinct_byte_limits(self):
        for path, limit in [('/api/versions', module.MAX_VERSION_BODY), ('/api/recognize', module.MAX_BODY)]:
            connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
            try:
                connection.putrequest('POST', path)
                connection.putheader('Content-Type', 'application/json')
                connection.putheader('Content-Length', str(limit + 1))
                connection.endheaders()
                response = connection.getresponse()
                self.assertEqual(response.status, 413)
                self.assertFalse(json.loads(response.read())['ok'])
            finally:
                connection.close()
        self.assertFalse(self.engine.calls)

    def test_invalid_or_blank_input_never_calls_model(self):
        for payload in [{'mode': 'code', 'image': image_data()}, {'mode': 'text', 'image': image_data(True)}, {'mode': 'math', 'image': 'https://example.com/a.png'}, {'mode': 'math', 'image': 'data:image/png;base64,bad'}]:
            self.assertEqual(self.request('/api/recognize', payload)[0], 400)
        self.assertFalse(self.engine.calls)

    def test_cross_origin_requests_and_busy_model_are_rejected(self):
        self.assertEqual(self.request('/api/recognize', {'mode': 'text', 'image': image_data()}, {'Origin': 'https://outside.example'})[0], 403)
        self.assertEqual(self.request('/api/health', headers={'Host': 'outside.example'})[0], 403)
        with self.engine.lock:
            self.assertEqual(self.request('/api/recognize', {'mode': 'text', 'image': image_data()})[0], 429)
        self.assertFalse(self.engine.calls)

    def test_model_adapter_extracts_real_result_fields_without_inventing_confidence(self):
        engine = module.RecognitionEngine()
        class Predictor:
            def __init__(self, result): self.result = result
            def predict(self, image): return [self.result]
        engine.models['math'] = Predictor({'rec_formula': r'\frac{a}{b}'})
        engine.models['text'] = Predictor({'rec_text': '接收输入', 'rec_score': .8})
        image = Image.new('RGB', (64, 64), 'white')
        self.assertEqual(engine.recognize('math', image)['text'], r'\frac{a}{b}')
        self.assertNotIn('scores', engine.recognize('math', image))
        self.assertEqual(engine.recognize('text', image)['text'], '接收输入')


if __name__ == '__main__':
    unittest.main()
