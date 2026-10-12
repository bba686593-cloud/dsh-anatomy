"""Optional real-model smoke check: run against an already warmed local service.
The fixtures are simple synthetic pen strokes, not a handwriting accuracy benchmark.
"""
import base64
import io
import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from PIL import Image, ImageDraw

url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8768'
fixtures = json.loads((Path(__file__).parent / 'fixtures/handwriting-strokes.json').read_text())
for mode, strokes in fixtures.items():
    image = Image.new('RGB', (660, 400), 'white')
    draw = ImageDraw.Draw(image)
    for stroke in strokes:
        draw.line([(x * 2, y * 2) for x, y in stroke], fill='black', width=6, joint='curve')
    out = io.BytesIO()
    image.save(out, format='PNG')
    payload = {'mode': mode, 'image': 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode()}
    req = Request(url + '/api/recognize', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=180) as response:
        result = json.load(response)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    assert result['ok'] and result['text'].strip() and result['reviewRequired']
    normalized = result['text'].replace(' ', '').replace('{', '').replace('}', '').replace('\\', '')
    if mode == 'text':
        assert '中文' in normalized, '中文笔迹识别未得到预期字符，需核对模型和笔迹。'
    else:
        assert 'x' in normalized.lower() and '2' in normalized and '+' in normalized and '1' in normalized, '数学笔迹结果缺失关键符号。'
