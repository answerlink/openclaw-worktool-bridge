from fastapi import HTTPException
import pymysql

TAG_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS enterprise_authorization_tags (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""
LINK_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS enterprise_authorization_tag_links (
  corp_id VARCHAR(128) NOT NULL,
  tag_id BIGINT NOT NULL,
  PRIMARY KEY (corp_id, tag_id),
  INDEX idx_enterprise_tag (tag_id),
  CONSTRAINT fk_enterprise_tag FOREIGN KEY (tag_id)
    REFERENCES enterprise_authorization_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


class EnterpriseTagStore:
    def __init__(self, connect):
        self.connect = connect

    def tags(self):
        conn = self.connect()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT id,name FROM enterprise_authorization_tags ORDER BY name,id')
                return cur.fetchall() or []
        finally:
            conn.close()

    def assignments(self, corp_ids):
        if not corp_ids:
            return {}
        conn = self.connect()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT l.corp_id,t.id,t.name FROM enterprise_authorization_tag_links l JOIN enterprise_authorization_tags t ON t.id=l.tag_id WHERE l.corp_id IN (' + ','.join(['%s'] * len(corp_ids)) + ') ORDER BY t.name,t.id', tuple(corp_ids))
                result = {}
                for row in cur.fetchall() or []:
                    result.setdefault(row['corp_id'], []).append({'id': row['id'], 'name': row['name']})
                return result
        finally:
            conn.close()

    def save(self, name, tag_id=None):
        conn = self.connect()
        try:
            with conn.cursor() as cur:
                if tag_id is None:
                    cur.execute('INSERT INTO enterprise_authorization_tags(name) VALUES(%s)', (name,))
                    tag_id = cur.lastrowid
                else:
                    cur.execute('SELECT id FROM enterprise_authorization_tags WHERE id=%s FOR UPDATE', (tag_id,))
                    if not cur.fetchone():
                        raise HTTPException(404, '标签不存在')
                    cur.execute('UPDATE enterprise_authorization_tags SET name=%s WHERE id=%s', (name, tag_id))
            conn.commit()
            return {'id': tag_id, 'name': name}
        except pymysql.IntegrityError as exc:
            conn.rollback()
            raise HTTPException(409, '标签名称已存在') from exc
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def delete(self, tag_id):
        conn = self.connect()
        try:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM enterprise_authorization_tags WHERE id=%s', (tag_id,))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def apply(self, corp_ids, tag_ids, operation):
        conn = self.connect()
        try:
            with conn.cursor() as cur:
                if tag_ids:
                    cur.execute('SELECT id FROM enterprise_authorization_tags WHERE id IN (' + ','.join(['%s'] * len(tag_ids)) + ') FOR UPDATE', tuple(tag_ids))
                    if {int(r['id']) for r in cur.fetchall()} != set(tag_ids):
                        raise HTTPException(404, '标签不存在，请刷新后重试')
                for corp_id in corp_ids:
                    if operation == 'replace':
                        cur.execute('DELETE FROM enterprise_authorization_tag_links WHERE corp_id=%s', (corp_id,))
                    for tag_id in tag_ids:
                        if operation == 'remove':
                            cur.execute('DELETE FROM enterprise_authorization_tag_links WHERE corp_id=%s AND tag_id=%s', (corp_id, tag_id))
                        else:
                            cur.execute('INSERT IGNORE INTO enterprise_authorization_tag_links(corp_id,tag_id) VALUES(%s,%s)', (corp_id, tag_id))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
