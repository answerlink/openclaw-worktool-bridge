"""Dify Chat/Chatflow blocking adapter; context is managed by Console."""
import hashlib
import base64
import json
import aiohttp
from urllib.parse import urlsplit
from fastapi import HTTPException


def build_dify_request(url, payload, prompt, token):
    parts = urlsplit(url)
    path = parts.path.rstrip('/')
    if not path.endswith('/chat-messages'):
        path += '/chat-messages' if path.endswith('/v1') else '/v1/chat-messages'
    inputs = payload.get('inputs', {})
    if not isinstance(inputs, dict):
        raise HTTPException(400, 'Dify inputs 必须是 JSON 对象')
    # Console retains isolated history; never reuse a shared configured conversation_id.
    messages = payload.get('messages', [])
    lines = []
    images = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get('content')
        if isinstance(content, list):
            texts = []
            for item in content:
                if not isinstance(item, dict):
                    continue
                if item.get('type') == 'text':
                    texts.append(str(item.get('text') or ''))
                elif item.get('type') == 'image_url':
                    image = item.get('image_url')
                    image = image.get('url') if isinstance(image, dict) else image
                    if not isinstance(image, str) or not image:
                        raise HTTPException(400, 'Dify 图片地址为空')
                    if image not in images:
                        images.append(image)
            content = '\n'.join(texts)
        if isinstance(content, str) and content.strip():
            lines.append((str(message.get('role', 'user')), content))
    query = lines[0][1] if len(lines) == 1 else prompt
    if len(lines) > 1 or (lines and lines[0][0] != 'user'):
        query = '\n\n'.join(f'{role}: {text}' for role, text in lines)
    variables = payload.get('variables')
    if isinstance(variables, dict) and variables.get('prompt_inject'):
        query = str(variables['prompt_inject']) + '\n\n' + query
    return parts._replace(path=path).geturl(), {
        'inputs': inputs, 'query': query, 'response_mode': 'blocking',
        'user': payload.get('_dify_user') or 'console-test-' + hashlib.sha256(token.encode()).hexdigest()[:24],
        '_images': images,
    }


async def prepare_dify_files(session, url, headers, payload, read_text):
    """Upload Console base64 images with the same user as chat; never forward data URLs."""
    images = payload.pop('_images', [])
    files = []
    for image in images:
        if image.startswith('data:'):
            if len(image) > 28 * 1024 * 1024:
                raise HTTPException(400, 'Dify 图片超过 20 MiB 限制')
            try:
                metadata, encoded = image.split(',', 1)
                mime = metadata[5:].removesuffix(';base64')
                if not metadata.endswith(';base64') or mime not in {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}:
                    raise ValueError()
                data = base64.b64decode(encoded, validate=True)
                if not data or len(data) > 20 * 1024 * 1024:
                    raise ValueError()
            except (ValueError, TypeError):
                raise HTTPException(400, 'Dify 图片数据无效或格式不支持')
            form = aiohttp.FormData()
            form.add_field('user', payload['user'])
            form.add_field('file', data, filename='image.' + mime.split('/')[1], content_type=mime)
            upload_headers = {k: v for k, v in headers.items() if k.lower() != 'content-type'}
            async with session.post(url.rsplit('/chat-messages', 1)[0] + '/files/upload', data=form, headers=upload_headers, allow_redirects=False) as response:
                raw = await read_text(response)
                if response.status >= 400:
                    raise HTTPException(502, f'Dify 图片上传失败 HTTP {response.status}: {raw[:500]}')
                try:
                    file_id = json.loads(raw)['id']
                    if not isinstance(file_id, str) or not file_id:
                        raise ValueError()
                except (ValueError, KeyError, TypeError):
                    raise HTTPException(502, 'Dify 图片上传未返回有效文件 ID')
            files.append({'type': 'image', 'transfer_method': 'local_file', 'upload_file_id': file_id})
        elif urlsplit(image).scheme in {'http', 'https'}:
            files.append({'type': 'image', 'transfer_method': 'remote_url', 'url': image})
        else:
            raise HTTPException(400, 'Dify 图片必须是 HTTP(S) 地址或 Base64 图片')
    if files:
        payload['files'] = files
