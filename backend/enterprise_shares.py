"""Opaque, revocable links scoped to a single enterprise authorization."""
import re
import secrets
from typing import Any, Callable, Dict, Optional

SHARE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS enterprise_authorization_shares (
  corp_id VARCHAR(128) NOT NULL PRIMARY KEY,
  token VARCHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


class EnterpriseShareStore:
    def __init__(self, db_conn: Callable[[], Any]):
        self.db_conn = db_conn

    def get(self, corp_id: str) -> Optional[str]:
        conn = self.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT token FROM enterprise_authorization_shares WHERE corp_id=%s', (corp_id,))
                row = cur.fetchone()
                return row['token'] if row else None
        finally:
            conn.close()

    def create(self, corp_id: str, regenerate: bool = False) -> str:
        token = secrets.token_urlsafe(32)
        conn = self.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    'INSERT INTO enterprise_authorization_shares(corp_id,token) VALUES(%s,%s) '
                    + ('ON DUPLICATE KEY UPDATE token=VALUES(token)' if regenerate else 'ON DUPLICATE KEY UPDATE corp_id=VALUES(corp_id)'),
                    (corp_id, token),
                )
                cur.execute('SELECT token FROM enterprise_authorization_shares WHERE corp_id=%s', (corp_id,))
                token = cur.fetchone()['token']
            conn.commit()
            return token
        finally:
            conn.close()

    def revoke(self, corp_id: str) -> None:
        conn = self.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM enterprise_authorization_shares WHERE corp_id=%s', (corp_id,))
            conn.commit()
        finally:
            conn.close()

    def resolve(self, token: str) -> Optional[str]:
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            return None
        conn = self.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT corp_id FROM enterprise_authorization_shares WHERE token=%s', (token,))
                row = cur.fetchone()
                return row['corp_id'] if row else None
        finally:
            conn.close()


def share_link_data(token: Optional[str]) -> Dict[str, Any]:
    return {'enabled': bool(token), 'path': f'/share/enterprise/{token}' if token else ''}


def public_authorization_record(row: Dict[str, Any], deployment_type: str) -> Dict[str, Any]:
    # Explicit allowlist: remarks, upstream extras and audit fields must never escape.
    enabled = row.get('isEnabled', row.get('is_enabled', False))
    if isinstance(enabled, str):
        enabled = enabled.strip().lower() in {'1', 'true', 'yes', 'on'}
    def text(camel: str, snake: str) -> str:
        value = row.get(camel, row.get(snake))
        return str(value) if value is not None else ''
    return {
        'corpId': text('corpId', 'corp_id'),
        'corpName': text('corpName', 'corp_name'),
        'agentId': text('agentId', 'agent_id'),
        'isEnabled': bool(enabled),
        'expireTime': text('expireTime', 'expire_time'),
        'deploymentType': deployment_type if deployment_type in {'all', 'saas', 'private'} else 'all',
    }
