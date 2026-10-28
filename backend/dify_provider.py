"""Dify Chat/Chatflow blocking adapter; context is managed by Console."""
import hashlib
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
    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get('content')
        if isinstance(content, list):
            raise HTTPException(400, 'Dify 当前接入仅支持文本，不支持图片消息')
        if isinstance(content, str) and content.strip():
            lines.append((str(message.get('role', 'user')), content))
    query = prompt
    if len(lines) > 1 or (lines and lines[0][0] != 'user'):
        query = '\n\n'.join(f'{role}: {text}' for role, text in lines)
    variables = payload.get('variables')
    if isinstance(variables, dict) and variables.get('prompt_inject'):
        query = str(variables['prompt_inject']) + '\n\n' + query
    return parts._replace(path=path).geturl(), {
        'inputs': inputs, 'query': query, 'response_mode': 'blocking',
        'user': payload.get('_dify_user') or 'console-test-' + hashlib.sha256(token.encode()).hexdigest()[:24],
        'conversation_id': '',
    }
