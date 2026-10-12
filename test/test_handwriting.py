import base64
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
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

    def request(self, path, data=None, headers=None):
        headers = headers or {}
        if data is not None:
            headers.setdefault('Content-Type', 'application/json')
            data = json.dumps(data).encode()
        req = Request(self.url + path, data=data, headers=headers)
        try:
            response = urlopen(req, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.read()

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
