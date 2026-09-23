"""Bailian synchronous image editing with explicit provenance and no POST retries."""
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from urllib.parse import urlparse

import requests
from PIL import Image


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def load_settings(env_file=None):
    values = {}
    path = Path(env_file) if env_file else Path('.env')
    if path.exists():
        for line in path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                values[key.strip()] = value.strip().strip('\"\'')
    elif env_file:
        raise ValueError('The specified environment file does not exist')
    values.update(os.environ)
    key = values.get('DASHSCOPE_API_KEY', '')
    if not key or key == 'YOUR_API_KEY':
        raise ValueError('Set DASHSCOPE_API_KEY in the environment or .env')
    origin = urlparse(values.get('DASHSCOPE_BASE_URL', ''))
    if (origin.scheme != 'https' or not (origin.hostname or '').endswith('.maas.aliyuncs.com')
            or origin.username or origin.password or origin.port not in (None, 443)
            or 'YOUR_WORKSPACE_ID' in origin.netloc):
        raise ValueError('DASHSCOPE_BASE_URL must be your HTTPS Bailian workspace URL')
    endpoint = f'https://{origin.netloc}/api/v1/services/aigc/multimodal-generation/generation'
    return endpoint, key


def _download(url, destination):
    if urlparse(url).scheme != 'https':
        raise RuntimeError('Expected an HTTPS image result URL')
    try:
        response = requests.get(url, timeout=(30, 180))
        response.raise_for_status()
    except requests.RequestException as exc:
        raise RuntimeError('Image download failed; resume can retry the saved URL without another generation. '
                           + type(exc).__name__) from None
    temporary = destination.with_suffix('.download')
    temporary.write_bytes(response.content)
    try:
        with Image.open(temporary) as image:
            image.convert('RGB').save(destination, format='PNG')
    finally:
        temporary.unlink(missing_ok=True)


def edit_image(input_file, prompt, model, parameters, run_dir, env_file=None):
    run_dir = Path(run_dir)
    raw = run_dir / 'model_raw.png'
    record = run_dir / 'request_metadata.json'
    private = run_dir / '.private_result.json'
    if raw.exists():
        raise RuntimeError('This run already has a model response; use finish instead of generating again')
    if private.exists():
        _download(json.loads(private.read_text())['url'], raw)
        metadata = json.loads(record.read_text())
        metadata['status'] = 'downloaded'
        write_json(record, metadata)
        private.unlink()
        return
    if record.exists():
        raise RuntimeError('This run already attempted an API request. Review its record before starting a new run.')
    endpoint, key = load_settings(env_file)
    if Path(input_file).stat().st_size > 10 * 1024 * 1024:
        raise ValueError('The perspective input exceeds the 10 MB API limit')
    payload = {'model': model, 'input': {'messages': [{'role': 'user', 'content': [
        {'image': 'data:image/png;base64,' + base64.b64encode(Path(input_file).read_bytes()).decode('ascii')},
        {'text': prompt},
    ]}]}, 'parameters': parameters}
    metadata = {'model': model, 'endpoint': endpoint, 'parameters': parameters,
                'started_at': datetime.now(timezone.utc).isoformat(), 'status': 'request_started',
                'mask_support': 'No native mask parameter. The local mask constrains compositing after generation.'}
    write_json(record, metadata)
    try:
        response = requests.post(endpoint, json=payload, headers={
            'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
        }, timeout=(30, 600))
    except requests.RequestException as exc:
        metadata.update(status='request_outcome_unknown', error_type=type(exc).__name__)
        write_json(record, metadata)
        raise RuntimeError('Request outcome is unknown; no automatic retry was made. ' + type(exc).__name__) from None
    metadata['http_status'] = response.status_code
    try:
        data = response.json()
    except ValueError:
        metadata['status'] = 'non_json_response'
        write_json(record, metadata)
        raise RuntimeError('The API returned a non-JSON response; see request_metadata.json') from None
    metadata.update(request_id=data.get('request_id'), usage=data.get('usage'), error_code=data.get('code'),
                    error_message=str(data.get('message', '')).replace(key, '[REDACTED]'),
                    completed_at=datetime.now(timezone.utc).isoformat())
    if response.status_code != 200 or data.get('code'):
        metadata['status'] = 'api_rejected'
        write_json(record, metadata)
        raise RuntimeError(str(metadata['error_code']) + ': ' + metadata['error_message'])
    try:
        content = data['output']['choices'][0]['message']['content']
        url = next(item['image'] for item in content if 'image' in item)
    except (KeyError, IndexError, StopIteration, TypeError):
        metadata['status'] = 'response_missing_image'
        write_json(record, metadata)
        raise RuntimeError('The successful API response did not contain an image') from None
    metadata['status'] = 'generated'
    write_json(record, metadata)
    fd = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump({'url': url}, handle)
    _download(url, raw)
    metadata['status'] = 'downloaded'
    write_json(record, metadata)
    private.unlink()
