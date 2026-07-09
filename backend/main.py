import asyncio
import hashlib
import ipaddress
import json
import logging
import os
import re
import secrets
import shlex
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Set
from urllib.parse import quote

import aiohttp
import jwt
import pymysql
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from worktool_troubleshoot import TroubleshootSearchPayload, run_troubleshoot_search

APP_VERSION = "4.0.0"
WORKTOOL_API_BASE_DEFAULT = "https://api.worktool.ymdyes.cn"
DEFAULT_MESSAGE_API_URL = f"{WORKTOOL_API_BASE_DEFAULT}/wework/sendRawMessage"

AUTH_PBKDF2_ITERATIONS = int(os.getenv("AUTH_PBKDF2_ITERATIONS", "390000"))
AUTH_JWT_SECRET = os.getenv("AUTH_JWT_SECRET", "").strip()
AUTH_JWT_EXPIRE_DAYS = int(os.getenv("AUTH_JWT_EXPIRE_DAYS", "30"))
AUTH_SMS_ENABLED = os.getenv("AUTH_SMS_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
ENABLE_TROUBLESHOOT = os.getenv("ENABLE_TROUBLESHOOT", "false").strip().lower() in {"1", "true", "yes", "on"}
ENABLE_RUNTIME_WORKTOOL_SETTINGS = os.getenv("ENABLE_RUNTIME_WORKTOOL_SETTINGS", "false").strip().lower() in {"1", "true", "yes", "on"}
WORKTOOL_API_BASE_FIXED_RAW = os.getenv("WORKTOOL_API_BASE", "").strip()
CALLBACK_PUBLIC_BASE_URL_FIXED_RAW = os.getenv("CALLBACK_PUBLIC_BASE_URL", "").strip()
ENABLE_ADMIN_IP_BLACKLIST = os.getenv("ENABLE_ADMIN_IP_BLACKLIST", "false").strip().lower() in {"1", "true", "yes", "on"}
ENABLE_ADMIN_ENTERPRISE_AUTH = os.getenv("ENABLE_ADMIN_ENTERPRISE_AUTH", "false").strip().lower() in {"1", "true", "yes", "on"}
ENABLE_OPEN_TROUBLESHOOT_API = os.getenv("ENABLE_OPEN_TROUBLESHOOT_API", "false").strip().lower() in {"1", "true", "yes", "on"}
WORKTOOL_IPACL_QUERY_PATH = os.getenv("WORKTOOL_IPACL_QUERY_PATH", "").strip()
WORKTOOL_IPACL_ADD_PATH = os.getenv("WORKTOOL_IPACL_ADD_PATH", "").strip()
WORKTOOL_IPACL_DELETE_PATH = os.getenv("WORKTOOL_IPACL_DELETE_PATH", "").strip()
WORKTOOL_WEWORK_AUTH_LIST_PATH = os.getenv("WORKTOOL_WEWORK_AUTH_LIST_PATH", "").strip()
WORKTOOL_WEWORK_AUTH_SAVE_PATH = os.getenv("WORKTOOL_WEWORK_AUTH_SAVE_PATH", "").strip()
WORKTOOL_WEWORK_AUTH_DELETE_PATH = os.getenv("WORKTOOL_WEWORK_AUTH_DELETE_PATH", "").strip()
APP_UPLOAD_DIR = os.getenv("APP_UPLOAD_DIR", "/data/uploads").strip() or "/data/uploads"
APP_PUBLIC_BASE_URL = os.getenv("APP_PUBLIC_BASE_URL", "").strip().rstrip("/")
OPEN_TROUBLESHOOT_API_KEY = os.getenv("OPEN_TROUBLESHOOT_API_KEY", "").strip()
OPEN_TROUBLESHOOT_ALLOWED_ROBOT_IDS = {
    x.strip()
    for x in os.getenv("OPEN_TROUBLESHOOT_ALLOWED_ROBOT_IDS", "").split(",")
    if x.strip()
}
ADMIN_PHONE_WHITELIST = {
    x.strip()
    for x in os.getenv("ADMIN_PHONE_WHITELIST", "").split(",")
    if x.strip()
}
DEMO_ROBOT_IDS = {
    x.strip().lower()
    for x in os.getenv("DEMO_ROBOT_IDS", "").split(",")
    if x.strip()
}

SMS_HUARUI_API_URL = os.getenv("SMS_HUARUI_API_URL", "").strip()
SMS_HUARUI_APPKEY = os.getenv("SMS_HUARUI_APPKEY", "").strip()
SMS_HUARUI_APPSECRET = os.getenv("SMS_HUARUI_APPSECRET", "").strip()
SMS_HUARUI_SIGN = os.getenv("SMS_HUARUI_SIGN", "【南京亚美达科技】").strip()
SMS_CODE_EXPIRE_MINUTES = int(os.getenv("SMS_CODE_EXPIRE_MINUTES", "15"))

DEFAULT_TEST_PROVIDER_ENABLED_RAW = os.getenv("DEFAULT_TEST_PROVIDER_ENABLED", "false").strip().lower()
DEFAULT_TEST_PROVIDER_NAME = os.getenv("DEFAULT_TEST_PROVIDER_NAME", "AI模型(仅测试用)").strip() or "AI模型(仅测试用)"
DEFAULT_TEST_PROVIDER_BASE_URL = os.getenv(
    "DEFAULT_TEST_PROVIDER_BASE_URL",
    "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
).strip()
DEFAULT_TEST_PROVIDER_API_KEY = os.getenv("DEFAULT_TEST_PROVIDER_API_KEY", "").strip()
DEFAULT_TEST_PROVIDER_MODEL = os.getenv("DEFAULT_TEST_PROVIDER_MODEL", "doubao-seed-2.0-lite").strip()
AI_PROVIDER_TIMEOUT_SECONDS = max(int(os.getenv("AI_PROVIDER_TIMEOUT_SECONDS", "60") or "60"), 1)
QA_CALLBACK_WORKER_CONCURRENCY = max(int(os.getenv("QA_CALLBACK_WORKER_CONCURRENCY", "8") or "8"), 1)
QA_CALLBACK_QUEUE_MAXSIZE = max(int(os.getenv("QA_CALLBACK_QUEUE_MAXSIZE", "2000") or "2000"), 100)
ROBOT_SHOW_NAME_CACHE_TTL_SECONDS = max(int(os.getenv("ROBOT_SHOW_NAME_CACHE_TTL_SECONDS", "600") or "600"), 60)
CHAT_CONTEXT_ENABLED = os.getenv("CHAT_CONTEXT_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
CHAT_CONTEXT_MAX_MESSAGES = max(int(os.getenv("CHAT_CONTEXT_MAX_MESSAGES", "20") or "20"), 1)
CHAT_CONTEXT_RETENTION_DAYS = max(int(os.getenv("CHAT_CONTEXT_RETENTION_DAYS", "7") or "7"), 1)
GROUP_DECISION_PROMPT_TEMPLATE_DEFAULT = (
    "你是群聊回复门控器。请判断最后一条消息是否应由机器人在群聊公开回复。\n"
    "规则：如果最后一条是在问机器人问题，或者是售前售后咨询/功能答疑/问题排查，则返回 YES；\n"
    "如果更像成员间闲聊、互相对话、与机器人无关，则返回 NO。\n"
    "只允许输出 YES 或 NO，不要输出其他任何文字。\n\n"
    "群名：{group_name}\n"
    "发送者：{sender_name}\n"
    "最后一条消息：{last_message}\n"
    "近期上下文：\n"
    "{recent_context}\n"
)
PROVIDER_SYSTEM_PROMPT_TEMPLATE_DEFAULT = (
    "你是[{robot_name}]\n"
    "{colleague_line}\n"
    "{current_asker}\n"
)


app = FastAPI(title="WorkTool Bot Console API", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
Path(APP_UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=APP_UPLOAD_DIR), name="uploads")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(name)s - %(message)s")
logger = logging.getLogger("backend")
_expiry_notice_scan_lock = asyncio.Lock()
_qa_callback_queue: Optional[asyncio.Queue] = None
_qa_callback_worker_tasks: List[asyncio.Task] = []
_robot_show_name_cache: Dict[str, Dict[str, Any]] = {}
_robot_show_name_cache_lock = asyncio.Lock()


def now_iso() -> str:
    return datetime.now().isoformat()


def normalize_worktool_api_base(value: str) -> str:
    raw = (value or "").strip()
    return raw.rstrip("/") if raw else WORKTOOL_API_BASE_DEFAULT


def normalize_public_base_url(value: str) -> str:
    return (value or "").strip().rstrip("/")


def parse_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).lower() in {"1", "true", "yes", "on"}


def mask_token(token: str) -> str:
    if not token:
        return ""
    if len(token) <= 8:
        return "*" * len(token)
    return f"{token[:4]}****{token[-4:]}"


def _default_test_provider_enabled() -> bool:
    return DEFAULT_TEST_PROVIDER_ENABLED_RAW in {"1", "true", "yes", "on"}


def _db_cfg() -> Dict[str, Any]:
    host = os.getenv("APP_MYSQL_HOST", "").strip()
    port = int(os.getenv("APP_MYSQL_PORT", "3306").strip())
    user = os.getenv("APP_MYSQL_USER", "").strip()
    password = os.getenv("APP_MYSQL_PASSWORD", "")
    database = os.getenv("APP_MYSQL_DATABASE", "").strip()
    app_tz = os.getenv("APP_MYSQL_TIME_ZONE", "+08:00").strip() or "+08:00"
    if not (host and user and database):
        raise HTTPException(status_code=503, detail="auth mysql not configured")
    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "database": database,
        "charset": "utf8mb4",
        "cursorclass": pymysql.cursors.DictCursor,
        "autocommit": False,
        "connect_timeout": 5,
        "read_timeout": 15,
        "write_timeout": 15,
        "init_command": f"SET time_zone = '{app_tz}'",
    }


def db_conn() -> Any:
    return pymysql.connect(**_db_cfg())


def _worktool_db_cfg() -> Dict[str, Any]:
    host = os.getenv("WORKTOOL_DB_HOST", "").strip()
    port = int(os.getenv("WORKTOOL_DB_PORT", "3306").strip())
    user = os.getenv("WORKTOOL_DB_USER", "").strip()
    password = os.getenv("WORKTOOL_DB_PASSWORD", "")
    database = os.getenv("WORKTOOL_DB_NAME", "").strip()
    if not (host and user and database):
        raise HTTPException(status_code=503, detail="worktool mysql not configured")
    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "database": database,
        "charset": "utf8mb4",
        "cursorclass": pymysql.cursors.DictCursor,
        "autocommit": False,
        "connect_timeout": 5,
        "read_timeout": 15,
        "write_timeout": 15,
        "init_command": "SET time_zone = '+08:00'",
    }


def worktool_db_conn() -> Any:
    return pymysql.connect(**_worktool_db_cfg())


def init_db() -> None:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  phone VARCHAR(20) NOT NULL UNIQUE,
                  password_hash VARCHAR(255) NOT NULL,
                  company_name VARCHAR(128) NULL,
                  token_version INT NOT NULL DEFAULT 0,
                  is_active TINYINT(1) NOT NULL DEFAULT 1,
                  last_login_at DATETIME NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute("SHOW COLUMNS FROM users LIKE 'last_login_at'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS sms_codes (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  phone VARCHAR(20) NOT NULL,
                  scene ENUM('register','reset_password','login') NOT NULL,
                  code_hash VARCHAR(255) NOT NULL,
                  expire_at DATETIME NOT NULL,
                  used_at DATETIME NULL,
                  request_ip VARCHAR(64) NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  INDEX idx_sms_phone_scene_created (phone, scene, created_at),
                  INDEX idx_sms_expire (expire_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS robots (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  robot_id VARCHAR(128) NOT NULL UNIQUE,
                  name VARCHAR(255) NOT NULL,
                  private_chat_enabled TINYINT(1) NOT NULL DEFAULT 1,
                  group_chat_enabled TINYINT(1) NOT NULL DEFAULT 1,
                  group_reply_only_when_mentioned TINYINT(1) NOT NULL DEFAULT 0,
                  group_reply_mode ENUM('always','mention_only','ai_decide') NOT NULL DEFAULT 'always',
                  group_decision_provider_id BIGINT NULL,
                  group_decision_prompt_template TEXT NULL,
                  group_colleagues_json JSON NULL,
                  version INT NOT NULL DEFAULT 0,
                  created_by BIGINT NOT NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  CONSTRAINT fk_robots_created_by FOREIGN KEY (created_by) REFERENCES users(id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_robots (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  user_id BIGINT NOT NULL,
                  robot_pk BIGINT NOT NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE KEY uk_user_robot (user_id, robot_pk),
                  INDEX idx_user_robots_user (user_id),
                  INDEX idx_user_robots_robot (robot_pk),
                  CONSTRAINT fk_user_robots_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                  CONSTRAINT fk_user_robots_robot FOREIGN KEY (robot_pk) REFERENCES robots(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS ai_providers (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  created_by BIGINT NOT NULL,
                  name VARCHAR(128) NOT NULL UNIQUE,
                  base_url VARCHAR(512) NOT NULL,
                  api_token TEXT NOT NULL,
                  model VARCHAR(128) NULL,
                  provider_type ENUM('openai','openclaw') NOT NULL DEFAULT 'openai',
                  auth_scheme ENUM('bearer','x-openclaw-token','none') NOT NULL DEFAULT 'bearer',
                  extra_json JSON NULL,
                  system_prompt_template TEXT NULL,
                  include_asker_info TINYINT(1) NOT NULL DEFAULT 0,
                  asker_info_mode ENUM('off','system_prompt','variables') NOT NULL DEFAULT 'off',
                  enabled TINYINT(1) NOT NULL DEFAULT 1,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  INDEX idx_provider_created_by (created_by),
                  CONSTRAINT fk_provider_created_by FOREIGN KEY (created_by) REFERENCES users(id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS routing_rules (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  robot_pk BIGINT NOT NULL,
                  scene ENUM('group','private') NOT NULL,
                  pattern_match_type ENUM('all','exact','regex') NOT NULL DEFAULT 'regex',
                  pattern VARCHAR(1024) NOT NULL,
                  content_match_type ENUM('all','exact','regex') NOT NULL DEFAULT 'regex',
                  content_pattern VARCHAR(1024) NULL,
                  provider_id BIGINT NOT NULL,
                  priority INT NOT NULL DEFAULT 100,
                  enabled TINYINT(1) NOT NULL DEFAULT 1,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  INDEX idx_rules_robot_scene_priority (robot_pk, scene, priority),
                  CONSTRAINT fk_rules_robot FOREIGN KEY (robot_pk) REFERENCES robots(id) ON DELETE CASCADE,
                  CONSTRAINT fk_rules_provider FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute("SHOW COLUMNS FROM ai_providers LIKE 'robot_pk'")
            if cur.fetchone():
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS ai_providers_new (
                      id BIGINT PRIMARY KEY AUTO_INCREMENT,
                      created_by BIGINT NOT NULL,
                      name VARCHAR(128) NOT NULL UNIQUE,
                      base_url VARCHAR(512) NOT NULL,
                      api_token TEXT NOT NULL,
                      model VARCHAR(128) NULL,
                      provider_type ENUM('openai','openclaw') NOT NULL DEFAULT 'openai',
                      auth_scheme ENUM('bearer','x-openclaw-token','none') NOT NULL DEFAULT 'bearer',
                      extra_json JSON NULL,
                      system_prompt_template TEXT NULL,
                      include_asker_info TINYINT(1) NOT NULL DEFAULT 0,
                      asker_info_mode ENUM('off','system_prompt','variables') NOT NULL DEFAULT 'off',
                      enabled TINYINT(1) NOT NULL DEFAULT 1,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      INDEX idx_provider_created_by (created_by),
                      CONSTRAINT fk_provider_created_by FOREIGN KEY (created_by) REFERENCES users(id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                    """
                )
                cur.execute(
                    """
                    INSERT INTO ai_providers_new(id,created_by,name,base_url,api_token,model,provider_type,auth_scheme,extra_json,include_asker_info,asker_info_mode,enabled,created_at,updated_at)
                    SELECT id,
                           COALESCE((SELECT MIN(id) FROM users), 1) AS created_by,
                           CASE WHEN cnt > 1 THEN CONCAT(name, '_', id) ELSE name END AS name,
                           base_url,api_token,model,provider_type,auth_scheme,extra_json,0,'off',enabled,created_at,updated_at
                    FROM (
                      SELECT p.*,
                             COUNT(*) OVER(PARTITION BY p.name) AS cnt
                      FROM ai_providers p
                    ) t
                    ORDER BY id ASC
                    """
                )
                try:
                    cur.execute("ALTER TABLE routing_rules DROP FOREIGN KEY fk_rules_provider")
                except Exception:
                    pass
                cur.execute("DROP TABLE ai_providers")
                cur.execute("RENAME TABLE ai_providers_new TO ai_providers")
                try:
                    cur.execute(
                        """
                        ALTER TABLE routing_rules
                        ADD CONSTRAINT fk_rules_provider
                        FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE
                        """
                    )
                except Exception:
                    pass
            cur.execute("SHOW COLUMNS FROM ai_providers LIKE 'created_by'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE ai_providers ADD COLUMN created_by BIGINT NULL")
                cur.execute(
                    """
                    UPDATE ai_providers p
                    LEFT JOIN (
                      SELECT r.provider_id, MIN(ur.user_id) AS user_id
                      FROM routing_rules r
                      JOIN user_robots ur ON ur.robot_pk=r.robot_pk
                      GROUP BY r.provider_id
                    ) t ON t.provider_id=p.id
                    SET p.created_by=COALESCE(t.user_id, (SELECT MIN(id) FROM users))
                    WHERE p.created_by IS NULL
                    """
                )
                cur.execute("ALTER TABLE ai_providers MODIFY COLUMN created_by BIGINT NOT NULL")
            try:
                cur.execute("ALTER TABLE ai_providers ADD INDEX idx_provider_created_by (created_by)")
            except Exception:
                pass
            try:
                cur.execute(
                    """
                    ALTER TABLE ai_providers
                    ADD CONSTRAINT fk_provider_created_by FOREIGN KEY (created_by) REFERENCES users(id)
                    """
                )
            except Exception:
                pass
            cur.execute("SHOW COLUMNS FROM ai_providers LIKE 'is_system'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE ai_providers ADD COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0")
            cur.execute("SHOW COLUMNS FROM routing_rules LIKE 'content_pattern'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE routing_rules ADD COLUMN content_pattern VARCHAR(1024) NULL AFTER pattern")
            cur.execute("SHOW COLUMNS FROM robots LIKE 'group_reply_mode'")
            if not cur.fetchone():
                cur.execute(
                    "ALTER TABLE robots ADD COLUMN group_reply_mode ENUM('always','mention_only','ai_decide') NOT NULL DEFAULT 'always' AFTER group_reply_only_when_mentioned"
                )
                cur.execute(
                    """
                    UPDATE robots
                    SET group_reply_mode=CASE
                      WHEN group_reply_only_when_mentioned=1 THEN 'mention_only'
                      ELSE 'always'
                    END
                    """
                )
            cur.execute("SHOW COLUMNS FROM robots LIKE 'group_decision_provider_id'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE robots ADD COLUMN group_decision_provider_id BIGINT NULL AFTER group_reply_mode")
            cur.execute("SHOW COLUMNS FROM robots LIKE 'group_colleagues_json'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE robots ADD COLUMN group_colleagues_json JSON NULL AFTER group_decision_provider_id")
            cur.execute("SHOW COLUMNS FROM robots LIKE 'group_decision_prompt_template'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE robots ADD COLUMN group_decision_prompt_template TEXT NULL AFTER group_decision_provider_id")
            cur.execute("SHOW COLUMNS FROM routing_rules LIKE 'pattern_match_type'")
            if not cur.fetchone():
                cur.execute(
                    "ALTER TABLE routing_rules ADD COLUMN pattern_match_type ENUM('all','exact','regex') NOT NULL DEFAULT 'regex' AFTER scene"
                )
            cur.execute("SHOW COLUMNS FROM routing_rules LIKE 'content_match_type'")
            if not cur.fetchone():
                cur.execute(
                    "ALTER TABLE routing_rules ADD COLUMN content_match_type ENUM('all','exact','regex') NOT NULL DEFAULT 'regex' AFTER pattern"
                )
            try:
                cur.execute("ALTER TABLE ai_providers ADD INDEX idx_provider_is_system (is_system)")
            except Exception:
                pass
            cur.execute("SHOW COLUMNS FROM ai_providers LIKE 'include_asker_info'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE ai_providers ADD COLUMN include_asker_info TINYINT(1) NOT NULL DEFAULT 0 AFTER extra_json")
            cur.execute("SHOW COLUMNS FROM ai_providers LIKE 'asker_info_mode'")
            if not cur.fetchone():
                cur.execute(
                    "ALTER TABLE ai_providers ADD COLUMN asker_info_mode ENUM('off','system_prompt','variables') NOT NULL DEFAULT 'off' AFTER include_asker_info"
                )
                cur.execute(
                    "UPDATE ai_providers SET asker_info_mode=CASE WHEN include_asker_info=1 THEN 'variables' ELSE 'off' END"
                )
            cur.execute("SHOW COLUMNS FROM ai_providers LIKE 'system_prompt_template'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE ai_providers ADD COLUMN system_prompt_template TEXT NULL AFTER extra_json")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS default_replies (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  robot_pk BIGINT NOT NULL,
                  scene ENUM('group','private') NOT NULL,
                  reply_text TEXT NULL,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  UNIQUE KEY uk_default_reply_robot_scene (robot_pk, scene),
                  CONSTRAINT fk_default_replies_robot FOREIGN KEY (robot_pk) REFERENCES robots(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS app_settings (
                  `key` VARCHAR(64) PRIMARY KEY,
                  `value` TEXT NOT NULL,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS inbox_messages (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  category ENUM('system','ops') NOT NULL DEFAULT 'ops',
                  level ENUM('info','warning','error') NOT NULL DEFAULT 'info',
                  title VARCHAR(255) NOT NULL,
                  content TEXT NOT NULL,
                  recipient_scope_json JSON NULL,
                  status ENUM('draft','published','offline') NOT NULL DEFAULT 'draft',
                  publish_at DATETIME NULL,
                  expire_at DATETIME NULL,
                  system_key VARCHAR(128) NULL,
                  system_ref VARCHAR(255) NULL,
                  created_by BIGINT NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  INDEX idx_inbox_messages_status_publish (status, publish_at),
                  INDEX idx_inbox_messages_system (system_key, system_ref),
                  CONSTRAINT fk_inbox_messages_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS inbox_deliveries (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  message_id BIGINT NOT NULL,
                  user_id BIGINT NOT NULL,
                  is_read TINYINT(1) NOT NULL DEFAULT 0,
                  read_at DATETIME NULL,
                  delivered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE KEY uk_inbox_delivery_message_user (message_id, user_id),
                  INDEX idx_inbox_deliveries_user_read_time (user_id, is_read, delivered_at),
                  INDEX idx_inbox_deliveries_message (message_id),
                  CONSTRAINT fk_inbox_deliveries_message FOREIGN KEY (message_id) REFERENCES inbox_messages(id) ON DELETE CASCADE,
                  CONSTRAINT fk_inbox_deliveries_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS app_sms_record (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  account VARCHAR(32) NOT NULL,
                  source VARCHAR(64) NOT NULL,
                  source_ip VARCHAR(64) NOT NULL,
                  phone VARCHAR(16) NOT NULL,
                  sign VARCHAR(32) DEFAULT NULL,
                  content VARCHAR(512) NOT NULL,
                  send_time DATETIME NOT NULL,
                  msgid VARCHAR(64) NOT NULL,
                  result VARCHAR(1024) NOT NULL,
                  KEY idx_sms_record_phone (phone),
                  KEY idx_sms_record_send_time (send_time),
                  KEY idx_sms_record_source (source)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS robot_migrate_logs (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  operator_user_id BIGINT NULL,
                  operator_phone VARCHAR(20) NULL,
                  action_key VARCHAR(64) NOT NULL,
                  action_name VARCHAR(128) NOT NULL,
                  old_robot_id VARCHAR(128) NOT NULL,
                  new_robot_id VARCHAR(128) NULL,
                  worktool_path VARCHAR(255) NOT NULL,
                  request_json JSON NULL,
                  result_json JSON NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  INDEX idx_rml_created_at (created_at),
                  INDEX idx_rml_operator_time (operator_user_id, created_at),
                  INDEX idx_rml_old_robot (old_robot_id),
                  INDEX idx_rml_new_robot (new_robot_id),
                  CONSTRAINT fk_robot_migrate_logs_operator FOREIGN KEY (operator_user_id) REFERENCES users(id) ON DELETE SET NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS private_license_logs (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  operator_user_id BIGINT NULL,
                  operator_phone VARCHAR(20) NULL,
                  machine_code VARCHAR(128) NOT NULL,
                  expire_date VARCHAR(32) NOT NULL,
                  expire_epoch_ms BIGINT NOT NULL,
                  restrict_robot TINYINT(1) NOT NULL DEFAULT 1,
                  robot_start VARCHAR(64) NULL,
                  robot_end VARCHAR(64) NULL,
                  robot_limit INT NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  INDEX idx_pll_created_at (created_at),
                  INDEX idx_pll_operator_time (operator_user_id, created_at),
                  INDEX idx_pll_machine_code (machine_code),
                  CONSTRAINT fk_private_license_logs_operator FOREIGN KEY (operator_user_id) REFERENCES users(id) ON DELETE SET NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS message_logs (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  robot_pk BIGINT NOT NULL,
                  direction ENUM('inbound','outbound') NOT NULL,
                  scene ENUM('group','private') NOT NULL,
                  normalized_content TEXT,
                  status ENUM('received','success','skipped','failed') NOT NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  INDEX idx_logs_robot_time (robot_pk, created_at),
                  CONSTRAINT fk_logs_robot FOREIGN KEY (robot_pk) REFERENCES robots(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS qa_monitor_logs (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  robot_pk BIGINT NOT NULL,
                  room_type INT NOT NULL DEFAULT 0,
                  text_type INT NOT NULL DEFAULT 1,
                  at_me TINYINT(1) NOT NULL DEFAULT 0,
                  group_name VARCHAR(255) NULL,
                  received_name VARCHAR(255) NULL,
                  question TEXT NULL,
                  answer TEXT NULL,
                  provider_name VARCHAR(255) NULL,
                  ai_decision_reply TINYINT(1) NULL,
                  message_id VARCHAR(255) NULL,
                  callback_url VARCHAR(512) NULL,
                  status ENUM('received','success','skipped','failed') NOT NULL DEFAULT 'received',
                  time_cost DECIMAL(10,3) NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  INDEX idx_qml_robot_time (robot_pk, created_at),
                  INDEX idx_qml_robot_msg (robot_pk, message_id),
                  CONSTRAINT fk_qml_robot FOREIGN KEY (robot_pk) REFERENCES robots(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute("SHOW COLUMNS FROM qa_monitor_logs LIKE 'provider_name'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE qa_monitor_logs ADD COLUMN provider_name VARCHAR(255) NULL AFTER answer")
            cur.execute("SHOW COLUMNS FROM qa_monitor_logs LIKE 'ai_decision_reply'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE qa_monitor_logs ADD COLUMN ai_decision_reply TINYINT(1) NULL AFTER provider_name")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS chat_context_logs (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  robot_pk BIGINT NOT NULL,
                  scene ENUM('group','private') NOT NULL,
                  session_key VARCHAR(512) NOT NULL,
                  role ENUM('user','assistant') NOT NULL,
                  sender_name VARCHAR(255) NULL,
                  content TEXT NOT NULL,
                  message_id VARCHAR(255) NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  INDEX idx_ccl_session_time (robot_pk, scene, session_key(191), id),
                  INDEX idx_ccl_created_at (created_at),
                  CONSTRAINT fk_ccl_robot FOREIGN KEY (robot_pk) REFERENCES robots(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS forward_rules (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  created_by BIGINT NOT NULL,
                  source_robot_pk BIGINT NOT NULL,
                  source_scene ENUM('group','private') NOT NULL,
                  source_match_type ENUM('all','exact','regex') NOT NULL DEFAULT 'all',
                  source_pattern VARCHAR(255) NULL,
                  target_name VARCHAR(255) NOT NULL,
                  use_other_robot TINYINT(1) NOT NULL DEFAULT 0,
                  send_robot_pk BIGINT NULL,
                  prefix_enabled TINYINT(1) NOT NULL DEFAULT 1,
                  prefix_template VARCHAR(255) NULL,
                  keyword_match_type ENUM('all','exact','regex') NOT NULL DEFAULT 'all',
                  keyword_pattern VARCHAR(255) NULL,
                  enabled TINYINT(1) NOT NULL DEFAULT 1,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  INDEX idx_fr_source (source_robot_pk, source_scene, enabled),
                  INDEX idx_fr_created_by (created_by),
                  CONSTRAINT fk_fr_created_by FOREIGN KEY (created_by) REFERENCES users(id),
                  CONSTRAINT fk_fr_source_robot FOREIGN KEY (source_robot_pk) REFERENCES robots(id) ON DELETE CASCADE,
                  CONSTRAINT fk_fr_send_robot FOREIGN KEY (send_robot_pk) REFERENCES robots(id) ON DELETE SET NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS forward_logs (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  rule_id BIGINT NOT NULL,
                  source_robot_pk BIGINT NOT NULL,
                  send_robot_pk BIGINT NOT NULL,
                  source_scene ENUM('group','private') NOT NULL,
                  source_name VARCHAR(255) NULL,
                  sender_name VARCHAR(255) NULL,
                  target_name VARCHAR(255) NOT NULL,
                  message_id VARCHAR(255) NULL,
                  question_text TEXT NULL,
                  forwarded_text TEXT NULL,
                  status ENUM('success','failed','skipped') NOT NULL DEFAULT 'success',
                  error_reason VARCHAR(512) NULL,
                  time_cost DECIMAL(10,3) NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  INDEX idx_fl_source_robot_time (source_robot_pk, created_at),
                  INDEX idx_fl_rule_time (rule_id, created_at),
                  CONSTRAINT fk_fl_rule FOREIGN KEY (rule_id) REFERENCES forward_rules(id) ON DELETE CASCADE,
                  CONSTRAINT fk_fl_source_robot FOREIGN KEY (source_robot_pk) REFERENCES robots(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS robot_group_cache (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  robot_pk BIGINT NOT NULL,
                  source_id BIGINT NULL,
                  group_name VARCHAR(255) NOT NULL,
                  master_name VARCHAR(255) NULL,
                  msg_insert_time VARCHAR(64) NULL,
                  msg_num INT NULL,
                  members_num INT NULL,
                  group_announcement TEXT NULL,
                  level INT NULL,
                  source_create_time VARCHAR(64) NULL,
                  source_update_time VARCHAR(64) NULL,
                  raw_json JSON NULL,
                  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  UNIQUE KEY uk_robot_group_cache (robot_pk, group_name),
                  UNIQUE KEY uk_robot_group_cache_source (robot_pk, source_id),
                  INDEX idx_robot_group_cache_robot_sync (robot_pk, synced_at),
                  CONSTRAINT fk_robot_group_cache_robot FOREIGN KEY (robot_pk) REFERENCES robots(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS robot_group_sync_state (
                  robot_pk BIGINT PRIMARY KEY,
                  cursor_time VARCHAR(64) NULL,
                  cursor_id BIGINT NULL,
                  last_sync_at DATETIME NULL,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  CONSTRAINT fk_robot_group_sync_state_robot FOREIGN KEY (robot_pk) REFERENCES robots(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS group_tags (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  created_by BIGINT NOT NULL,
                  robot_pk BIGINT NOT NULL,
                  name VARCHAR(64) NOT NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  UNIQUE KEY uk_group_tags_owner_robot_name (created_by, robot_pk, name),
                  INDEX idx_group_tags_owner_robot (created_by, robot_pk),
                  CONSTRAINT fk_group_tags_owner FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
                  CONSTRAINT fk_group_tags_robot FOREIGN KEY (robot_pk) REFERENCES robots(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS group_tag_items (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  tag_id BIGINT NOT NULL,
                  target_type ENUM('group') NOT NULL DEFAULT 'group',
                  match_type ENUM('exact','regex') NOT NULL DEFAULT 'exact',
                  value VARCHAR(255) NOT NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  UNIQUE KEY uk_group_tag_items_tag_match_value (tag_id, target_type, match_type, value),
                  INDEX idx_group_tag_items_tag (tag_id),
                  CONSTRAINT fk_group_tag_items_tag FOREIGN KEY (tag_id) REFERENCES group_tags(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS scheduled_tasks (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  created_by BIGINT NOT NULL,
                  robot_pk BIGINT NOT NULL,
                  name VARCHAR(128) NOT NULL,
                  action VARCHAR(64) NOT NULL,
                  payload_json JSON NOT NULL,
                  schedule_type ENUM('once','daily','weekly','cron') NOT NULL DEFAULT 'once',
                  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
                  run_at DATETIME NULL,
                  daily_time CHAR(8) NULL,
                  weekly_days VARCHAR(32) NULL,
                  cron_expr VARCHAR(64) NULL,
                  misfire_policy ENUM('skip','fire_once') NOT NULL DEFAULT 'skip',
                  status ENUM('draft','enabled','paused','disabled') NOT NULL DEFAULT 'draft',
                  next_run_at DATETIME NULL,
                  last_run_at DATETIME NULL,
                  version INT NOT NULL DEFAULT 0,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  INDEX idx_st_robot_status_next (robot_pk, status, next_run_at),
                  INDEX idx_st_creator (created_by),
                  CONSTRAINT fk_st_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
                  CONSTRAINT fk_st_robot FOREIGN KEY (robot_pk) REFERENCES robots(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS scheduled_task_runs (
                  id BIGINT PRIMARY KEY AUTO_INCREMENT,
                  task_id BIGINT NOT NULL,
                  planned_at DATETIME NOT NULL,
                  started_at DATETIME NULL,
                  finished_at DATETIME NULL,
                  status ENUM('queued','running','success','failed','skipped','canceled') NOT NULL DEFAULT 'queued',
                  attempt INT NOT NULL DEFAULT 1,
                  idempotency_key VARCHAR(128) NOT NULL,
                  result_json JSON NULL,
                  error_text VARCHAR(1000) NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE KEY uk_str_idempotency (idempotency_key),
                  INDEX idx_str_task_time (task_id, created_at),
                  CONSTRAINT fk_str_task FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cur.execute("SHOW COLUMNS FROM robot_group_cache LIKE 'source_id'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE robot_group_cache ADD COLUMN source_id BIGINT NULL AFTER robot_pk")
            cur.execute("SHOW INDEX FROM robot_group_cache WHERE Key_name='uk_robot_group_cache_source'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE robot_group_cache ADD UNIQUE KEY uk_robot_group_cache_source (robot_pk, source_id)")
            cur.execute("SHOW COLUMNS FROM group_tags LIKE 'robot_pk'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE group_tags ADD COLUMN robot_pk BIGINT NULL AFTER created_by")
            cur.execute("SHOW INDEX FROM group_tags WHERE Key_name='uk_group_tags_owner_name'")
            if cur.fetchone():
                cur.execute("ALTER TABLE group_tags DROP INDEX uk_group_tags_owner_name")
            cur.execute("SHOW INDEX FROM group_tags WHERE Key_name='uk_group_tags_owner_robot_name'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE group_tags ADD UNIQUE KEY uk_group_tags_owner_robot_name (created_by, robot_pk, name)")
            cur.execute("SHOW INDEX FROM group_tags WHERE Key_name='idx_group_tags_owner_robot'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE group_tags ADD INDEX idx_group_tags_owner_robot (created_by, robot_pk)")
            cur.execute("SHOW COLUMNS FROM forward_rules LIKE 'target_type'")
            if cur.fetchone():
                cur.execute("ALTER TABLE forward_rules DROP COLUMN target_type")
            cur.execute("SHOW COLUMNS FROM forward_logs LIKE 'target_type'")
            if cur.fetchone():
                cur.execute("ALTER TABLE forward_logs DROP COLUMN target_type")

            cur.execute("SELECT 1 FROM app_settings WHERE `key`='worktool_api_base' LIMIT 1")
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO app_settings(`key`,`value`) VALUES('worktool_api_base', %s)",
                    (WORKTOOL_API_BASE_DEFAULT,),
                )
            cur.execute("SELECT 1 FROM app_settings WHERE `key`='auto_bind_message_callback_on_create' LIMIT 1")
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO app_settings(`key`,`value`) VALUES('auto_bind_message_callback_on_create','true')"
                )
            cur.execute("SELECT 1 FROM app_settings WHERE `key`='callback_public_base_url' LIMIT 1")
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO app_settings(`key`,`value`) VALUES('callback_public_base_url','')"
                )
            cur.execute("SELECT 1 FROM app_settings WHERE `key`='inbox_expiry_notice_last_scan_date' LIMIT 1")
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO app_settings(`key`,`value`) VALUES('inbox_expiry_notice_last_scan_date','')"
                )
        conn.commit()
    finally:
        conn.close()


def ensure_default_test_provider(user_id: int) -> None:
    if not _default_test_provider_enabled():
        return
    if not (DEFAULT_TEST_PROVIDER_NAME and DEFAULT_TEST_PROVIDER_BASE_URL and DEFAULT_TEST_PROVIDER_API_KEY and DEFAULT_TEST_PROVIDER_MODEL):
        logger.warning("default test provider enabled but config incomplete, skipped")
        return

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM ai_providers WHERE is_system=1 LIMIT 1")
            row = cur.fetchone()
            if row:
                cur.execute(
                    """
                    UPDATE ai_providers
                    SET name=%s,base_url=%s,api_token=%s,model=%s,provider_type='openai',auth_scheme='bearer',enabled=1
                    WHERE id=%s
                    """,
                    (
                        DEFAULT_TEST_PROVIDER_NAME,
                        DEFAULT_TEST_PROVIDER_BASE_URL,
                        DEFAULT_TEST_PROVIDER_API_KEY,
                        DEFAULT_TEST_PROVIDER_MODEL,
                        int(row["id"]),
                    ),
                )
                conn.commit()
                return
            try:
                cur.execute(
                    """
                    INSERT INTO ai_providers(created_by,name,base_url,api_token,model,provider_type,auth_scheme,extra_json,enabled,is_system)
                    VALUES(%s,%s,%s,%s,%s,'openai','bearer',NULL,1,1)
                    """,
                    (
                        int(user_id),
                        DEFAULT_TEST_PROVIDER_NAME,
                        DEFAULT_TEST_PROVIDER_BASE_URL,
                        DEFAULT_TEST_PROVIDER_API_KEY,
                        DEFAULT_TEST_PROVIDER_MODEL,
                    ),
                )
            except pymysql.err.IntegrityError:
                cur.execute("SELECT id FROM ai_providers WHERE name=%s LIMIT 1", (DEFAULT_TEST_PROVIDER_NAME,))
                existing = cur.fetchone()
                if existing:
                    cur.execute(
                        """
                        UPDATE ai_providers
                        SET is_system=1,base_url=%s,api_token=%s,model=%s,provider_type='openai',auth_scheme='bearer',enabled=1
                        WHERE id=%s
                        """,
                        (
                            DEFAULT_TEST_PROVIDER_BASE_URL,
                            DEFAULT_TEST_PROVIDER_API_KEY,
                            DEFAULT_TEST_PROVIDER_MODEL,
                            int(existing["id"]),
                        ),
                    )
            conn.commit()
    finally:
        conn.close()


def get_setting(key: str, default: str = "") -> str:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT `value` FROM app_settings WHERE `key`=%s LIMIT 1", (key,))
            row = cur.fetchone()
            return str(row["value"]) if row else default
    finally:
        conn.close()


def set_setting(key: str, value: str) -> None:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO app_settings(`key`,`value`) VALUES(%s,%s)
                ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), updated_at=CURRENT_TIMESTAMP
                """,
                (key, value),
            )
        conn.commit()
    finally:
        conn.close()


def _is_valid_phone(phone: str) -> bool:
    p = (phone or "").strip()
    return bool(re.fullmatch(r"1\d{10}", p)) and not p.startswith("170")


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, AUTH_PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${AUTH_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        algo, iter_str, salt_hex, digest_hex = (stored or "").split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iter_str)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return secrets.compare_digest(actual, expected)
    except Exception:
        return False


def _hash_sms_code(code: str) -> str:
    pepper = AUTH_JWT_SECRET or "dev-pepper"
    digest = hashlib.sha256(f"{code}|{pepper}".encode("utf-8")).hexdigest()
    return f"sha256${digest}"


def _verify_sms_code(code: str, stored: str) -> bool:
    if not stored or not stored.startswith("sha256$"):
        return False
    expected = stored.split("$", 1)[1]
    actual = _hash_sms_code(code).split("$", 1)[1]
    return secrets.compare_digest(actual, expected)


def _consume_sms_code(cur: Any, phone: str, scene: str, code: str) -> bool:
    cur.execute(
        """
        SELECT id,code_hash FROM sms_codes
        WHERE phone=%s AND scene=%s AND used_at IS NULL AND expire_at > UTC_TIMESTAMP()
        ORDER BY id DESC LIMIT 20
        """,
        (phone, scene),
    )
    rows = cur.fetchall() or []
    for row in rows:
        if _verify_sms_code(code, str(row["code_hash"])):
            cur.execute("UPDATE sms_codes SET used_at=UTC_TIMESTAMP() WHERE id=%s", (row["id"],))
            return True
    return False


def _create_access_token(user_id: int, token_version: int) -> str:
    if not AUTH_JWT_SECRET:
        raise HTTPException(status_code=503, detail="jwt secret not configured")
    now = datetime.utcnow()
    payload = {
        "sub": str(user_id),
        "token_version": int(token_version),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=AUTH_JWT_EXPIRE_DAYS)).timestamp()),
    }
    return jwt.encode(payload, AUTH_JWT_SECRET, algorithm="HS256")


def _parse_bearer_token(authorization: Optional[str]) -> str:
    raw = (authorization or "").strip()
    if not raw.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = raw[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="missing bearer token")
    return token


def _decode_access_token(token: str) -> Dict[str, Any]:
    if not AUTH_JWT_SECRET:
        raise HTTPException(status_code=503, detail="jwt secret not configured")
    try:
        return jwt.decode(token, AUTH_JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(status_code=401, detail="token expired") from e
    except Exception as e:
        raise HTTPException(status_code=401, detail="invalid token") from e


def _is_admin_phone(phone: str) -> bool:
    p = (phone or "").strip()
    return bool(p) and p in ADMIN_PHONE_WHITELIST


def _require_admin(user: Dict[str, Any]) -> None:
    if not _is_admin_phone(str(user.get("phone") or "")):
        raise HTTPException(status_code=403, detail="仅管理员可访问")


def _require_feature_enabled(enabled: bool, feature_name: str) -> None:
    if not enabled:
        raise HTTPException(status_code=404, detail=f"{feature_name} disabled")


def _require_open_troubleshoot_access(x_open_api_key: Optional[str]) -> None:
    _require_feature_enabled(ENABLE_OPEN_TROUBLESHOOT_API, "open troubleshoot api")
    expected = (OPEN_TROUBLESHOOT_API_KEY or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="open troubleshoot api key not configured")
    actual = (x_open_api_key or "").strip()
    if not actual or actual != expected:
        raise HTTPException(status_code=401, detail="invalid open api key")


def _require_configured_path(path: str, feature_name: str) -> str:
    p = (path or "").strip()
    if not p:
        raise HTTPException(status_code=503, detail=f"{feature_name} path not configured")
    if not p.startswith("/"):
        raise HTTPException(status_code=503, detail=f"{feature_name} path invalid")
    return p


def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    token = _parse_bearer_token(authorization)
    payload = _decode_access_token(token)
    try:
        user_id = int(payload.get("sub", 0))
        token_version = int(payload.get("token_version", -1))
    except Exception as e:
        raise HTTPException(status_code=401, detail="invalid token payload") from e
    if user_id <= 0:
        raise HTTPException(status_code=401, detail="invalid token subject")

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id,phone,company_name,token_version,is_active,last_login_at,created_at,updated_at FROM users WHERE id=%s LIMIT 1",
                (user_id,),
            )
            user = cur.fetchone()
        if not user or int(user["is_active"]) != 1:
            raise HTTPException(status_code=401, detail="user not active")
        if int(user["token_version"]) != token_version:
            raise HTTPException(status_code=401, detail="token revoked")
        return user
    finally:
        conn.close()


def _sms_signature(timestamp_ms: int) -> str:
    raw = f"{SMS_HUARUI_APPKEY}{SMS_HUARUI_APPSECRET}{timestamp_ms}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


async def _send_sms_via_huarui(phone: str, content: str) -> Dict[str, Any]:
    if not SMS_HUARUI_API_URL or not SMS_HUARUI_APPKEY or not SMS_HUARUI_APPSECRET:
        raise HTTPException(status_code=503, detail="sms provider not configured")
    # Use Unix epoch milliseconds directly; avoid naive datetime timezone skew.
    ts_ms = int(time.time() * 1000)
    body = {
        "appkey": SMS_HUARUI_APPKEY,
        "appsecret": SMS_HUARUI_APPSECRET,
        "appcode": "1000",
        "timestamp": ts_ms,
        "sign": _sms_signature(ts_ms),
        "phone": phone,
        "msg": content,
    }
    timeout = aiohttp.ClientTimeout(total=5)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(SMS_HUARUI_API_URL, json=body) as resp:
            data = await resp.json(content_type=None)
            if resp.status != 200:
                raise HTTPException(status_code=502, detail=f"sms upstream status={resp.status}")
            if not isinstance(data, dict):
                raise HTTPException(status_code=502, detail="sms upstream invalid response")
            return data


# ----- models -----
class QARequest(BaseModel):
    spoken: str = ""
    rawSpoken: str = ""
    receivedName: str = ""
    receivedRemark: Optional[str] = None
    groupName: Optional[str] = None
    groupRemark: Optional[str] = None
    roomType: int = 0
    atMe: bool = False
    textType: int = 1
    fileBase64: str = ""
    messageId: str = ""
    msgId: str = ""


class QAResponse(BaseModel):
    code: int = 0
    message: str = "success"


class SmsSendRequest(BaseModel):
    phone: str
    scene: Literal["register", "reset_password", "login"] = "register"


class AuthRegisterRequest(BaseModel):
    phone: str
    sms_code: Optional[str] = None
    password: str
    company_name: Optional[str] = None


class AuthLoginRequest(BaseModel):
    phone: str
    password: str


class AuthResetPasswordRequest(BaseModel):
    phone: str
    sms_code: Optional[str] = None
    new_password: str


class AdminCreateUserRequest(BaseModel):
    phone: str
    password: str
    company_name: Optional[str] = None


class WeworkAuthorizationSaveRequest(BaseModel):
    corpId: str
    corpName: Optional[str] = None
    agentId: Optional[str] = None
    isEnabled: Optional[bool] = None
    expireTime: Optional[str] = None
    remark: Optional[str] = None


class RobotMigrateRequest(BaseModel):
    old_robot_id: str


class PrivateLicenseLogCreateRequest(BaseModel):
    machine_code: str
    expire_date: str
    expire_epoch_ms: int
    restrict_robot: bool = True
    robot_start: Optional[str] = None
    robot_end: Optional[str] = None
    robot_limit: Optional[int] = None


class AdminAppUpdateCreateRequest(BaseModel):
    app_name: str
    title: Optional[str] = None
    update_log: Optional[str] = None
    remark: Optional[str] = None
    version_name: str
    version_code: Optional[int] = None
    min_version_code: Optional[int] = None
    download_url: str
    size: Optional[str] = None
    enable: Optional[bool] = None


class WorkToolSettingsUpdate(BaseModel):
    worktool_api_base: Optional[str] = None
    callback_public_base_url: Optional[str] = None
    auto_bind_message_callback_on_create: Optional[bool] = None


class RobotCreate(BaseModel):
    robot_id: str
    name: str = "机器人"
    private_chat_enabled: bool = True
    group_chat_enabled: bool = True
    group_reply_only_when_mentioned: bool = False
    group_reply_mode: Literal["always", "mention_only", "ai_decide"] = "always"
    group_decision_provider_id: Optional[int] = None
    group_decision_prompt_template: Optional[str] = None
    group_colleagues: List[str] = Field(default_factory=list)
    group_default_reply: Optional[str] = None
    private_default_reply: Optional[str] = None


class RobotUpdate(BaseModel):
    name: Optional[str] = None
    private_chat_enabled: Optional[bool] = None
    group_chat_enabled: Optional[bool] = None
    group_reply_only_when_mentioned: Optional[bool] = None
    group_reply_mode: Optional[Literal["always", "mention_only", "ai_decide"]] = None
    group_decision_provider_id: Optional[int] = None
    group_decision_prompt_template: Optional[str] = None
    group_colleagues: Optional[List[str]] = None
    group_default_reply: Optional[str] = None
    private_default_reply: Optional[str] = None


class ProviderCreate(BaseModel):
    name: str
    base_url: str
    api_token: str
    model: Optional[str] = None
    provider_type: Literal["openai", "openclaw"] = "openai"
    auth_scheme: Optional[Literal["bearer", "x-openclaw-token", "none"]] = None
    extra_json: Optional[str] = None
    system_prompt_template: Optional[str] = None
    asker_info_mode: Literal["off", "system_prompt", "variables"] = "off"
    include_asker_info: Optional[bool] = None
    enabled: bool = True


class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    api_token: Optional[str] = None
    model: Optional[str] = None
    provider_type: Optional[Literal["openai", "openclaw"]] = None
    auth_scheme: Optional[Literal["bearer", "x-openclaw-token", "none"]] = None
    extra_json: Optional[str] = None
    system_prompt_template: Optional[str] = None
    asker_info_mode: Optional[Literal["off", "system_prompt", "variables"]] = None
    include_asker_info: Optional[bool] = None
    enabled: Optional[bool] = None


class ProviderTestRequest(BaseModel):
    provider_id: Optional[int] = None
    base_url: Optional[str] = None
    api_token: Optional[str] = None
    model: Optional[str] = None
    provider_type: Optional[Literal["openai", "openclaw"]] = None
    auth_scheme: Optional[Literal["bearer", "x-openclaw-token", "none"]] = None
    extra_json: Optional[str] = None


class RuleCreate(BaseModel):
    robot_id: str
    scene: Literal["group", "private"]
    pattern_match_type: Literal["all", "exact", "regex"] = "regex"
    pattern: Optional[str] = None
    content_match_type: Literal["all", "exact", "regex"] = "regex"
    content_pattern: Optional[str] = None
    provider_id: int
    priority: int = 100
    enabled: bool = True


class RuleUpdate(BaseModel):
    pattern_match_type: Optional[Literal["all", "exact", "regex"]] = None
    pattern: Optional[str] = None
    content_match_type: Optional[Literal["all", "exact", "regex"]] = None
    content_pattern: Optional[str] = None
    provider_id: Optional[int] = None
    priority: Optional[int] = None
    enabled: Optional[bool] = None


class ReorderPayload(BaseModel):
    rule_ids: List[int] = Field(default_factory=list)


class ForwardRuleCreate(BaseModel):
    source_robot_id: str
    source_scene: Literal["group", "private"]
    source_match_type: Literal["all", "exact", "regex"] = "all"
    source_pattern: Optional[str] = None
    target_name: str
    use_other_robot: bool = False
    send_robot_id: Optional[str] = None
    prefix_enabled: bool = True
    prefix_template: Optional[str] = None
    keyword_match_type: Literal["all", "exact", "regex"] = "all"
    keyword_pattern: Optional[str] = None
    enabled: bool = True


class ForwardRuleUpdate(BaseModel):
    source_robot_id: Optional[str] = None
    source_scene: Optional[Literal["group", "private"]] = None
    source_match_type: Optional[Literal["all", "exact", "regex"]] = None
    source_pattern: Optional[str] = None
    target_name: Optional[str] = None
    use_other_robot: Optional[bool] = None
    send_robot_id: Optional[str] = None
    prefix_enabled: Optional[bool] = None
    prefix_template: Optional[str] = None
    keyword_match_type: Optional[Literal["all", "exact", "regex"]] = None
    keyword_pattern: Optional[str] = None
    enabled: Optional[bool] = None


class MessageCallbackPayload(BaseModel):
    robot_id: str
    callback_url: str
    reply_all: int = 1


class RobotCallbackBindPayload(BaseModel):
    robot_id: str
    callback_url: str
    type: int


class RobotCallbackDeletePayload(BaseModel):
    robot_id: str
    type: int
    robot_key: str = ""


class CallbackTestPayload(BaseModel):
    callback_url: str


class GroupTagCreateRequest(BaseModel):
    name: str


class GroupTagUpdateRequest(BaseModel):
    name: str


class GroupTagItemCreateRequest(BaseModel):
    match_type: Literal["exact", "regex"] = "exact"
    values: List[str] = Field(default_factory=list)


class TaskDispatchRequest(BaseModel):
    robot_id: str
    action: Literal[
        "send_text",
        "send_file",
        "create_external_group",
        "update_group",
        "dissolve_group",
        "add_friend_by_phone",
        "clear_wework_storage",
    ]
    tag_ids: List[int] = Field(default_factory=list)
    target_names: List[str] = Field(default_factory=list)
    at_list: List[str] = Field(default_factory=list)
    content: Optional[str] = None
    object_name: Optional[str] = None
    file_url: Optional[str] = None
    file_type: Optional[str] = None
    extra_text: Optional[str] = None
    group_name: Optional[str] = None
    new_group_name: Optional[str] = None
    new_group_announcement: Optional[str] = None
    select_list: List[str] = Field(default_factory=list)
    show_message_history: Optional[bool] = None
    remove_list: List[str] = Field(default_factory=list)
    group_announcement: Optional[str] = None
    group_remark: Optional[str] = None
    group_template: Optional[str] = None
    phone: Optional[str] = None
    mark_name: Optional[str] = None
    mark_extra: Optional[str] = None
    friend_tag_list: List[str] = Field(default_factory=list)
    leaving_msg: Optional[str] = None


class ScheduledTaskCreateRequest(BaseModel):
    robot_id: str
    name: str
    action: Literal[
        "send_text",
        "send_file",
        "create_external_group",
        "update_group",
        "dissolve_group",
        "add_friend_by_phone",
        "clear_wework_storage",
    ]
    payload_json: Dict[str, Any] = Field(default_factory=dict)
    schedule_type: Literal["once", "daily", "weekly", "cron"] = "once"
    timezone: str = "Asia/Shanghai"
    run_at: Optional[str] = None
    daily_time: Optional[str] = None
    weekly_days: List[int] = Field(default_factory=list)
    cron_expr: Optional[str] = None
    misfire_policy: Literal["skip", "fire_once"] = "skip"
    status: Literal["draft", "enabled", "paused"] = "draft"


class ScheduledTaskUpdateRequest(BaseModel):
    name: Optional[str] = None
    action: Optional[
        Literal[
            "send_text",
            "send_file",
            "create_external_group",
            "update_group",
            "dissolve_group",
            "add_friend_by_phone",
            "clear_wework_storage",
        ]
    ] = None
    payload_json: Optional[Dict[str, Any]] = None
    schedule_type: Optional[Literal["once", "daily", "weekly", "cron"]] = None
    timezone: Optional[str] = None
    run_at: Optional[str] = None
    daily_time: Optional[str] = None
    weekly_days: Optional[List[int]] = None
    cron_expr: Optional[str] = None
    misfire_policy: Optional[Literal["skip", "fire_once"]] = None
    status: Optional[Literal["draft", "enabled", "paused", "disabled"]] = None


class InboxMessageCreate(BaseModel):
    category: Literal["system", "ops"] = "ops"
    level: Literal["info", "warning", "error"] = "info"
    title: str
    content: str
    recipient_scope: Dict[str, Any] = Field(default_factory=lambda: {"type": "all"})
    publish_at: Optional[str] = None
    expire_at: Optional[str] = None
    publish_now: bool = False


class InboxMessageUpdate(BaseModel):
    category: Optional[Literal["system", "ops"]] = None
    level: Optional[Literal["info", "warning", "error"]] = None
    title: Optional[str] = None
    content: Optional[str] = None
    recipient_scope: Optional[Dict[str, Any]] = None
    publish_at: Optional[str] = None
    expire_at: Optional[str] = None
    status: Optional[Literal["draft", "published", "offline"]] = None


class CommandBacklogNoticeRequest(BaseModel):
    robot_id: str
    pending_overdue_count: int
    oldest_pending_time: str
    newest_result_time: Optional[str] = None


# ----- permission helpers -----
def _bound_robot_pk_set(user_id: int) -> set:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT robot_pk FROM user_robots WHERE user_id=%s", (user_id,))
            return {int(x["robot_pk"]) for x in (cur.fetchall() or [])}
    finally:
        conn.close()


def _get_robot_by_id_or_404(robot_id: str) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM robots WHERE robot_id=%s LIMIT 1", (robot_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="robot not found")
            return row
    finally:
        conn.close()


def _get_robot_by_pk_or_404(robot_pk: int) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM robots WHERE id=%s LIMIT 1", (int(robot_pk),))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="robot not found")
            return row
    finally:
        conn.close()


def _require_robot_access(user_id: int, robot_id: str) -> Dict[str, Any]:
    row = _get_robot_by_id_or_404(robot_id)
    if int(row["id"]) not in _bound_robot_pk_set(user_id):
        raise HTTPException(status_code=403, detail="无权访问该机器人")
    return row


def _require_robot_access_by_pk(user_id: int, robot_pk: int) -> Dict[str, Any]:
    row = _get_robot_by_pk_or_404(int(robot_pk))
    if int(row["id"]) not in _bound_robot_pk_set(user_id):
        raise HTTPException(status_code=403, detail="无权访问该机器人")
    return row


def _is_demo_robot_id(robot_id: str) -> bool:
    rid = str(robot_id or "").strip().lower()
    return bool(rid) and rid in DEMO_ROBOT_IDS


def _reject_demo_robot_write(robot_id: str, scope: str = "当前配置", user: Optional[Dict[str, Any]] = None) -> None:
    if user and _is_admin_phone(str(user.get("phone") or "")):
        return
    if _is_demo_robot_id(robot_id):
        raise HTTPException(
            status_code=403,
            detail=f"演示机器人（{robot_id}）为只读模式，不能修改{scope}。你可以查看配置并下发任务进行体验。",
        )


def _provider_exists(provider_id: int) -> bool:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM ai_providers WHERE id=%s LIMIT 1", (provider_id,))
            return bool(cur.fetchone())
    finally:
        conn.close()


def _provider_owned_by_user(provider_id: int, user_id: int) -> bool:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM ai_providers WHERE id=%s AND created_by=%s AND is_system=0 LIMIT 1", (provider_id, user_id))
            return bool(cur.fetchone())
    finally:
        conn.close()


def _provider_accessible_by_user(provider_id: int, user_id: int, robot_pk: Optional[int] = None) -> bool:
    include_system = 1 if _default_test_provider_enabled() else 0
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            if robot_pk is None:
                cur.execute(
                    """
                    SELECT 1
                    FROM ai_providers p
                    WHERE p.id=%s
                      AND (
                        (%s=1 AND p.is_system=1) OR
                        p.created_by=%s OR EXISTS(
                          SELECT 1
                          FROM routing_rules r
                          JOIN user_robots ur ON ur.robot_pk=r.robot_pk
                          WHERE r.provider_id=p.id AND ur.user_id=%s
                        )
                      )
                    LIMIT 1
                    """,
                    (provider_id, include_system, user_id, user_id),
                )
            else:
                cur.execute(
                    """
                    SELECT 1
                    FROM ai_providers p
                    WHERE p.id=%s
                      AND (
                        (%s=1 AND p.is_system=1) OR
                        p.created_by=%s OR EXISTS(
                          SELECT 1
                          FROM routing_rules r
                          WHERE r.provider_id=p.id AND r.robot_pk=%s
                        )
                      )
                    LIMIT 1
                    """,
                    (provider_id, include_system, user_id, int(robot_pk)),
                )
            return bool(cur.fetchone())
    finally:
        conn.close()


def _resolve_auth_scheme(provider_type: str, auth_scheme: Optional[str]) -> str:
    if auth_scheme:
        return auth_scheme
    return "x-openclaw-token" if provider_type == "openclaw" else "bearer"


def _resolve_asker_info_mode(
    asker_info_mode: Optional[str],
    include_asker_info: Optional[bool],
) -> str:
    mode = str(asker_info_mode or "").strip().lower()
    if mode in {"off", "system_prompt", "variables"}:
        return mode
    if include_asker_info is True:
        return "variables"
    return "off"


def _normalize_group_reply_mode(
    group_reply_mode: Optional[str],
    group_reply_only_when_mentioned: Optional[bool],
) -> str:
    mode = (group_reply_mode or "").strip().lower()
    if mode in {"always", "mention_only", "ai_decide"}:
        return mode
    return "mention_only" if bool(group_reply_only_when_mentioned) else "always"


def _normalize_name_key(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def _expand_colleague_aliases(name: str) -> List[str]:
    raw = str(name or "").strip()
    if not raw:
        return []
    aliases: List[str] = [raw]
    m = re.match(r"^\s*(.*?)\s*[（(]\s*(.*?)\s*[）)]\s*$", raw)
    if not m:
        return aliases
    prefix = (m.group(1) or "").strip()
    inner = (m.group(2) or "").strip()
    if prefix:
        aliases.append(prefix)
    if inner:
        aliases.append(inner)
    return aliases


def _build_group_colleague_name_keys(colleagues: List[str]) -> Set[str]:
    keys: Set[str] = set()
    for name in colleagues:
        for alias in _expand_colleague_aliases(name):
            key = _normalize_name_key(alias)
            if key:
                keys.add(key)
    return keys


def _normalize_group_colleagues(values: Optional[List[str]]) -> List[str]:
    if not isinstance(values, list):
        return []
    seen: Set[str] = set()
    result: List[str] = []
    for x in values:
        name = str(x or "").strip()
        if not name:
            continue
        key = _normalize_name_key(name)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(name[:64])
        if len(result) >= 200:
            break
    return result


def _normalize_group_decision_prompt_template(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    return s[:12000]


def _normalize_provider_system_prompt_template(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    return s[:12000]


def _load_group_colleagues_from_robot(robot: Dict[str, Any]) -> List[str]:
    raw = robot.get("group_colleagues_json")
    if isinstance(raw, list):
        return _normalize_group_colleagues(raw)
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return _normalize_group_colleagues(parsed)
        except Exception:
            return []
    return []


def _render_group_decision_prompt_template(template: str, values: Dict[str, str]) -> str:
    prompt = str(template or "")
    for key, val in values.items():
        prompt = prompt.replace(f"{{{key}}}", str(val or ""))
    return prompt


def _render_provider_system_prompt_template(template: str, values: Dict[str, str]) -> str:
    prompt = str(template or "")
    for key, val in values.items():
        prompt = prompt.replace(f"{{{key}}}", str(val or ""))
    return prompt


def _normalize_extra_json(extra_json: Optional[str]) -> Optional[str]:
    if extra_json is None:
        return None
    s = extra_json.strip()
    if not s:
        return None
    try:
        parsed = json.loads(s)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"extra_json 不是有效JSON: {e}") from e
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="extra_json 必须是JSON对象")
    return json.dumps(parsed, ensure_ascii=False)


def _parse_datetime_or_none(raw: Optional[str], raise_on_invalid: bool = True) -> Optional[datetime]:
    s = (raw or "").strip()
    if not s:
        return None
    for candidate in (s, s.replace(" ", "T")):
        try:
            return datetime.fromisoformat(candidate)
        except Exception:
            continue
    if raise_on_invalid:
        raise HTTPException(status_code=400, detail="时间格式不合法，支持 YYYY-MM-DD HH:MM:SS 或 ISO8601")
    return None


def _normalize_wework_expire_time(raw: Optional[str]) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return f"{s}T23:59:59"
    dt = _parse_datetime_or_none(s, raise_on_invalid=True)
    if dt is None:
        return ""
    return dt.replace(microsecond=0).isoformat()


def _normalize_recipient_scope(scope: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    data = scope if isinstance(scope, dict) else {}
    scope_type = str(data.get("type") or "all").strip().lower()
    if scope_type not in {"all", "admins", "phones"}:
        raise HTTPException(status_code=400, detail="recipient_scope.type 必须是 all/admins/phones")
    if scope_type != "phones":
        return {"type": scope_type}
    phones_raw = data.get("phones")
    if not isinstance(phones_raw, list):
        raise HTTPException(status_code=400, detail="recipient_scope.phones 必须是手机号数组")
    phones = []
    seen: Set[str] = set()
    for x in phones_raw:
        p = str(x or "").strip()
        if not _is_valid_phone(p):
            continue
        if p in seen:
            continue
        seen.add(p)
        phones.append(p)
    if not phones:
        raise HTTPException(status_code=400, detail="recipient_scope.phones 至少包含一个有效手机号")
    return {"type": "phones", "phones": phones}


def _recipient_scope_json(scope: Dict[str, Any]) -> str:
    return json.dumps(scope, ensure_ascii=False)


def _resolve_recipient_user_ids(cur: Any, scope: Dict[str, Any]) -> List[int]:
    scope_type = str(scope.get("type") or "all")
    if scope_type == "all":
        cur.execute("SELECT id FROM users WHERE is_active=1")
        return [int(x["id"]) for x in (cur.fetchall() or [])]
    if scope_type == "admins":
        cur.execute("SELECT id, phone FROM users WHERE is_active=1")
        return [int(x["id"]) for x in (cur.fetchall() or []) if _is_admin_phone(str(x.get("phone") or ""))]
    phones = scope.get("phones") or []
    if not phones:
        return []
    placeholders = ",".join(["%s"] * len(phones))
    cur.execute(f"SELECT id FROM users WHERE is_active=1 AND phone IN ({placeholders})", tuple(phones))
    return [int(x["id"]) for x in (cur.fetchall() or [])]


def _insert_inbox_deliveries(cur: Any, message_id: int, user_ids: List[int]) -> int:
    if not user_ids:
        return 0
    inserted = 0
    for uid in user_ids:
        cur.execute(
            """
            INSERT INTO inbox_deliveries(message_id,user_id,is_read,read_at,delivered_at)
            VALUES(%s,%s,0,NULL,UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE message_id=message_id
            """,
            (int(message_id), int(uid)),
        )
        inserted += int(cur.rowcount or 0)
    return inserted


def _publish_inbox_message(conn: Any, message_id: int) -> Dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM inbox_messages WHERE id=%s LIMIT 1", (int(message_id),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="站内信不存在")
        scope_raw = row.get("recipient_scope_json")
        scope = scope_raw if isinstance(scope_raw, dict) else {}
        if not scope:
            scope = {"type": "all"}
        recipients = _resolve_recipient_user_ids(cur, scope)
        inserted = _insert_inbox_deliveries(cur, int(row["id"]), recipients)
        cur.execute(
            "UPDATE inbox_messages SET status='published', publish_at=COALESCE(publish_at, UTC_TIMESTAMP()) WHERE id=%s",
            (int(row["id"]),),
        )
    return {"recipient_count": len(recipients), "new_delivery_count": inserted}


def _create_system_inbox_message(
    conn: Any,
    *,
    title: str,
    content: str,
    level: str,
    user_ids: List[int],
    system_key: str,
    system_ref: str,
    expire_at: Optional[datetime] = None,
) -> None:
    if not user_ids:
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO inbox_messages(
              category,level,title,content,recipient_scope_json,status,publish_at,expire_at,system_key,system_ref,created_by
            ) VALUES('system',%s,%s,%s,%s,'published',UTC_TIMESTAMP(),%s,%s,%s,NULL)
            """,
            (
                level,
                title.strip()[:255],
                content.strip(),
                _recipient_scope_json({"type": "all"}),
                expire_at,
                system_key,
                system_ref[:255],
            ),
        )
        msg_id = int(cur.lastrowid)
        _insert_inbox_deliveries(cur, msg_id, user_ids)


async def _run_expiry_notice_scan_if_needed() -> None:
    today = datetime.utcnow().strftime("%Y-%m-%d")
    async with _expiry_notice_scan_lock:
        conn = db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT `value` FROM app_settings WHERE `key`='inbox_expiry_notice_last_scan_date' LIMIT 1"
                )
                row = cur.fetchone() or {}
                if str(row.get("value") or "").strip() == today:
                    return
                cur.execute(
                    """
                    SELECT ur.user_id, r.robot_id
                    FROM user_robots ur
                    JOIN robots r ON r.id=ur.robot_pk
                    GROUP BY ur.user_id, r.robot_id
                    """
                )
                pairs = cur.fetchall() or []
            owners: Dict[str, List[int]] = {}
            for x in pairs:
                rid = str(x.get("robot_id") or "").strip()
                uid = int(x.get("user_id") or 0)
                if not rid or uid <= 0:
                    continue
                owners.setdefault(rid, []).append(uid)

            now_utc = datetime.utcnow()
            for robot_id, user_ids in owners.items():
                try:
                    detail = await fetch_worktool_api("/robot/robotInfo/get-detail", {"robotId": robot_id})
                except Exception as e:
                    logger.warning("expiry_notice_scan_detail_failed robot_id=%s err=%s", robot_id, str(e))
                    continue
                data = detail.get("data") if isinstance(detail, dict) else {}
                raw_expire = str((data or {}).get("authExpir") or (data or {}).get("authExpire") or "").strip()
                if not raw_expire:
                    continue
                expire_at = _parse_datetime_or_none(raw_expire, raise_on_invalid=False)
                if not expire_at:
                    continue
                delta = expire_at - now_utc
                if delta.total_seconds() < 0 or delta > timedelta(days=30):
                    continue
                days_left = max(int(delta.total_seconds() // 86400), 0)
                title = f"机器人 {robot_id} 授权将在30天内到期"
                content = f"请尽快续期，当前预计剩余 {days_left} 天，到期时间：{expire_at.strftime('%Y-%m-%d %H:%M:%S')}。"
                for uid in user_ids:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            SELECT 1
                            FROM inbox_deliveries d
                            JOIN inbox_messages m ON m.id=d.message_id
                            WHERE d.user_id=%s AND m.system_key='robot_expire_30d' AND m.system_ref=%s
                              AND m.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
                            LIMIT 1
                            """,
                            (int(uid), robot_id),
                        )
                        if cur.fetchone():
                            continue
                    _create_system_inbox_message(
                        conn,
                        title=title,
                        content=content,
                        level="warning",
                        user_ids=[int(uid)],
                        system_key="robot_expire_30d",
                        system_ref=robot_id,
                        expire_at=now_utc + timedelta(days=90),
                    )
                    conn.commit()

            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO app_settings(`key`,`value`) VALUES('inbox_expiry_notice_last_scan_date', %s)
                    ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), updated_at=CURRENT_TIMESTAMP
                    """,
                    (today,),
                )
            conn.commit()
        except Exception as e:
            logger.warning("expiry_notice_scan_failed err=%s", str(e))
            try:
                conn.rollback()
            except Exception:
                pass
        finally:
            conn.close()


def _to_unix_ts(value: Any) -> float:
    dt = _parse_datetime_or_none(str(value or "").strip(), raise_on_invalid=False)
    if not dt:
        return 0.0
    try:
        return float(dt.timestamp())
    except Exception:
        return 0.0


async def _run_login_flap_notice_scan_for_user_if_needed(user_id: int) -> None:
    uid = int(user_id)
    if uid <= 0:
        return
    today_local = datetime.now().strftime("%Y-%m-%d")
    scan_key = f"inbox_login_flap_scan_user_{uid}"
    now_ts = time.time()
    day_start_ts = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT `value` FROM app_settings WHERE `key`=%s LIMIT 1", (scan_key,))
            row = cur.fetchone() or {}
            if str(row.get("value") or "").strip() == today_local:
                return
            cur.execute(
                """
                SELECT r.robot_id
                FROM user_robots ur
                JOIN robots r ON r.id=ur.robot_pk
                WHERE ur.user_id=%s
                ORDER BY r.id DESC
                """,
                (uid,),
            )
            robot_ids = [str(x.get("robot_id") or "").strip() for x in (cur.fetchall() or [])]

        for robot_id in robot_ids:
            if not robot_id:
                continue
            try:
                online_infos_res = await fetch_worktool_api("/robot/robotInfo/onlineInfos", {"robotId": robot_id})
            except Exception as e:
                logger.warning("login_flap_scan_online_infos_failed user_id=%s robot_id=%s err=%s", uid, robot_id, str(e))
                continue
            rows = online_infos_res.get("data") if isinstance(online_infos_res, dict) else []
            if not isinstance(rows, list):
                rows = []

            day_start_count = 0
            recent24h_count = 0
            for row in rows:
                if not isinstance(row, dict):
                    continue
                ts = _to_unix_ts(row.get("onlineTime"))
                if ts <= 0:
                    continue
                if ts >= day_start_ts:
                    day_start_count += 1
                if now_ts - ts <= 24 * 60 * 60:
                    recent24h_count += 1

            if day_start_count <= 10 and recent24h_count <= 10:
                continue

            system_ref = f"{robot_id}:{today_local}:{uid}"
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT 1
                    FROM inbox_deliveries d
                    JOIN inbox_messages m ON m.id=d.message_id
                    WHERE d.user_id=%s AND m.system_key='robot_login_flap' AND m.system_ref=%s
                    LIMIT 1
                    """,
                    (uid, system_ref),
                )
                if cur.fetchone():
                    continue

            _create_system_inbox_message(
                conn,
                title=f"机器人 {robot_id} 登录上下线波动偏高",
                content=(
                    f"24小时 {recent24h_count} 次，今日 {day_start_count} 次。"
                    "检测到登录日志频繁波动，可能是客户端设备网络状况不佳，建议优先检查设备网络稳定性。"
                ),
                level="warning",
                user_ids=[uid],
                system_key="robot_login_flap",
                system_ref=system_ref,
                expire_at=datetime.utcnow() + timedelta(days=30),
            )
            conn.commit()

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO app_settings(`key`,`value`) VALUES(%s,%s)
                ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), updated_at=CURRENT_TIMESTAMP
                """,
                (scan_key, today_local),
            )
        conn.commit()
    except Exception as e:
        logger.warning("login_flap_scan_failed user_id=%s err=%s", uid, str(e))
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        conn.close()


def get_worktool_api_base() -> str:
    if WORKTOOL_API_BASE_FIXED_RAW:
        return normalize_worktool_api_base(WORKTOOL_API_BASE_FIXED_RAW)
    return normalize_worktool_api_base(get_setting("worktool_api_base", WORKTOOL_API_BASE_DEFAULT))


def get_callback_public_base_url() -> str:
    if CALLBACK_PUBLIC_BASE_URL_FIXED_RAW:
        return normalize_public_base_url(CALLBACK_PUBLIC_BASE_URL_FIXED_RAW)
    return normalize_public_base_url(get_setting("callback_public_base_url", ""))


def build_robot_callback_url(robot_id: str) -> str:
    base = get_callback_public_base_url()
    if not base:
        return ""
    return f"{base}/api/v1/callback/qa/{robot_id.strip()}"


async def fetch_worktool_api(path: str, params: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{get_worktool_api_base()}{path}"
    # aiohttp query params do not accept None values.
    safe_params = {k: v for k, v in (params or {}).items() if v is not None}
    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, params=safe_params) as resp:
            if resp.status != 200:
                raise HTTPException(status_code=502, detail=f"worktool request failed: status={resp.status}")
            raw = await resp.text()
            if not raw.strip():
                raise HTTPException(status_code=502, detail="worktool response empty")
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                preview = raw.strip().replace("\n", " ")[:200]
                logger.warning(
                    "worktool non-json response path=%s status=%s body_preview=%s",
                    path,
                    resp.status,
                    preview,
                )
                raise HTTPException(status_code=502, detail="worktool response is not valid json")
            return data if isinstance(data, dict) else {"data": data}


async def _get_robot_display_name_cached(robot_id: str) -> str:
    rid = (robot_id or "").strip()
    if not rid:
        return ""
    now_ts = time.time()
    async with _robot_show_name_cache_lock:
        cache = _robot_show_name_cache.get(rid)
        if isinstance(cache, dict) and float(cache.get("expire_at") or 0) > now_ts:
            return str(cache.get("show_name") or "")
    display_name = ""
    try:
        detail = await fetch_worktool_api("/robot/robotInfo/get-detail", {"robotId": rid})
        data = detail.get("data") or {}
        if isinstance(data, dict):
            display_name = str(data.get("name") or "").strip() or str(data.get("showName") or "").strip()
    except Exception as e:
        logger.warning("robot_show_name_fetch_failed robot_id=%s err=%s", rid, str(e))
    async with _robot_show_name_cache_lock:
        _robot_show_name_cache[rid] = {
            "show_name": display_name,
            "expire_at": now_ts + ROBOT_SHOW_NAME_CACHE_TTL_SECONDS,
        }
    return display_name


async def post_worktool_api(path: str, params: Optional[Dict[str, Any]] = None, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    url = f"{get_worktool_api_base()}{path}"
    safe_params = {k: v for k, v in ((params or {}).items()) if v is not None}
    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(url, params=safe_params, json=body) as resp:
            raw = await resp.text()
            if resp.status != 200:
                detail_msg = f"worktool request failed: status={resp.status}"
                if raw.strip():
                    try:
                        err_data = json.loads(raw)
                        if isinstance(err_data, dict):
                            code = err_data.get("code")
                            msg = err_data.get("message") or err_data.get("msg")
                            if msg:
                                detail_msg = f"worktool request failed: {msg}" + (f" (code={code})" if code is not None else "")
                    except Exception:
                        preview = raw.strip().replace("\n", " ")[:180]
                        detail_msg = f"worktool request failed: status={resp.status}, body={preview}"
                raise HTTPException(status_code=400, detail=detail_msg)
            if not raw.strip():
                raise HTTPException(status_code=502, detail="worktool response empty")
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                preview = raw.strip().replace("\n", " ")[:200]
                logger.warning(
                    "worktool non-json response path=%s status=%s body_preview=%s",
                    path,
                    resp.status,
                    preview,
                )
                raise HTTPException(status_code=502, detail="worktool response is not valid json")
            return data if isinstance(data, dict) else {"data": data}


async def fetch_worktool_group_list_all(robot_id: str, page_size: int = 100, max_pages: int = 200) -> List[Dict[str, Any]]:
    rid = (robot_id or "").strip()
    if not rid:
        return []
    items: List[Dict[str, Any]] = []
    page = 1
    total_page = 1
    safe_size = max(1, min(int(page_size), 200))
    while page <= total_page and page <= max_pages:
        res = await fetch_worktool_api(
            "/robot/wework/group/list",
            {"robotId": rid, "page": page, "size": safe_size, "sort": "id,desc"},
        )
        data = res.get("data") if isinstance(res, dict) else {}
        if not isinstance(data, dict):
            data = {}
        rows = data.get("list") or []
        if not isinstance(rows, list):
            rows = []
        for row in rows:
            if isinstance(row, dict):
                items.append(row)
        try:
            total_page = int(data.get("totalPage") or 1)
        except Exception:
            total_page = 1
        page += 1
    return items


def _group_row_cursor(row: Dict[str, Any]) -> tuple:
    raw_t = str(row.get("updateTime") or row.get("createTime") or "").strip()
    t_obj = _parse_datetime_or_none(raw_t, raise_on_invalid=False)
    if t_obj is None:
        t_obj = datetime.min
        raw_t = ""
    try:
        sid = int(row.get("id")) if row.get("id") is not None else None
    except Exception:
        sid = None
    return (t_obj, sid, raw_t)


async def fetch_worktool_group_list_incremental(
    robot_id: str,
    updated_after: Optional[str],
    last_id: Optional[int],
    page_size: int = 200,
    max_pages: int = 200,
) -> List[Dict[str, Any]]:
    rid = (robot_id or "").strip()
    if not rid:
        return []
    safe_size = max(1, min(int(page_size), 200))
    page = 1
    total_page = 1
    items: List[Dict[str, Any]] = []
    while page <= total_page and page <= max_pages:
        params: Dict[str, Any] = {"robotId": rid, "page": page, "size": safe_size}
        ua = (updated_after or "").strip()
        if ua:
            params["updatedAfter"] = ua
        if last_id is not None:
            params["lastId"] = int(last_id)
        res = await fetch_worktool_api("/robot/wework/group/list", params)
        data = res.get("data") if isinstance(res, dict) else {}
        if not isinstance(data, dict):
            data = {}
        rows = data.get("list") or []
        if not isinstance(rows, list):
            rows = []
        for row in rows:
            if isinstance(row, dict):
                items.append(row)
        try:
            total_page = int(data.get("totalPage") or 1)
        except Exception:
            total_page = 1
        page += 1
    return items


def get_robot_group_sync_state(robot_pk: int) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT cursor_time,cursor_id,last_sync_at FROM robot_group_sync_state WHERE robot_pk=%s LIMIT 1",
                (int(robot_pk),),
            )
            row = cur.fetchone() or {}
            return {
                "cursor_time": (row.get("cursor_time") or "").strip() if isinstance(row, dict) else "",
                "cursor_id": int(row.get("cursor_id")) if row and row.get("cursor_id") is not None else None,
                "last_sync_at": row.get("last_sync_at") if isinstance(row, dict) else None,
            }
    finally:
        conn.close()


def save_robot_group_sync_state(robot_pk: int, cursor_time: Optional[str], cursor_id: Optional[int]) -> None:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO robot_group_sync_state(robot_pk,cursor_time,cursor_id,last_sync_at)
                VALUES(%s,%s,%s,CURRENT_TIMESTAMP)
                ON DUPLICATE KEY UPDATE
                  cursor_time=VALUES(cursor_time),
                  cursor_id=VALUES(cursor_id),
                  last_sync_at=CURRENT_TIMESTAMP
                """,
                (
                    int(robot_pk),
                    (cursor_time or "").strip()[:64] or None,
                    int(cursor_id) if cursor_id is not None else None,
                ),
            )
        conn.commit()
    finally:
        conn.close()


async def sync_robot_groups_by_cursor(robot_pk: int, robot_id: str) -> Dict[str, Any]:
    state = get_robot_group_sync_state(int(robot_pk))
    cursor_time = (state.get("cursor_time") or "").strip()
    cursor_id = state.get("cursor_id")
    is_incremental = bool(cursor_time) and cursor_id is not None and int(cursor_id) > 0
    if is_incremental:
        rows = await fetch_worktool_group_list_incremental(robot_id, cursor_time, int(cursor_id), page_size=200, max_pages=200)
        mode = "incremental"
    else:
        rows = await fetch_worktool_group_list_all(robot_id, page_size=200, max_pages=200)
        mode = "full"
    affected = upsert_robot_group_cache(int(robot_pk), rows)
    next_cursor_time = cursor_time
    next_cursor_id = cursor_id
    if rows:
        cands = [x for x in (_group_row_cursor(r) for r in rows) if x[1] is not None and int(x[1]) > 0]
        if cands:
            best = max(cands, key=lambda x: (x[0], int(x[1])))
            next_cursor_time = best[2] or cursor_time
            next_cursor_id = int(best[1]) if best[1] is not None else None
            if next_cursor_time and next_cursor_id is not None and next_cursor_id > 0:
                save_robot_group_sync_state(int(robot_pk), next_cursor_time, next_cursor_id)
        else:
            # 上游暂未返回可用id时，不启用增量游标，避免 lastId=0 造成伪增量。
            next_cursor_id = None
    return {
        "mode": mode,
        "fetched": len(rows),
        "affected": affected,
        "cursor_time": next_cursor_time or "",
    }


def upsert_robot_group_cache(robot_pk: int, rows: List[Dict[str, Any]]) -> int:
    if not rows:
        return 0
    conn = db_conn()
    affected = 0
    try:
        with conn.cursor() as cur:
            for row in rows:
                group_name = str(row.get("groupName") or "").strip()
                if not group_name:
                    continue
                cur.execute(
                    """
                    INSERT INTO robot_group_cache(
                      robot_pk,source_id,group_name,master_name,msg_insert_time,msg_num,members_num,group_announcement,level,source_create_time,source_update_time,raw_json,synced_at
                    ) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP)
                    ON DUPLICATE KEY UPDATE
                      source_id=VALUES(source_id),
                      master_name=VALUES(master_name),
                      msg_insert_time=VALUES(msg_insert_time),
                      msg_num=VALUES(msg_num),
                      members_num=VALUES(members_num),
                      group_announcement=VALUES(group_announcement),
                      level=VALUES(level),
                      source_create_time=VALUES(source_create_time),
                      source_update_time=VALUES(source_update_time),
                      raw_json=VALUES(raw_json),
                      synced_at=CURRENT_TIMESTAMP
                    """,
                    (
                        int(robot_pk),
                        int(row.get("id")) if row.get("id") is not None else None,
                        group_name[:255],
                        str(row.get("masterName") or "").strip()[:255] or None,
                        str(row.get("msgInsertTime") or "").strip()[:64] or None,
                        int(row.get("msgNum")) if row.get("msgNum") is not None else None,
                        int(row.get("membersNum")) if row.get("membersNum") is not None else None,
                        str(row.get("groupAnnouncement") or "")[:4000] or None,
                        int(row.get("level")) if row.get("level") is not None else None,
                        str(row.get("createTime") or "").strip()[:64] or None,
                        str(row.get("updateTime") or "").strip()[:64] or None,
                        json.dumps(row, ensure_ascii=False),
                    ),
                )
                affected += int(cur.rowcount or 0)
        conn.commit()
    finally:
        conn.close()
    return affected


def _normalize_group_tag_name(name: str) -> str:
    n = str(name or "").strip()
    if not n:
        raise HTTPException(status_code=400, detail="标签名不能为空")
    if len(n) > 64:
        raise HTTPException(status_code=400, detail="标签名长度不能超过64")
    return n


def _normalize_group_tag_values(values: List[str]) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
    for raw in values or []:
        v = str(raw or "").strip()
        if not v:
            continue
        if len(v) > 255:
            raise HTTPException(status_code=400, detail="群名或规则长度不能超过255")
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    if not out:
        raise HTTPException(status_code=400, detail="请至少输入一个群名或规则")
    return out


def _get_group_tag_or_404(tag_id: int, user_id: int, robot_pk: Optional[int] = None) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            if robot_pk is None:
                cur.execute("SELECT * FROM group_tags WHERE id=%s AND created_by=%s LIMIT 1", (int(tag_id), int(user_id)))
            else:
                cur.execute(
                    "SELECT * FROM group_tags WHERE id=%s AND created_by=%s AND robot_pk=%s LIMIT 1",
                    (int(tag_id), int(user_id), int(robot_pk)),
                )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="标签不存在")
            return row
    finally:
        conn.close()


def _normalize_str_list(values: List[Any], max_len: int = 255) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
    for raw in values or []:
        v = str(raw or "").strip()
        if not v:
            continue
        if len(v) > max_len:
            v = v[:max_len]
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def _resolve_targets_by_group_tags(user_id: int, robot_pk: int, tag_ids: List[int], manual_targets: List[str]) -> List[str]:
    targets = _normalize_str_list(manual_targets or [])
    tids = [int(x) for x in (tag_ids or []) if int(x) > 0]
    if not tids:
        return targets
    placeholders = ",".join(["%s"] * len(tids))
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT i.match_type,i.value
                FROM group_tag_items i
                JOIN group_tags t ON t.id=i.tag_id
                WHERE t.created_by=%s AND t.robot_pk=%s AND i.tag_id IN ({placeholders})
                """,
                tuple([int(user_id), int(robot_pk)] + tids),
            )
            rules = cur.fetchall() or []
            cur.execute("SELECT group_name FROM robot_group_cache WHERE robot_pk=%s", (int(robot_pk),))
            group_rows = cur.fetchall() or []
    finally:
        conn.close()

    group_names = [str(x.get("group_name") or "").strip() for x in group_rows]
    group_names = [x for x in group_names if x]
    for rule in rules:
        mtype = str(rule.get("match_type") or "exact").strip().lower()
        val = str(rule.get("value") or "").strip()
        if not val:
            continue
        if mtype == "exact":
            if val not in targets:
                targets.append(val)
            continue
        if mtype == "regex":
            for g in group_names:
                try:
                    ok = _match_with_mode("regex", val, g)
                except Exception:
                    ok = False
                if ok and g not in targets:
                    targets.append(g)
    return targets


async def _send_raw_message_batch(robot_id: str, list_items: List[Dict[str, Any]]) -> Dict[str, Any]:
    items = [x for x in (list_items or []) if isinstance(x, dict)]
    if not items:
        raise HTTPException(status_code=400, detail="无可发送指令")
    chunks = [items[i : i + 100] for i in range(0, len(items), 100)]
    results: List[Dict[str, Any]] = []
    for chunk in chunks:
        res = await post_worktool_api(
            "/wework/sendRawMessage",
            params={"robotId": robot_id},
            body={"socketType": 2, "list": chunk},
        )
        _ensure_worktool_ok(res, "发送指令")
        results.append(res)
    return {"batch_count": len(chunks), "item_count": len(items), "results": results}


def _parse_hms_or_400(raw: Optional[str]) -> str:
    s = str(raw or "").strip()
    if not s:
        raise HTTPException(status_code=400, detail="daily_time 不能为空")
    if re.fullmatch(r"\d{2}:\d{2}", s):
        s = f"{s}:00"
    if not re.fullmatch(r"\d{2}:\d{2}:\d{2}", s):
        raise HTTPException(status_code=400, detail="daily_time 格式应为 HH:MM 或 HH:MM:SS")
    hh, mm, ss = [int(x) for x in s.split(":")]
    if hh > 23 or mm > 59 or ss > 59:
        raise HTTPException(status_code=400, detail="daily_time 非法")
    return s


def _normalize_weekly_days_or_400(days: List[int]) -> List[int]:
    out = sorted({int(x) for x in (days or []) if int(x) >= 1 and int(x) <= 7})
    if not out:
        raise HTTPException(status_code=400, detail="weekly_days 至少包含一个 1-7 的值")
    return out


def _parse_cron_field(field: str, min_v: int, max_v: int) -> Set[int]:
    s = (field or "").strip()
    vals: Set[int] = set()
    if s == "*":
        return set(range(min_v, max_v + 1))
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        step = 1
        base = part
        if "/" in part:
            base, step_s = part.split("/", 1)
            try:
                step = int(step_s)
            except Exception:
                return set()
            if step <= 0:
                return set()
        if base == "*":
            start, end = min_v, max_v
        elif "-" in base:
            a, b = base.split("-", 1)
            try:
                start, end = int(a), int(b)
            except Exception:
                return set()
        else:
            try:
                v = int(base)
            except Exception:
                return set()
            start, end = v, v
        if start < min_v or end > max_v or start > end:
            return set()
        for v in range(start, end + 1, step):
            vals.add(v)
    return vals


def _next_cron_datetime(expr: str, base_dt: datetime) -> Optional[datetime]:
    parts = [x for x in str(expr or "").strip().split() if x]
    if len(parts) != 5:
        raise HTTPException(status_code=400, detail="cron_expr 仅支持5段表达式")
    mins = _parse_cron_field(parts[0], 0, 59)
    hours = _parse_cron_field(parts[1], 0, 23)
    doms = _parse_cron_field(parts[2], 1, 31)
    months = _parse_cron_field(parts[3], 1, 12)
    dows = _parse_cron_field(parts[4], 0, 6)
    if not mins or not hours or not doms or not months or not dows:
        raise HTTPException(status_code=400, detail="cron_expr 非法")
    probe = base_dt.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(366 * 24 * 60):
        if (
            probe.minute in mins
            and probe.hour in hours
            and probe.day in doms
            and probe.month in months
            and probe.weekday() in dows
        ):
            return probe
        probe += timedelta(minutes=1)
    return None


def _compute_next_run_at_by_rule(
    schedule_type: str,
    *,
    run_at: Optional[str],
    daily_time: Optional[str],
    weekly_days: Optional[str],
    cron_expr: Optional[str],
    base_dt: Optional[datetime] = None,
) -> Optional[datetime]:
    now_dt = base_dt or datetime.now()
    st = (schedule_type or "").strip().lower()
    if st == "once":
        dt = _parse_datetime_or_none(run_at, raise_on_invalid=True)
        if dt is None:
            raise HTTPException(status_code=400, detail="run_at 不能为空")
        return dt if dt > now_dt else None
    if st == "daily":
        t = _parse_hms_or_400(daily_time)
        hh, mm, ss = [int(x) for x in t.split(":")]
        cand = now_dt.replace(hour=hh, minute=mm, second=ss, microsecond=0)
        if cand <= now_dt:
            cand += timedelta(days=1)
        return cand
    if st == "weekly":
        t = _parse_hms_or_400(daily_time)
        hh, mm, ss = [int(x) for x in t.split(":")]
        days = _normalize_weekly_days_or_400([int(x) for x in re.split(r"[,\s]+", str(weekly_days or "").strip()) if x.strip()])
        now_wd = now_dt.weekday() + 1
        best: Optional[datetime] = None
        for d in days:
            delta = (d - now_wd) % 7
            cand = (now_dt + timedelta(days=delta)).replace(hour=hh, minute=mm, second=ss, microsecond=0)
            if cand <= now_dt:
                cand += timedelta(days=7)
            if best is None or cand < best:
                best = cand
        return best
    if st == "cron":
        return _next_cron_datetime(str(cron_expr or "").strip(), now_dt)
    raise HTTPException(status_code=400, detail="schedule_type 非法")


def _serialize_scheduled_task(row: Dict[str, Any]) -> Dict[str, Any]:
    payload_val = row.get("payload_json")
    payload_obj: Dict[str, Any] = {}
    if isinstance(payload_val, dict):
        payload_obj = payload_val
    elif isinstance(payload_val, str) and payload_val.strip():
        try:
            parsed = json.loads(payload_val)
            if isinstance(parsed, dict):
                payload_obj = parsed
        except Exception:
            payload_obj = {}
    return {
        "id": int(row.get("id") or 0),
        "robot_id": str(row.get("robot_id") or ""),
        "name": str(row.get("name") or ""),
        "action": str(row.get("action") or ""),
        "payload_json": payload_obj,
        "schedule_type": str(row.get("schedule_type") or "once"),
        "timezone": str(row.get("timezone") or "Asia/Shanghai"),
        "run_at": str(row.get("run_at") or ""),
        "daily_time": str(row.get("daily_time") or ""),
        "weekly_days": str(row.get("weekly_days") or ""),
        "cron_expr": str(row.get("cron_expr") or ""),
        "misfire_policy": str(row.get("misfire_policy") or "skip"),
        "status": str(row.get("status") or "draft"),
        "next_run_at": str(row.get("next_run_at") or ""),
        "last_run_at": str(row.get("last_run_at") or ""),
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at") or ""),
    }


def _parse_json_object(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


async def _dispatch_task_action_internal(user_id: int, robot_id: str, action: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    robot = _require_robot_access(int(user_id), robot_id)
    action = (action or "").strip().lower()
    payload = payload if isinstance(payload, dict) else {}
    tag_ids_raw = payload.get("tag_ids") or []
    tag_ids = [int(x) for x in tag_ids_raw if str(x).strip().isdigit()]
    target_names = _resolve_targets_by_group_tags(
        int(user_id),
        int(robot["id"]),
        tag_ids,
        payload.get("target_names") or [],
    )
    list_items: List[Dict[str, Any]] = []
    if action == "send_text":
        content = str(payload.get("content") or "").strip()
        if not content:
            raise HTTPException(status_code=400, detail="content 不能为空")
        targets = _normalize_str_list(target_names)
        if not targets:
            raise HTTPException(status_code=400, detail="请至少提供一个发送对象或标签")
        at_list = _normalize_str_list(payload.get("at_list") or [])
        for t in targets:
            item: Dict[str, Any] = {"type": 203, "titleList": [t], "receivedContent": content}
            if at_list:
                item["atList"] = at_list
            list_items.append(item)
    elif action == "send_file":
        object_name = str(payload.get("object_name") or "").strip()
        file_url = str(payload.get("file_url") or "").strip()
        file_type = str(payload.get("file_type") or "").strip() or "*"
        if not object_name or not file_url:
            raise HTTPException(status_code=400, detail="object_name 与 file_url 不能为空")
        targets = _normalize_str_list(target_names)
        if not targets:
            raise HTTPException(status_code=400, detail="请至少提供一个发送对象或标签")
        extra_text = str(payload.get("extra_text") or "").strip()
        for t in targets:
            item = {
                "type": 218,
                "titleList": [t],
                "objectName": object_name,
                "fileUrl": file_url,
                "fileType": file_type,
            }
            if extra_text:
                item["extraText"] = extra_text
            list_items.append(item)
    elif action == "create_external_group":
        group_name = str(payload.get("group_name") or "").strip()
        select_list = _normalize_str_list(payload.get("select_list") or [])
        if not group_name or not select_list:
            raise HTTPException(status_code=400, detail="group_name 与 select_list 不能为空")
        item = {"type": 206, "groupName": group_name, "selectList": select_list}
        if payload.get("group_announcement"):
            item["groupAnnouncement"] = str(payload.get("group_announcement")).strip()
        if payload.get("group_remark"):
            item["groupRemark"] = str(payload.get("group_remark")).strip()
        if payload.get("group_template"):
            item["groupTemplate"] = str(payload.get("group_template")).strip()
        list_items.append(item)
    elif action == "update_group":
        targets = _normalize_str_list(target_names)
        single_group_name = str(payload.get("group_name") or "").strip()
        if single_group_name:
            targets = [single_group_name]
        if not targets:
            raise HTTPException(status_code=400, detail="请至少提供一个群名（可使用标签组或手动目标名）")

        for group_name in targets:
            item = {"type": 207, "groupName": group_name}
            if payload.get("new_group_name"):
                item["newGroupName"] = str(payload.get("new_group_name")).strip()
            if payload.get("new_group_announcement"):
                item["newGroupAnnouncement"] = str(payload.get("new_group_announcement")).strip()
            if payload.get("group_remark"):
                item["groupRemark"] = str(payload.get("group_remark")).strip()
            if payload.get("group_template"):
                item["groupTemplate"] = str(payload.get("group_template")).strip()
            select_list = _normalize_str_list(payload.get("select_list") or [])
            remove_list = _normalize_str_list(payload.get("remove_list") or [])
            if select_list:
                item["selectList"] = select_list
                item["showMessageHistory"] = bool(payload.get("show_message_history"))
            if remove_list:
                item["removeList"] = remove_list
            list_items.append(item)
    elif action == "dissolve_group":
        group_name = str(payload.get("group_name") or "").strip()
        if not group_name:
            raise HTTPException(status_code=400, detail="group_name 不能为空")
        list_items.append({"type": 219, "groupName": group_name})
    elif action == "add_friend_by_phone":
        phone = str(payload.get("phone") or "").strip()
        if not phone:
            raise HTTPException(status_code=400, detail="phone 不能为空")
        friend: Dict[str, Any] = {"phone": phone}
        if payload.get("mark_name"):
            friend["markName"] = str(payload.get("mark_name")).strip()
        if payload.get("mark_extra"):
            friend["markExtra"] = str(payload.get("mark_extra")).strip()
        tags = _normalize_str_list(payload.get("friend_tag_list") or [])
        if tags:
            friend["tagList"] = tags
        if payload.get("leaving_msg"):
            friend["leavingMsg"] = str(payload.get("leaving_msg")).strip()
        list_items.append({"type": 213, "friend": friend})
    elif action == "clear_wework_storage":
        list_items.append({"type": 237})
    else:
        raise HTTPException(status_code=400, detail="暂不支持的 action")

    send_res = await _send_raw_message_batch(robot_id, list_items)
    return {
        "ok": True,
        "robot_id": robot_id,
        "action": action,
        "resolved_target_count": len(_normalize_str_list(target_names)),
        **send_res,
    }


def _ensure_worktool_ok(data: Optional[Dict[str, Any]], action: str) -> None:
    code = str((data or {}).get("code", ""))
    if code in {"", "0", "200"}:
        return
    msg = (data or {}).get("message") or (data or {}).get("msg") or "unknown"
    raise HTTPException(status_code=400, detail=f"{action}失败：{msg} (code={code})")


def _is_valid_ip(value: str) -> bool:
    try:
        ipaddress.ip_address((value or "").strip())
        return True
    except Exception:
        return False


def _to_ip_list(value: Any) -> List[str]:
    if isinstance(value, list):
        items = value
    elif isinstance(value, str):
        items = re.split(r"[\s,，;；]+", value)
    else:
        items = []
    out: List[str] = []
    for item in items:
        ip = str(item or "").strip()
        if not ip or not _is_valid_ip(ip):
            continue
        if ip not in out:
            out.append(ip)
    return out


async def bind_message_callback(robot_id: str, callback_url: str, reply_all: int = 1) -> Dict[str, Any]:
    url = f"{get_worktool_api_base()}/robot/robotInfo/update"
    timeout = aiohttp.ClientTimeout(total=10)
    payload = {
        "openCallback": 1,
        "replyAll": int(reply_all),
        "callbackUrl": callback_url,
    }
    logger.info("bind_message_callback request robot_id=%s url=%s payload=%s", robot_id, url, payload)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(url, params={"robotId": robot_id}, json=payload) as resp:
            data = await resp.json(content_type=None)
            if resp.status != 200:
                raise HTTPException(status_code=502, detail=f"绑定失败：HTTP {resp.status}")
            if not isinstance(data, dict):
                raise HTTPException(status_code=502, detail="绑定失败：响应格式异常")
            code = str(data.get("code", ""))
            if code not in {"0", "200", ""}:
                msg = data.get("msg") or data.get("message") or "unknown"
                raise HTTPException(status_code=400, detail=f"绑定失败：{msg} (code={code})")
            return data


async def bind_callback_by_type(robot_id: str, callback_url: str, callback_type: int) -> Dict[str, Any]:
    url = f"{get_worktool_api_base()}/robot/robotInfo/callBack/bind"
    timeout = aiohttp.ClientTimeout(total=10)
    payload = {"type": int(callback_type), "callBackUrl": callback_url}
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(url, params={"robotId": robot_id}, json=payload) as resp:
            data = await resp.json(content_type=None)
            if resp.status != 200:
                raise HTTPException(status_code=502, detail=f"绑定失败：HTTP {resp.status}")
            if not isinstance(data, dict):
                raise HTTPException(status_code=502, detail="绑定失败：响应格式异常")
            code = str(data.get("code", ""))
            if code not in {"0", "200", ""}:
                msg = data.get("msg") or data.get("message") or "unknown"
                raise HTTPException(status_code=400, detail=f"绑定失败：{msg} (code={code})")
            return data


async def delete_callback_by_type(robot_id: str, callback_type: int) -> Dict[str, Any]:
    url = f"{get_worktool_api_base()}/robot/robotInfo/callBack/deleteByType"
    timeout = aiohttp.ClientTimeout(total=10)
    payload = {"type": int(callback_type)}
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(url, params={"robotId": robot_id}, json=payload) as resp:
            data = await resp.json(content_type=None)
            if resp.status != 200:
                raise HTTPException(status_code=502, detail=f"删除回调失败：HTTP {resp.status}")
            if not isinstance(data, dict):
                raise HTTPException(status_code=502, detail="删除回调失败：响应格式异常")
            code = str(data.get("code", ""))
            if code not in {"0", "200", ""}:
                msg = data.get("msg") or data.get("message") or "unknown"
                raise HTTPException(status_code=400, detail=f"删除回调失败：{msg} (code={code})")
            return data


def _extract_callback_url(item: Any) -> str:
    if not isinstance(item, dict):
        return ""
    for key in ("callBackUrl", "callbackUrl", "url"):
        v = item.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _flatten_callback_items(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        rows: List[Dict[str, Any]] = []
        for k in ("list", "items", "records", "data"):
            v = payload.get(k)
            if isinstance(v, list):
                rows.extend([x for x in v if isinstance(x, dict)])
        if _extract_callback_url(payload):
            rows.append(payload)
        return rows
    return []


async def get_bound_message_callback_url(robot_id: str) -> str:
    res = await fetch_worktool_api("/robot/robotInfo/callBack/get", {"robotId": robot_id})
    rows = _flatten_callback_items(res.get("data"))
    if not rows:
        rows = _flatten_callback_items(res)

    # type=11 代表消息回调，优先读取它。
    for row in rows:
        try:
            callback_type = int(row.get("type"))
        except Exception:
            continue
        if callback_type == 11:
            url = _extract_callback_url(row)
            if url:
                return url
    return ""


async def ensure_default_message_callback(robot_id: str, default_callback_url: str, auto_bind_enabled: bool) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "callback_status": "disabled",
        "auto_bind_message_callback": False,
        "callback_url": "",
        "existing_message_callback_url": "",
    }
    if not auto_bind_enabled:
        result["callback_status"] = "disabled"
        return result
    if not default_callback_url:
        result["callback_status"] = "no_default_url"
        return result

    try:
        existing_url = await get_bound_message_callback_url(robot_id)
    except Exception as e:
        logger.warning("read message callback failed robot_id=%s err=%s", robot_id, e)
        existing_url = ""

    if existing_url:
        result["callback_status"] = "already_bound"
        result["existing_message_callback_url"] = existing_url
        return result

    try:
        await bind_message_callback(robot_id, default_callback_url, 1)
        result["callback_status"] = "bound"
        result["auto_bind_message_callback"] = True
        result["callback_url"] = default_callback_url
        return result
    except Exception as e:
        logger.warning("auto bind message callback failed robot_id=%s err=%s", robot_id, e)
        result["callback_status"] = "bind_failed"
        return result


def _scene_from_room_type(room_type: int) -> str:
    return "group" if int(room_type or 0) in {1, 3} else "private"


def _pick_inbound_text(req: QARequest) -> str:
    return (req.rawSpoken or req.spoken or "").strip()


def _image_data_url_from_base64(raw_base64: str) -> str:
    data = str(raw_base64 or "").strip()
    if not data:
        return ""
    if data.startswith("data:image/"):
        return data
    return f"data:image/jpeg;base64,{data}"


def _build_provider_current_asker_text(req: QARequest, scene: str) -> str:
    sender = (req.receivedName or "").strip() or "未知用户"
    if scene == "group":
        group_name = (req.groupName or "").strip() or "未知群"
        return f"当前提问的是群[{group_name}]中的[{sender}]"
    return f"当前提问的是[{sender}]"


def _build_provider_system_prompt(robot_display_name: str, colleague_names: List[str], current_asker_text: str) -> str:
    colleagues = [str(x or "").strip() for x in colleague_names if str(x or "").strip()]
    robot_name = str(robot_display_name or "").strip() or "机器人"
    lines: List[str] = [f"你是[{robot_name}]"]
    if colleagues:
        colleague_text = "，".join(colleagues)
        lines.append(f"这些人是你的同事：[{colleague_text}]")
    lines.append(current_asker_text)
    return "\n".join(lines)


def _build_provider_prompt_inject(robot_display_name: str, colleague_names: List[str], current_asker_text: str) -> str:
    return f"---\n{_build_provider_system_prompt(robot_display_name, colleague_names, current_asker_text)}\n---"


def _short_text(s: str, n: int = 120) -> str:
    x = (s or "").replace("\n", "\\n").strip()
    return x if len(x) <= n else f"{x[:n]}..."


def _public_local_message_id(row_id: Any) -> str:
    rid = str(row_id or "").strip()
    if not rid:
        return "local-unknown"
    pepper = AUTH_JWT_SECRET or "local-message-id-pepper"
    digest = hashlib.sha256(f"{rid}|{pepper}".encode("utf-8")).hexdigest()[:16]
    return f"local-{digest}"


def _rule_match_target(scene: str, req: QARequest) -> str:
    if scene == "group":
        return ((req.groupName or "").strip() or (req.receivedName or "").strip())
    return (req.receivedName or "").strip()


def _first_non_empty_name(*values: Any) -> str:
    for v in values:
        s = str(v or "").strip()
        if s:
            return s
    return ""


def _resolve_callback_group_name(req: QARequest, raw_payload: Dict[str, Any]) -> str:
    return _first_non_empty_name(
        getattr(req, "groupRemark", None),
        raw_payload.get("groupRemark"),
        raw_payload.get("group_remark"),
        raw_payload.get("roomRemark"),
        raw_payload.get("room_remark"),
        req.groupName,
        raw_payload.get("groupName"),
        raw_payload.get("group_name"),
        raw_payload.get("roomName"),
        raw_payload.get("room_name"),
    )


def _resolve_callback_received_name(req: QARequest, raw_payload: Dict[str, Any]) -> str:
    friend = raw_payload.get("friend") if isinstance(raw_payload.get("friend"), dict) else {}
    return _first_non_empty_name(
        getattr(req, "receivedRemark", None),
        raw_payload.get("receivedRemark"),
        raw_payload.get("received_remark"),
        raw_payload.get("friendRemark"),
        raw_payload.get("friend_remark"),
        raw_payload.get("remarkName"),
        raw_payload.get("remark_name"),
        raw_payload.get("markName"),
        raw_payload.get("mark_name"),
        raw_payload.get("senderRemark"),
        raw_payload.get("sender_remark"),
        friend.get("markName") if isinstance(friend, dict) else None,
        friend.get("remarkName") if isinstance(friend, dict) else None,
        req.receivedName,
        raw_payload.get("receivedName"),
        raw_payload.get("received_name"),
        raw_payload.get("senderName"),
        raw_payload.get("sender_name"),
    )


def _pick_message_id(req: QARequest) -> str:
    return (req.messageId or req.msgId or "").strip()


def _build_context_session_key(scene: str, req: QARequest) -> str:
    if scene == "group":
        g = (req.groupName or "").strip()
        if g:
            return f"group:{g}"
    sender = (req.receivedName or "").strip()
    if sender:
        return f"private:{sender}"
    return ""


def _append_chat_context_message(
    robot_pk: int,
    scene: str,
    session_key: str,
    role: str,
    content: str,
    sender_name: Optional[str] = None,
    message_id: Optional[str] = None,
) -> None:
    if not CHAT_CONTEXT_ENABLED:
        return
    normalized_scene = (scene or "").strip().lower()
    if normalized_scene not in {"group", "private"}:
        return
    normalized_role = (role or "").strip().lower()
    if normalized_role not in {"user", "assistant"}:
        return
    sk = (session_key or "").strip()
    text = (content or "").strip()
    if not sk or not text:
        return
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO chat_context_logs(robot_pk,scene,session_key,role,sender_name,content,message_id)
                VALUES(%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    int(robot_pk),
                    normalized_scene,
                    sk[:512],
                    normalized_role,
                    ((sender_name or "").strip()[:255] or None),
                    text[:4000],
                    ((message_id or "").strip()[:255] or None),
                ),
            )
            max_keep = max(int(CHAT_CONTEXT_MAX_MESSAGES), 1)
            # Keep only the most recent N records per session.
            cur.execute(
                """
                DELETE FROM chat_context_logs
                WHERE robot_pk=%s AND scene=%s AND session_key=%s
                  AND id NOT IN (
                    SELECT id FROM (
                      SELECT id
                      FROM chat_context_logs
                      WHERE robot_pk=%s AND scene=%s AND session_key=%s
                      ORDER BY id DESC
                      LIMIT %s
                    ) t
                  )
                """,
                (int(robot_pk), normalized_scene, sk, int(robot_pk), normalized_scene, sk, max_keep),
            )
        conn.commit()
    except Exception as e:
        logger.warning(
            "chat_context_append_failed robot_pk=%s scene=%s session=%s err=%s",
            robot_pk,
            normalized_scene,
            _short_text(sk, 120),
            str(e),
        )
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        conn.close()


def _load_chat_context_messages(robot_pk: int, scene: str, session_key: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    if not CHAT_CONTEXT_ENABLED:
        return []
    normalized_scene = (scene or "").strip().lower()
    if normalized_scene not in {"group", "private"}:
        return []
    sk = (session_key or "").strip()
    if not sk:
        return []
    max_items = max(int(limit or CHAT_CONTEXT_MAX_MESSAGES), 1)
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT role,content,sender_name
                FROM chat_context_logs
                WHERE robot_pk=%s AND scene=%s AND session_key=%s
                ORDER BY id DESC
                LIMIT %s
                """,
                (int(robot_pk), normalized_scene, sk, max_items),
            )
            rows = cur.fetchall() or []
            rows.reverse()
            result: List[Dict[str, Any]] = []
            for row in rows:
                role = str(row.get("role") or "").strip().lower()
                content = (row.get("content") or "").strip()
                if role not in {"user", "assistant"} or not content:
                    continue
                result.append(
                    {
                        "role": role,
                        "content": content,
                        "sender_name": (row.get("sender_name") or "").strip(),
                    }
                )
            return result
    except Exception as e:
        logger.warning(
            "chat_context_load_failed robot_pk=%s scene=%s session=%s err=%s",
            robot_pk,
            normalized_scene,
            _short_text(sk, 120),
            str(e),
        )
        return []
    finally:
        conn.close()


def _compact_group_context_messages_for_current_sender(
    messages: List[Dict[str, Any]],
    current_sender_name: str,
) -> List[Dict[str, Any]]:
    if not messages:
        return []
    sender_key = _normalize_name_key(current_sender_name)
    if not sender_key:
        return messages
    last_assistant_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        if str(messages[i].get("role") or "").strip().lower() == "assistant":
            last_assistant_idx = i
            break
    prefix = messages[: last_assistant_idx + 1]
    tail = messages[last_assistant_idx + 1 :]
    if not tail:
        return messages
    filtered_tail: List[Dict[str, Any]] = []
    for item in tail:
        role = str(item.get("role") or "").strip().lower()
        if role != "user":
            filtered_tail.append(item)
            continue
        item_sender_key = _normalize_name_key(item.get("sender_name"))
        if item_sender_key == sender_key:
            filtered_tail.append(item)
    # If all pending user turns are filtered out (should be rare), keep the latest turn.
    if not filtered_tail:
        filtered_tail.append(tail[-1])
    return prefix + filtered_tail


async def _run_chat_context_cleanup_if_needed() -> None:
    if not CHAT_CONTEXT_ENABLED:
        return
    key = "chat_context_cleanup_last_run_at"
    now = datetime.utcnow()
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT `value` FROM app_settings WHERE `key`=%s LIMIT 1", (key,))
            row = cur.fetchone() or {}
            last_raw = str(row.get("value") or "").strip()
            if last_raw:
                last_dt = _parse_datetime_or_none(last_raw, raise_on_invalid=False)
                if last_dt and (now - last_dt) < timedelta(hours=12):
                    return
            cur.execute(
                "DELETE FROM chat_context_logs WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL %s DAY)",
                (int(CHAT_CONTEXT_RETENTION_DAYS),),
            )
            cur.execute(
                """
                INSERT INTO app_settings(`key`,`value`) VALUES(%s,%s)
                ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), updated_at=CURRENT_TIMESTAMP
                """,
                (key, now.replace(microsecond=0).isoformat()),
            )
        conn.commit()
    except Exception as e:
        logger.warning("chat_context_cleanup_failed err=%s", str(e))
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        conn.close()


def _normalize_match_pattern(raw_pattern: str) -> str:
    pattern = (raw_pattern or "").strip()
    if not pattern:
        return ""
    # Keep anchored patterns as advanced/exact regex mode.
    if pattern.startswith("^") or pattern.endswith("$"):
        return pattern
    if pattern in {".*", ".*?"}:
        return ".*"
    core = pattern
    changed = True
    while changed and core:
        changed = False
        for prefix in (".*?", ".*"):
            if core.startswith(prefix):
                core = core[len(prefix):]
                changed = True
        for suffix in (".*?", ".*"):
            if core.endswith(suffix):
                core = core[: -len(suffix)]
                changed = True
    if not core:
        return ".*"
    return f".*{re.escape(core)}.*"


def _pattern_matches(raw_pattern: str, text: str) -> bool:
    pattern = _normalize_match_pattern(raw_pattern)
    if not pattern:
        return False
    try:
        return bool(re.search(pattern, text or ""))
    except re.error:
        return False


def _match_with_mode(match_type: str, pattern: str, text: str) -> bool:
    mt = (match_type or "regex").strip().lower()
    if mt == "all":
        return True
    if mt == "exact":
        p = (pattern or "").strip()
        if not p:
            return False
        return (text or "").strip() == p
    return _pattern_matches(pattern, text)


def _mode_rank(match_type: str) -> int:
    mt = (match_type or "regex").strip().lower()
    if mt == "exact":
        return 0
    if mt == "regex":
        return 1
    return 2


def _forward_source_name(scene: str, req: QARequest) -> str:
    if scene == "group":
        return (req.groupName or "").strip()
    return (req.receivedName or "").strip()


def _build_forward_prefix(rule: Dict[str, Any], scene: str, req: QARequest) -> str:
    if not bool(rule.get("prefix_enabled")):
        return ""
    tpl = str(rule.get("prefix_template") or "").strip()
    if not tpl:
        if scene == "group":
            tpl = "[转发自群:{group_name} 提问者:{sender_name}] "
        else:
            tpl = "[转发自:{sender_name}] "
    group_name = (req.groupName or "").strip()
    sender_name = (req.receivedName or "").strip()
    source_name = _forward_source_name(scene, req)
    return (
        tpl.replace("{group_name}", group_name)
        .replace("{sender_name}", sender_name)
        .replace("{source_name}", source_name)
    )


def _insert_forward_log(
    rule_id: int,
    source_robot_pk: int,
    send_robot_pk: int,
    source_scene: str,
    source_name: str,
    sender_name: str,
    target_name: str,
    message_id: str,
    question_text: str,
    forwarded_text: str,
    status: str,
    error_reason: str = "",
    time_cost: Optional[float] = None,
) -> None:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO forward_logs(
                  rule_id,source_robot_pk,send_robot_pk,source_scene,source_name,sender_name,target_name,
                  message_id,question_text,forwarded_text,status,error_reason,time_cost
                )
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    int(rule_id),
                    int(source_robot_pk),
                    int(send_robot_pk),
                    source_scene,
                    source_name[:255],
                    sender_name[:255],
                    target_name[:255],
                    (message_id or "")[:255],
                    (question_text or "")[:4000],
                    (forwarded_text or "")[:4000],
                    status,
                    (error_reason or "")[:512],
                    None if time_cost is None else round(float(time_cost), 3),
                ),
            )
        conn.commit()
    except Exception as e:
        logger.warning("forward_log_insert_failed rule_id=%s err=%s", rule_id, str(e))
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        conn.close()


def _load_enabled_forward_rules(source_robot_pk: int, scene: str) -> List[Dict[str, Any]]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT fr.*,sr.robot_id AS send_robot_id
                FROM forward_rules fr
                LEFT JOIN robots sr ON sr.id=fr.send_robot_pk
                WHERE fr.source_robot_pk=%s AND fr.source_scene=%s AND fr.enabled=1
                ORDER BY fr.id ASC
                """,
                (int(source_robot_pk), scene),
            )
            return cur.fetchall() or []
    finally:
        conn.close()


async def _run_forwarding_for_callback(robot: Dict[str, Any], scene: str, req: QARequest, inbound_text: str) -> None:
    # v1: only text messages are forwarded.
    if int(req.textType or 0) != 1:
        return
    source_robot_pk = int(robot["id"])
    source_robot_id = str(robot.get("robot_id") or "")
    source_name = _forward_source_name(scene, req)
    sender_name = (req.receivedName or "").strip()
    message_id = _pick_message_id(req)
    rules = _load_enabled_forward_rules(source_robot_pk, scene)
    for rule in rules:
        rule_id = int(rule.get("id") or 0)
        source_match_type = str(rule.get("source_match_type") or "all")
        source_pattern = str(rule.get("source_pattern") or "")
        if not _match_with_mode(source_match_type, source_pattern, source_name):
            continue
        keyword_match_type = str(rule.get("keyword_match_type") or "all")
        keyword_pattern = str(rule.get("keyword_pattern") or "")
        if not _match_with_mode(keyword_match_type, keyword_pattern, inbound_text):
            continue
        send_robot_id = source_robot_id
        send_robot_pk = source_robot_pk
        if bool(rule.get("use_other_robot")) and rule.get("send_robot_id"):
            send_robot_id = str(rule.get("send_robot_id") or "").strip() or source_robot_id
            send_robot_pk = int(rule.get("send_robot_pk") or source_robot_pk)
        target_name = str(rule.get("target_name") or "").strip()
        if not target_name:
            _insert_forward_log(
                rule_id=rule_id,
                source_robot_pk=source_robot_pk,
                send_robot_pk=send_robot_pk,
                source_scene=scene,
                source_name=source_name,
                sender_name=sender_name,
                target_name="",
                message_id=message_id,
                question_text=inbound_text,
                forwarded_text="",
                status="skipped",
                error_reason="target_name empty",
                time_cost=0,
            )
            continue
        prefix = _build_forward_prefix(rule, scene, req)
        forwarded_text = f"{prefix}{inbound_text}"
        started = time.perf_counter()
        try:
            await _send_worktool_text_to_target(send_robot_id, target_name, forwarded_text)
            _insert_forward_log(
                rule_id=rule_id,
                source_robot_pk=source_robot_pk,
                send_robot_pk=send_robot_pk,
                source_scene=scene,
                source_name=source_name,
                sender_name=sender_name,
                target_name=target_name,
                message_id=message_id,
                question_text=inbound_text,
                forwarded_text=forwarded_text,
                status="success",
                time_cost=time.perf_counter() - started,
            )
        except Exception as e:
            logger.warning(
                "forward_send_failed rule_id=%s source_robot=%s send_robot=%s target=%s err=%s",
                rule_id,
                source_robot_id,
                send_robot_id,
                target_name,
                str(e),
            )
            _insert_forward_log(
                rule_id=rule_id,
                source_robot_pk=source_robot_pk,
                send_robot_pk=send_robot_pk,
                source_scene=scene,
                source_name=source_name,
                sender_name=sender_name,
                target_name=target_name,
                message_id=message_id,
                question_text=inbound_text,
                forwarded_text=forwarded_text,
                status="failed",
                error_reason=str(e),
                time_cost=time.perf_counter() - started,
            )


def _insert_message_log(robot_pk: int, direction: str, scene: str, content: str, status: str) -> None:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO message_logs(robot_pk,direction,scene,normalized_content,status)
                VALUES(%s,%s,%s,%s,%s)
                """,
                (robot_pk, direction, scene, (content or "")[:4000], status),
            )
        conn.commit()
    finally:
        conn.close()


def _insert_qa_monitor_log(robot_pk: int, req: QARequest, question: str, callback_url: str) -> int:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO qa_monitor_logs(
                  robot_pk,room_type,text_type,at_me,group_name,received_name,question,answer,message_id,callback_url,status,time_cost
                )
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'received',NULL)
                """,
                (
                    robot_pk,
                    int(req.roomType or 0),
                    int(req.textType or 1),
                    1 if bool(req.atMe) else 0,
                    (req.groupName or "").strip() or None,
                    (req.receivedName or "").strip() or None,
                    (question or "")[:4000],
                    "",
                    _pick_message_id(req) or None,
                    callback_url or None,
                ),
            )
            row_id = int(cur.lastrowid)
        conn.commit()
        return row_id
    except Exception as e:
        logger.warning("qa_monitor_log_insert_failed robot_pk=%s err=%s", robot_pk, str(e))
        try:
            conn.rollback()
        except Exception:
            pass
        return 0
    finally:
        conn.close()


def _is_duplicate_qa_callback(robot_pk: int, req: QARequest, question: str, window_seconds: int = 8) -> bool:
    room_type = int(req.roomType or 0)
    text_type = int(req.textType or 1)
    received_name = (req.receivedName or "").strip()
    group_name = (req.groupName or "").strip()
    message_id = _pick_message_id(req)
    question = (question or "").strip()
    if not question:
        return False
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            # Priority 1: strong de-dup by message_id when available.
            if message_id:
                cur.execute(
                    """
                    SELECT id
                    FROM qa_monitor_logs
                    WHERE robot_pk=%s
                      AND COALESCE(message_id,'')=%s
                      AND created_at >= DATE_SUB(NOW(), INTERVAL 120 SECOND)
                    ORDER BY id DESC LIMIT 1
                    """,
                    (int(robot_pk), message_id),
                )
                if cur.fetchone():
                    return True

                # Some callbacks arrive first without message_id then with message_id seconds later.
                cur.execute(
                    """
                    SELECT id
                    FROM qa_monitor_logs
                    WHERE robot_pk=%s
                      AND room_type=%s
                      AND COALESCE(received_name,'')=%s
                      AND COALESCE(group_name,'')=%s
                      AND question=%s
                      AND COALESCE(message_id,'')=''
                      AND created_at >= DATE_SUB(NOW(), INTERVAL %s SECOND)
                    ORDER BY id DESC LIMIT 1
                    """,
                    (
                        int(robot_pk),
                        room_type,
                        received_name,
                        group_name,
                        question,
                        max(int(window_seconds), 1),
                    ),
                )
                if cur.fetchone():
                    return True

            params: List[Any] = [
                int(robot_pk),
                room_type,
                text_type,
                received_name,
                group_name,
                question,
                max(int(window_seconds), 1),
            ]
            sql = (
                """
                SELECT id
                FROM qa_monitor_logs
                WHERE robot_pk=%s
                  AND room_type=%s
                  AND text_type=%s
                  AND COALESCE(received_name,'')=%s
                  AND COALESCE(group_name,'')=%s
                  AND question=%s
                  AND created_at >= DATE_SUB(NOW(), INTERVAL %s SECOND)
                """
            )
            sql += " ORDER BY id DESC LIMIT 1"
            cur.execute(sql, tuple(params))
            return cur.fetchone() is not None
    except Exception as e:
        logger.warning("qa_callback_duplicate_check_failed robot_pk=%s err=%s", robot_pk, str(e))
        return False
    finally:
        conn.close()


def _update_qa_monitor_log(
    row_id: Optional[int],
    answer: str,
    status: str,
    time_cost: Optional[float] = None,
    provider_name: Optional[str] = None,
    ai_decision_reply: Optional[bool] = None,
) -> None:
    if not row_id:
        return
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            updates = ["answer=%s", "status=%s", "time_cost=%s"]
            params: List[Any] = [((answer or "")[:4000]), status, None if time_cost is None else round(float(time_cost), 3)]
            if provider_name is not None:
                updates.append("provider_name=%s")
                params.append((provider_name or "").strip()[:255] or None)
            if ai_decision_reply is not None:
                updates.append("ai_decision_reply=%s")
                params.append(1 if ai_decision_reply else 0)
            params.append(int(row_id))
            cur.execute(f"UPDATE qa_monitor_logs SET {', '.join(updates)} WHERE id=%s", tuple(params))
        conn.commit()
    except Exception as e:
        logger.warning("qa_monitor_log_update_failed row_id=%s err=%s", row_id, str(e))
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        conn.close()


def _load_default_reply(robot_pk: int, scene: str) -> str:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT reply_text FROM default_replies WHERE robot_pk=%s AND scene=%s LIMIT 1",
                (robot_pk, scene),
            )
            row = cur.fetchone()
            return ((row or {}).get("reply_text") or "").strip()
    finally:
        conn.close()


def _load_provider_for_decision(provider_id: int) -> Optional[Dict[str, Any]]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM ai_providers WHERE id=%s AND enabled=1 LIMIT 1", (int(provider_id),))
            row = cur.fetchone()
            return row if isinstance(row, dict) else None
    finally:
        conn.close()


def _load_group_recent_context(robot_pk: int, group_name: str, limit: int = 8) -> List[Dict[str, Any]]:
    g = (group_name or "").strip()
    if not g:
        return []
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT received_name,question,answer,created_at
                FROM qa_monitor_logs
                WHERE robot_pk=%s AND room_type IN (1,3) AND COALESCE(group_name,'')=%s
                ORDER BY id DESC
                LIMIT %s
                """,
                (int(robot_pk), g, max(int(limit), 1)),
            )
            rows = cur.fetchall() or []
            rows.reverse()
            return rows
    finally:
        conn.close()


async def _should_reply_group_by_ai_decision(
    robot: Dict[str, Any],
    req: QARequest,
    inbound_text: str,
) -> bool:
    provider_id = robot.get("group_decision_provider_id")
    if provider_id is None:
        logger.warning("group_ai_decide_skipped robot_id=%s reason=missing_provider_id", robot.get("robot_id"))
        return False
    provider = _load_provider_for_decision(int(provider_id))
    if not provider:
        logger.warning(
            "group_ai_decide_skipped robot_id=%s provider_id=%s reason=provider_not_found_or_disabled",
            robot.get("robot_id"),
            provider_id,
        )
        return False

    history_rows = _load_group_recent_context(int(robot["id"]), (req.groupName or "").strip(), 8)
    history_lines: List[str] = []
    for row in history_rows:
        sender = (row.get("received_name") or "").strip() or "未知用户"
        question = (row.get("question") or "").strip()
        answer = (row.get("answer") or "").strip()
        if question:
            history_lines.append(f"用户[{sender}]：{question}")
        if answer:
            history_lines.append(f"AI：{answer}")
    history_text = "\n".join(history_lines[-12:]) or "（无）"
    current_sender = (req.receivedName or "").strip() or "未知用户"
    template = str(robot.get("group_decision_prompt_template") or "").strip() or GROUP_DECISION_PROMPT_TEMPLATE_DEFAULT
    prompt = _render_group_decision_prompt_template(
        template,
        {
            "group_name": (req.groupName or "").strip(),
            "sender_name": current_sender,
            "last_message": (inbound_text or "").strip(),
            "recent_context": history_text,
        },
    )[:12000]
    decision_rule = {
        "id": -1,
        "provider_id": int(provider["id"]),
        "provider_name": provider.get("name") or "group_decision_provider",
        "base_url": provider.get("base_url") or "",
        "api_token": provider.get("api_token") or "",
        "model": provider.get("model") or "",
        "provider_type": provider.get("provider_type") or "openai",
        "auth_scheme": provider.get("auth_scheme") or "bearer",
        "extra_json": provider.get("extra_json"),
    }
    try:
        text = await _call_provider(decision_rule, prompt)
    except Exception as e:
        logger.warning(
            "group_ai_decide_failed robot_id=%s provider_id=%s err=%s",
            robot.get("robot_id"),
            provider_id,
            str(e),
        )
        return False
    token = (text or "").strip().upper()
    decision = token.startswith("YES") or token.startswith("A")
    logger.info(
        "group_ai_decide_result robot_id=%s provider_id=%s sender=%s decision=%s raw=%s",
        robot.get("robot_id"),
        provider_id,
        current_sender,
        decision,
        _short_text(token, 24),
    )
    return decision


def _load_enabled_rules(robot_pk: int, scene: str) -> List[Dict[str, Any]]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.id,r.pattern_match_type,r.pattern,r.content_match_type,r.content_pattern,r.priority,r.provider_id,p.name AS provider_name,p.base_url,p.api_token,p.model,p.provider_type,p.auth_scheme,p.extra_json,p.system_prompt_template,p.include_asker_info,p.asker_info_mode
                FROM routing_rules r
                JOIN ai_providers p ON p.id=r.provider_id
                WHERE r.robot_pk=%s AND r.scene=%s AND r.enabled=1 AND p.enabled=1
                ORDER BY r.priority ASC, r.id ASC
                """,
                (robot_pk, scene),
            )
            return cur.fetchall() or []
    finally:
        conn.close()


def _extract_provider_text(data: Any) -> str:
    if isinstance(data, dict):
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            msg = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(msg, dict):
                content = msg.get("content")
                if isinstance(content, str):
                    return content.strip()
                if isinstance(content, list):
                    texts: List[str] = []
                    for x in content:
                        if isinstance(x, dict) and isinstance(x.get("text"), str):
                            texts.append(x["text"])
                    return "".join(texts).strip()
        for key in ("answer", "content", "message", "text"):
            v = data.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    if isinstance(data, str):
        return data.strip()
    return ""


def _build_provider_http_request(rule: Dict[str, Any], prompt: str, payload_extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    auth_scheme = str(rule.get("auth_scheme") or "bearer")
    api_token = str(rule.get("api_token") or "")
    if auth_scheme == "bearer" and api_token:
        headers["Authorization"] = f"Bearer {api_token}"
    elif auth_scheme == "x-openclaw-token" and api_token:
        headers["x-openclaw-token"] = api_token

    payload: Dict[str, Any] = {"messages": [{"role": "user", "content": prompt}]}
    model = (rule.get("model") or "").strip() if isinstance(rule.get("model"), str) else ""
    if model:
        payload["model"] = model

    extra_json = rule.get("extra_json")
    if isinstance(extra_json, str) and extra_json.strip():
        try:
            extra_json = json.loads(extra_json)
        except Exception:
            extra_json = None
    if isinstance(extra_json, dict):
        req_headers = extra_json.get("request_headers")
        if isinstance(req_headers, dict):
            for k, v in req_headers.items():
                if isinstance(k, str) and isinstance(v, str):
                    headers[k] = v
        req_body = extra_json.get("request_body")
        if isinstance(req_body, dict):
            payload.update(req_body)

    if isinstance(payload_extra, dict):
        for k, v in payload_extra.items():
            if k == "variables" and isinstance(v, dict) and isinstance(payload.get("variables"), dict):
                merged_vars = dict(payload.get("variables") or {})
                merged_vars.update(v)
                payload["variables"] = merged_vars
                continue
            payload[k] = v

    url = str(rule.get("base_url") or "").strip()
    if not url:
        raise HTTPException(status_code=500, detail="provider base_url empty")
    return {"url": url, "headers": headers, "payload": payload, "auth_scheme": auth_scheme}


def _build_request_curl(method: str, url: str, headers: Dict[str, Any], body: Any) -> str:
    parts: List[str] = ["curl", "-X", method.upper(), shlex.quote(url)]
    for k, v in headers.items():
        parts.extend(["-H", shlex.quote(f"{k}: {v}")])
    if body is not None:
        raw = json.dumps(body, ensure_ascii=False)
        parts.extend(["--data-raw", shlex.quote(raw)])
    return " ".join(parts)


async def _call_provider(rule: Dict[str, Any], prompt: str, payload_extra: Optional[Dict[str, Any]] = None) -> str:
    req_cfg = _build_provider_http_request(rule, prompt, payload_extra)
    headers = req_cfg["headers"]
    payload = req_cfg["payload"]
    url = req_cfg["url"]
    auth_scheme = req_cfg["auth_scheme"]

    timeout = aiohttp.ClientTimeout(total=AI_PROVIDER_TIMEOUT_SECONDS)
    started = time.perf_counter()
    logger.info(
        "provider_request_start rule_id=%s provider_id=%s provider_name=%s url=%s auth_scheme=%s prompt=%s",
        rule.get("id"),
        rule.get("provider_id"),
        rule.get("provider_name"),
        url,
        auth_scheme,
        _short_text(prompt, 160),
    )
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(url, json=payload, headers=headers) as resp:
            raw = await resp.text()
            if resp.status >= 400:
                logger.warning(
                    "provider_request_http_error rule_id=%s provider_id=%s status=%s cost_ms=%s body=%s",
                    rule.get("id"),
                    rule.get("provider_id"),
                    resp.status,
                    int((time.perf_counter() - started) * 1000),
                    _short_text(raw, 300),
                )
                raise HTTPException(status_code=502, detail=f"provider upstream status={resp.status}")
            try:
                data = json.loads(raw) if raw else {}
            except Exception:
                data = raw
            text = _extract_provider_text(data)
            if not text:
                logger.warning(
                    "provider_request_empty_text rule_id=%s provider_id=%s cost_ms=%s body=%s",
                    rule.get("id"),
                    rule.get("provider_id"),
                    int((time.perf_counter() - started) * 1000),
                    _short_text(raw, 300),
                )
                raise HTTPException(status_code=502, detail="provider response has no text")
            logger.info(
                "provider_request_success rule_id=%s provider_id=%s cost_ms=%s reply=%s",
                rule.get("id"),
                rule.get("provider_id"),
                int((time.perf_counter() - started) * 1000),
                _short_text(text, 160),
            )
            return text


async def _call_openclaw_webhook(rule: Dict[str, Any], callback_payload: Dict[str, Any]) -> Dict[str, Any]:
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    auth_scheme = str(rule.get("auth_scheme") or "bearer")
    api_token = str(rule.get("api_token") or "")
    if auth_scheme == "bearer" and api_token:
        headers["Authorization"] = f"Bearer {api_token}"
    elif auth_scheme == "x-openclaw-token" and api_token:
        headers["x-openclaw-token"] = api_token

    url = str(rule.get("base_url") or "").strip()
    if not url:
        raise HTTPException(status_code=500, detail="provider base_url empty")

    timeout = aiohttp.ClientTimeout(total=AI_PROVIDER_TIMEOUT_SECONDS)
    started = time.perf_counter()
    logger.info(
        "openclaw_webhook_start rule_id=%s provider_id=%s provider_name=%s url=%s auth_scheme=%s payload=%s",
        rule.get("id"),
        rule.get("provider_id"),
        rule.get("provider_name"),
        url,
        auth_scheme,
        _short_text(json.dumps(callback_payload, ensure_ascii=False), 300),
    )
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(url, json=callback_payload, headers=headers) as resp:
            raw = await resp.text()
            if resp.status >= 400:
                logger.warning(
                    "openclaw_webhook_http_error rule_id=%s provider_id=%s status=%s cost_ms=%s body=%s",
                    rule.get("id"),
                    rule.get("provider_id"),
                    resp.status,
                    int((time.perf_counter() - started) * 1000),
                    _short_text(raw, 300),
                )
                raise HTTPException(status_code=502, detail=f"openclaw webhook status={resp.status}")
            logger.info(
                "openclaw_webhook_success rule_id=%s provider_id=%s cost_ms=%s response=%s",
                rule.get("id"),
                rule.get("provider_id"),
                int((time.perf_counter() - started) * 1000),
                _short_text(raw, 200),
            )
            try:
                data = json.loads(raw) if raw else {}
                return data if isinstance(data, dict) else {"raw": raw}
            except Exception:
                return {"raw": raw}


async def _send_worktool_text_to_target(robot_id: str, target: str, text: str) -> Dict[str, Any]:
    if not target:
        raise HTTPException(status_code=400, detail="worktool target empty")
    url = f"{get_worktool_api_base()}/wework/sendRawMessage"
    payload = {
        "socketType": 2,
        "list": [
            {
                "type": 203,
                "titleList": [target],
                "receivedContent": text,
            }
        ],
    }
    started = time.perf_counter()
    logger.info(
        "worktool_send_start robot_id=%s target=%s text=%s",
        robot_id,
        _short_text(target, 80),
        _short_text(text, 160),
    )
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(url, params={"robotId": robot_id}, json=payload) as resp:
            raw = await resp.text()
            if resp.status >= 400:
                logger.warning(
                    "worktool_send_http_error robot_id=%s status=%s cost_ms=%s body=%s",
                    robot_id,
                    resp.status,
                    int((time.perf_counter() - started) * 1000),
                    _short_text(raw, 300),
                )
                raise HTTPException(status_code=502, detail=f"worktool sendRawMessage status={resp.status}")
            try:
                data = json.loads(raw) if raw else {}
            except Exception:
                data = {"raw": raw}
            code = str((data or {}).get("code", ""))
            if code not in {"0", "200", ""}:
                msg = (data or {}).get("message") or (data or {}).get("msg") or "unknown"
                logger.warning(
                    "worktool_send_business_error robot_id=%s code=%s cost_ms=%s msg=%s body=%s",
                    robot_id,
                    code,
                    int((time.perf_counter() - started) * 1000),
                    _short_text(str(msg), 160),
                    _short_text(raw, 300),
                )
                raise HTTPException(status_code=502, detail=f"worktool sendRawMessage failed: {msg} (code={code})")
            logger.info(
                "worktool_send_success robot_id=%s cost_ms=%s code=%s",
                robot_id,
                int((time.perf_counter() - started) * 1000),
                code or "0",
            )
            return data if isinstance(data, dict) else {"raw": raw}


async def _send_worktool_text(robot_id: str, scene: str, req: QARequest, text: str) -> Dict[str, Any]:
    target = _rule_match_target(scene, req)
    return await _send_worktool_text_to_target(robot_id, target, text)


# ----- lifecycle -----
@app.on_event("startup")
async def startup() -> None:
    global _qa_callback_queue, _qa_callback_worker_tasks
    init_db()
    try:
        await _run_chat_context_cleanup_if_needed()
    except Exception:
        pass
    _qa_callback_queue = asyncio.Queue(maxsize=QA_CALLBACK_QUEUE_MAXSIZE)
    _qa_callback_worker_tasks = [
        asyncio.create_task(_qa_callback_worker_loop(i + 1))
        for i in range(QA_CALLBACK_WORKER_CONCURRENCY)
    ]
    logger.info(
        "qa_callback_workers_started workers=%s queue_maxsize=%s",
        QA_CALLBACK_WORKER_CONCURRENCY,
        QA_CALLBACK_QUEUE_MAXSIZE,
    )
    logger.info("backend started")


@app.on_event("shutdown")
async def shutdown() -> None:
    global _qa_callback_queue, _qa_callback_worker_tasks
    tasks = list(_qa_callback_worker_tasks)
    _qa_callback_worker_tasks = []
    for t in tasks:
        t.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    _qa_callback_queue = None
    logger.info("qa_callback_workers_stopped")


# ----- auth -----
@app.post("/api/v1/auth/sms/send")
async def auth_sms_send(body: SmsSendRequest, request: Request) -> Dict[str, Any]:
    if not AUTH_SMS_ENABLED:
        raise HTTPException(status_code=404, detail="sms auth disabled")
    phone = (body.phone or "").strip()
    if not _is_valid_phone(phone):
        raise HTTPException(status_code=400, detail="手机号格式不合法")

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT created_at FROM sms_codes WHERE phone=%s AND scene=%s ORDER BY id DESC LIMIT 1",
                (phone, body.scene),
            )
            latest = cur.fetchone()
            if latest and isinstance(latest.get("created_at"), datetime):
                if (datetime.now() - latest["created_at"]).total_seconds() < 60:
                    raise HTTPException(status_code=429, detail="发送过于频繁，请稍后再试")

            cur.execute(
                """
                SELECT COUNT(1) AS c FROM sms_codes
                WHERE phone=%s AND scene=%s AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
                """,
                (phone, body.scene),
            )
            c = int((cur.fetchone() or {}).get("c") or 0)
            if c >= 5:
                raise HTTPException(status_code=429, detail="1小时内发送次数已达上限")

        code = f"{secrets.randbelow(1000000):06d}"
        content = f"{SMS_HUARUI_SIGN}您好，您的验证码是：{code}，该验证码{SMS_CODE_EXPIRE_MINUTES}分钟内有效，请勿泄露。"
        source_ip = (request.client.host if request.client else "") or ""

        upstream_error = ""
        sms_data: Dict[str, Any] = {}
        try:
            sms_data = await _send_sms_via_huarui(phone, content)
        except Exception as e:
            upstream_error = str(e)

        sms_ok = str(sms_data.get("code") or "") == "00000"
        sms_uid = str(sms_data.get("uid") or "-")
        result_json = json.dumps(sms_data if sms_data else {"error": upstream_error}, ensure_ascii=False)[:1024]

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO app_sms_record(account, source, source_ip, phone, sign, content, send_time, msgid, result)
                VALUES(%s,%s,%s,%s,%s,%s,NOW(),%s,%s)
                """,
                (SMS_HUARUI_APPKEY or "-", f"auth:{body.scene}", source_ip, phone, SMS_HUARUI_SIGN, content[:512], sms_uid, result_json),
            )
            if sms_ok:
                cur.execute(
                    """
                    INSERT INTO sms_codes(phone, scene, code_hash, expire_at, request_ip)
                    VALUES(%s,%s,%s,DATE_ADD(NOW(), INTERVAL %s MINUTE),%s)
                    """,
                    (phone, body.scene, _hash_sms_code(code), SMS_CODE_EXPIRE_MINUTES, source_ip),
                )
        conn.commit()
        if not sms_ok:
            raise HTTPException(status_code=502, detail="短信发送失败")
        return {"ok": True, "message": "验证码已发送"}
    finally:
        conn.close()


@app.post("/api/v1/auth/register")
async def auth_register(body: AuthRegisterRequest) -> Dict[str, Any]:
    phone = (body.phone or "").strip()
    code = (body.sms_code or "").strip()
    password = body.password or ""
    company_name = (body.company_name or "").strip() or None

    if not _is_valid_phone(phone):
        raise HTTPException(status_code=400, detail="手机号格式不合法")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="密码长度至少8位")
    if AUTH_SMS_ENABLED and not re.fullmatch(r"\d{6}", code):
        raise HTTPException(status_code=400, detail="验证码格式不合法")

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE phone=%s LIMIT 1", (phone,))
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="手机号已注册")

            if AUTH_SMS_ENABLED:
                ok = _consume_sms_code(cur, phone, "register", code)
                if not ok:
                    raise HTTPException(status_code=400, detail="验证码错误或已过期")

            cur.execute(
                "INSERT INTO users(phone,password_hash,company_name,token_version,is_active) VALUES(%s,%s,%s,0,1)",
                (phone, _hash_password(password), company_name),
            )
            user_id = int(cur.lastrowid)
        conn.commit()
    finally:
        conn.close()

    token = _create_access_token(user_id, 0)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in_days": AUTH_JWT_EXPIRE_DAYS,
        "user": {"id": user_id, "phone": phone, "company_name": company_name},
    }


@app.post("/api/v1/auth/login")
async def auth_login(body: AuthLoginRequest) -> Dict[str, Any]:
    phone = (body.phone or "").strip()
    password = body.password or ""
    if not _is_valid_phone(phone):
        raise HTTPException(status_code=400, detail="手机号格式不合法")

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id,phone,company_name,password_hash,token_version,is_active FROM users WHERE phone=%s LIMIT 1",
                (phone,),
            )
            user = cur.fetchone()
            if not user or int(user["is_active"]) != 1 or not _verify_password(password, str(user["password_hash"])):
                raise HTTPException(status_code=401, detail="手机号或密码错误")
            cur.execute("UPDATE users SET last_login_at=CURRENT_TIMESTAMP() WHERE id=%s", (int(user["id"]),))
        conn.commit()
        token = _create_access_token(int(user["id"]), int(user["token_version"]))
        return {
            "access_token": token,
            "token_type": "bearer",
            "expires_in_days": AUTH_JWT_EXPIRE_DAYS,
            "user": {
                "id": int(user["id"]),
                "phone": user["phone"],
                "company_name": user["company_name"],
                "is_admin": _is_admin_phone(str(user["phone"])),
            },
        }
    finally:
        conn.close()


@app.post("/api/v1/auth/password/reset")
async def auth_reset_password(body: AuthResetPasswordRequest) -> Dict[str, Any]:
    if not AUTH_SMS_ENABLED:
        raise HTTPException(status_code=404, detail="password reset disabled")
    phone = (body.phone or "").strip()
    code = (body.sms_code or "").strip()
    new_password = body.new_password or ""
    if not _is_valid_phone(phone):
        raise HTTPException(status_code=400, detail="手机号格式不合法")
    if not re.fullmatch(r"\d{6}", code):
        raise HTTPException(status_code=400, detail="验证码格式不合法")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="密码长度至少8位")

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE phone=%s LIMIT 1", (phone,))
            user = cur.fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="用户不存在")
            ok = _consume_sms_code(cur, phone, "reset_password", code)
            if not ok:
                raise HTTPException(status_code=400, detail="验证码错误或已过期")

            cur.execute(
                "UPDATE users SET password_hash=%s, token_version=token_version+1 WHERE id=%s",
                (_hash_password(new_password), int(user["id"])),
            )
        conn.commit()
        return {"ok": True, "message": "密码已重置"}
    finally:
        conn.close()


@app.post("/api/v1/auth/logout-all")
async def auth_logout_all(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET token_version=token_version+1 WHERE id=%s", (int(user["id"]),))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "message": "已退出所有设备"}


@app.get("/api/v1/auth/me")
async def auth_me(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    try:
        await _run_expiry_notice_scan_if_needed()
    except Exception:
        pass
    try:
        await _run_login_flap_notice_scan_for_user_if_needed(int(user["id"]))
    except Exception:
        pass
    try:
        await _run_chat_context_cleanup_if_needed()
    except Exception:
        pass
    return {
        "id": int(user["id"]),
        "phone": user["phone"],
        "company_name": user["company_name"],
        "is_active": bool(user["is_active"]),
        "is_admin": _is_admin_phone(str(user["phone"])),
        "last_login_at": str(user["last_login_at"]) if user.get("last_login_at") else None,
        "created_at": str(user["created_at"]),
        "updated_at": str(user["updated_at"]),
    }


@app.get("/api/v1/auth/config")
async def auth_config() -> Dict[str, Any]:
    return {
        "sms_auth_enabled": AUTH_SMS_ENABLED,
        "password_reset_enabled": AUTH_SMS_ENABLED,
    }


# ----- inbox -----
@app.get("/api/v1/inbox/unread-count")
async def inbox_unread_count(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(1) AS c
                FROM inbox_deliveries d
                JOIN inbox_messages m ON m.id=d.message_id
                WHERE d.user_id=%s AND d.is_read=0 AND m.status='published'
                  AND (m.expire_at IS NULL OR m.expire_at > UTC_TIMESTAMP())
                """,
                (int(user["id"]),),
            )
            c = int((cur.fetchone() or {}).get("c") or 0)
            return {"count": c}
    finally:
        conn.close()


@app.get("/api/v1/inbox/messages")
async def inbox_messages(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str = Query(default="all"),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    status_key = (status or "all").strip().lower()
    if status_key not in {"all", "read", "unread"}:
        raise HTTPException(status_code=400, detail="status must be all/read/unread")
    where = [
        "d.user_id=%s",
        "m.status='published'",
        "(m.expire_at IS NULL OR m.expire_at > UTC_TIMESTAMP())",
    ]
    params: List[Any] = [int(user["id"])]
    if status_key == "read":
        where.append("d.is_read=1")
    elif status_key == "unread":
        where.append("d.is_read=0")
    where_sql = " AND ".join(where)
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT COUNT(1) AS c
                FROM inbox_deliveries d
                JOIN inbox_messages m ON m.id=d.message_id
                WHERE {where_sql}
                """,
                tuple(params),
            )
            total = int((cur.fetchone() or {}).get("c") or 0)
            offset = (page - 1) * page_size
            cur.execute(
                f"""
                SELECT d.id AS delivery_id,d.is_read,d.read_at,d.delivered_at,
                       m.id AS message_id,m.category,m.level,m.title,m.content,m.publish_at,m.expire_at,m.created_at
                FROM inbox_deliveries d
                JOIN inbox_messages m ON m.id=d.message_id
                WHERE {where_sql}
                ORDER BY d.delivered_at DESC, d.id DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [page_size, offset]),
            )
            rows = cur.fetchall() or []
            items = [
                {
                    "delivery_id": int(x["delivery_id"]),
                    "message_id": int(x["message_id"]),
                    "category": x.get("category"),
                    "level": x.get("level"),
                    "title": x.get("title") or "",
                    "content": x.get("content") or "",
                    "is_read": bool(x.get("is_read")),
                    "read_at": x.get("read_at").isoformat() if isinstance(x.get("read_at"), datetime) else None,
                    "delivered_at": x.get("delivered_at").isoformat() if isinstance(x.get("delivered_at"), datetime) else str(x.get("delivered_at") or ""),
                    "publish_at": x.get("publish_at").isoformat() if isinstance(x.get("publish_at"), datetime) else (str(x.get("publish_at") or "") or None),
                    "expire_at": x.get("expire_at").isoformat() if isinstance(x.get("expire_at"), datetime) else (str(x.get("expire_at") or "") or None),
                    "created_at": x.get("created_at").isoformat() if isinstance(x.get("created_at"), datetime) else str(x.get("created_at") or ""),
                }
                for x in rows
            ]
            return {"items": items, "page": page, "page_size": page_size, "total": total}
    finally:
        conn.close()


@app.post("/api/v1/inbox/{delivery_id}/read")
async def inbox_mark_read(delivery_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE inbox_deliveries
                SET is_read=1, read_at=COALESCE(read_at, UTC_TIMESTAMP())
                WHERE id=%s AND user_id=%s
                """,
                (int(delivery_id), int(user["id"])),
            )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.post("/api/v1/inbox/read-all")
async def inbox_mark_all_read(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE inbox_deliveries d
                JOIN inbox_messages m ON m.id=d.message_id
                SET d.is_read=1, d.read_at=COALESCE(d.read_at, UTC_TIMESTAMP())
                WHERE d.user_id=%s AND d.is_read=0
                  AND m.status='published'
                  AND (m.expire_at IS NULL OR m.expire_at > UTC_TIMESTAMP())
                """,
                (int(user["id"]),),
            )
            affected = int(cur.rowcount or 0)
        conn.commit()
        return {"ok": True, "affected": affected}
    finally:
        conn.close()


# ----- basic -----
@app.get("/api/v1/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "healthy",
        "version": APP_VERSION,
        "time": now_iso(),
        "enable_troubleshoot": ENABLE_TROUBLESHOOT,
        "enable_open_troubleshoot_api": ENABLE_OPEN_TROUBLESHOOT_API,
        "enable_admin_ip_blacklist": ENABLE_ADMIN_IP_BLACKLIST,
        "enable_admin_enterprise_auth": ENABLE_ADMIN_ENTERPRISE_AUTH,
    }


@app.get("/api/v1/settings/worktool")
async def get_worktool_settings(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _ = user
    base = get_worktool_api_base()
    callback_public_base_url = get_callback_public_base_url()
    return {
        "worktool_api_base": base,
        "callback_public_base_url": callback_public_base_url,
        "auto_bind_message_callback_on_create": parse_bool(get_setting("auto_bind_message_callback_on_create", "true"), True),
        "runtime_editable": ENABLE_RUNTIME_WORKTOOL_SETTINGS,
        "message_send_api_url": f"{base}/wework/sendRawMessage",
        "callback_example_url": (
            f"{callback_public_base_url}/api/v1/callback/qa/{{robot_id}}" if callback_public_base_url else ""
        ),
    }


@app.put("/api/v1/settings/worktool")
async def update_worktool_settings(body: WorkToolSettingsUpdate, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _ = user
    if not ENABLE_RUNTIME_WORKTOOL_SETTINGS:
        raise HTTPException(status_code=403, detail="runtime worktool settings disabled")
    if body.worktool_api_base is not None:
        set_setting("worktool_api_base", normalize_worktool_api_base(body.worktool_api_base))
    if body.callback_public_base_url is not None:
        set_setting("callback_public_base_url", normalize_public_base_url(body.callback_public_base_url))
    if body.auto_bind_message_callback_on_create is not None:
        set_setting("auto_bind_message_callback_on_create", "true" if body.auto_bind_message_callback_on_create else "false")
    return await get_worktool_settings()


@app.get("/api/v1/dashboard/overview")
async def dashboard_overview(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    uid = int(user["id"])
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(1) AS c FROM user_robots WHERE user_id=%s", (uid,))
            robots_total = int((cur.fetchone() or {}).get("c") or 0)
            cur.execute(
                """
                SELECT COUNT(1) AS c
                FROM message_logs ml
                JOIN user_robots ur ON ur.robot_pk=ml.robot_pk
                WHERE ur.user_id=%s AND DATE(ml.created_at)=UTC_DATE() AND ml.direction='inbound'
                """,
                (uid,),
            )
            inbound_today = int((cur.fetchone() or {}).get("c") or 0)
            cur.execute(
                """
                SELECT COUNT(1) AS c
                FROM message_logs ml
                JOIN user_robots ur ON ur.robot_pk=ml.robot_pk
                WHERE ur.user_id=%s AND DATE(ml.created_at)=UTC_DATE() AND ml.direction='outbound' AND ml.status='success'
                """,
                (uid,),
            )
            outbound_success_today = int((cur.fetchone() or {}).get("c") or 0)
            cur.execute(
                """
                SELECT COUNT(1) AS c
                FROM message_logs ml
                JOIN user_robots ur ON ur.robot_pk=ml.robot_pk
                WHERE ur.user_id=%s AND DATE(ml.created_at)=UTC_DATE() AND ml.direction='outbound' AND ml.status='failed'
                """,
                (uid,),
            )
            outbound_fail_today = int((cur.fetchone() or {}).get("c") or 0)
    finally:
        conn.close()

    reply_rate = (outbound_success_today / inbound_today) if inbound_today else 0
    fail_rate = (outbound_fail_today / (outbound_success_today + outbound_fail_today)) if (outbound_success_today + outbound_fail_today) else 0
    return {
        "robots_total": robots_total,
        "inbound_today": inbound_today,
        "outbound_success_today": outbound_success_today,
        "outbound_fail_today": outbound_fail_today,
        "reply_rate": round(reply_rate, 4),
        "fail_rate": round(fail_rate, 4),
    }


@app.get("/api/v1/dashboard/trends")
async def dashboard_trends(days: int = Query(default=7, ge=1, le=90), user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    uid = int(user["id"])
    end = datetime.utcnow().date()
    start = end - timedelta(days=days - 1)
    items: Dict[str, Dict[str, Any]] = {}
    for i in range(days):
        d = start + timedelta(days=i)
        k = d.strftime("%Y-%m-%d")
        items[k] = {"date": k, "inbound": 0, "outbound_success": 0}

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DATE(ml.created_at) AS d, ml.direction, ml.status, COUNT(1) AS c
                FROM message_logs ml
                JOIN user_robots ur ON ur.robot_pk=ml.robot_pk
                WHERE ur.user_id=%s AND DATE(ml.created_at) BETWEEN %s AND %s
                GROUP BY DATE(ml.created_at), ml.direction, ml.status
                """,
                (uid, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")),
            )
            rows = cur.fetchall() or []
    finally:
        conn.close()

    for row in rows:
        key = str(row.get("d"))
        if key not in items:
            continue
        c = int(row.get("c") or 0)
        if row.get("direction") == "inbound":
            items[key]["inbound"] += c
        elif row.get("direction") == "outbound" and row.get("status") == "success":
            items[key]["outbound_success"] += c
    return {"days": days, "items": [items[k] for k in sorted(items.keys())]}


# ----- robots/providers/rules -----
@app.get("/api/v1/robots")
async def list_robots(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.* FROM robots r
                JOIN user_robots ur ON ur.robot_pk=r.id
                WHERE ur.user_id=%s
                ORDER BY r.id ASC
                """,
                (int(user["id"]),),
            )
            rows = cur.fetchall() or []
            items = []
            for row in rows:
                row["private_chat_enabled"] = bool(row["private_chat_enabled"])
                row["group_chat_enabled"] = bool(row["group_chat_enabled"])
                row["group_reply_only_when_mentioned"] = bool(row["group_reply_only_when_mentioned"])
                row["group_reply_mode"] = str(row.get("group_reply_mode") or _normalize_group_reply_mode(None, row["group_reply_only_when_mentioned"]))
                row["group_decision_provider_id"] = (
                    int(row["group_decision_provider_id"]) if row.get("group_decision_provider_id") is not None else None
                )
                row["group_colleagues"] = _load_group_colleagues_from_robot(row)
                items.append(row)
            return {"items": items}
    finally:
        conn.close()


@app.get("/api/v1/robots/{robot_id}")
async def get_robot(robot_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    row = _require_robot_access(int(user["id"]), robot_id)
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT scene,reply_text FROM default_replies WHERE robot_pk=%s", (int(row["id"]),))
            defaults = cur.fetchall() or []
    finally:
        conn.close()
    row["private_chat_enabled"] = bool(row["private_chat_enabled"])
    row["group_chat_enabled"] = bool(row["group_chat_enabled"])
    row["group_reply_only_when_mentioned"] = bool(row["group_reply_only_when_mentioned"])
    row["group_reply_mode"] = str(row.get("group_reply_mode") or _normalize_group_reply_mode(None, row["group_reply_only_when_mentioned"]))
    row["group_decision_provider_id"] = (
        int(row["group_decision_provider_id"]) if row.get("group_decision_provider_id") is not None else None
    )
    row["group_colleagues"] = _load_group_colleagues_from_robot(row)
    row["defaults"] = {x["scene"]: x["reply_text"] for x in defaults}
    return row


@app.post("/api/v1/robots")
async def create_robot(body: RobotCreate, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    rid = (body.robot_id or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="robot_id required")
    group_reply_mode = _normalize_group_reply_mode(body.group_reply_mode, body.group_reply_only_when_mentioned)
    decision_provider_id = body.group_decision_provider_id
    decision_prompt_template = _normalize_group_decision_prompt_template(body.group_decision_prompt_template)
    group_colleagues = _normalize_group_colleagues(body.group_colleagues)
    if group_reply_mode == "ai_decide" and decision_provider_id is None:
        raise HTTPException(status_code=400, detail="group_decision_provider_id required when group_reply_mode=ai_decide")
    if decision_provider_id is not None and not _provider_accessible_by_user(int(decision_provider_id), int(user["id"])):
        raise HTTPException(status_code=400, detail="group_decision_provider_id not accessible")

    auto_bind = parse_bool(get_setting("auto_bind_message_callback_on_create", "true"), True)
    callback_url = build_robot_callback_url(rid)
    existed = False

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM robots WHERE robot_id=%s LIMIT 1", (rid,))
            row = cur.fetchone()
            if row:
                existed = True
                cur.execute(
                    "INSERT INTO user_robots(user_id,robot_pk) VALUES(%s,%s) ON DUPLICATE KEY UPDATE robot_pk=robot_pk",
                    (int(user["id"]), int(row["id"])),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO robots(
                      robot_id,name,private_chat_enabled,group_chat_enabled,group_reply_only_when_mentioned,
                      group_reply_mode,group_decision_provider_id,group_decision_prompt_template,group_colleagues_json,created_by
                    )
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        rid,
                        (body.name or "机器人").strip() or "机器人",
                        1 if body.private_chat_enabled else 0,
                        1 if body.group_chat_enabled else 0,
                        1 if group_reply_mode == "mention_only" else 0,
                        group_reply_mode,
                        int(decision_provider_id) if decision_provider_id is not None else None,
                        decision_prompt_template,
                        json.dumps(group_colleagues, ensure_ascii=False),
                        int(user["id"]),
                    ),
                )
                robot_pk = int(cur.lastrowid)
                cur.execute(
                    "INSERT INTO default_replies(robot_pk,scene,reply_text) VALUES(%s,'group',%s) ON DUPLICATE KEY UPDATE reply_text=VALUES(reply_text)",
                    (robot_pk, body.group_default_reply),
                )
                cur.execute(
                    "INSERT INTO default_replies(robot_pk,scene,reply_text) VALUES(%s,'private',%s) ON DUPLICATE KEY UPDATE reply_text=VALUES(reply_text)",
                    (robot_pk, body.private_default_reply),
                )
                cur.execute("INSERT INTO user_robots(user_id,robot_pk) VALUES(%s,%s)", (int(user["id"]), robot_pk))
        conn.commit()
        callback_result = await ensure_default_message_callback(
            robot_id=rid,
            default_callback_url=callback_url,
            auto_bind_enabled=auto_bind,
        )
        return {"ok": True, "existed": existed, **callback_result}
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()


@app.put("/api/v1/robots/{robot_id}")
async def update_robot(robot_id: str, body: RobotUpdate, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    _reject_demo_robot_write(robot_id, "机器人配置", user=user)
    updates: List[str] = []
    params: List[Any] = []
    if body.name is not None:
        updates.append("name=%s")
        params.append(body.name)
    if body.private_chat_enabled is not None:
        updates.append("private_chat_enabled=%s")
        params.append(1 if body.private_chat_enabled else 0)
    if body.group_chat_enabled is not None:
        updates.append("group_chat_enabled=%s")
        params.append(1 if body.group_chat_enabled else 0)
    has_group_reply_mode = "group_reply_mode" in body.model_fields_set
    has_group_reply_only_when_mentioned = "group_reply_only_when_mentioned" in body.model_fields_set
    has_group_decision_provider_id = "group_decision_provider_id" in body.model_fields_set
    has_group_decision_prompt_template = "group_decision_prompt_template" in body.model_fields_set

    resolved_group_reply_mode: Optional[str] = None
    if has_group_reply_mode or has_group_reply_only_when_mentioned:
        resolved_group_reply_mode = _normalize_group_reply_mode(body.group_reply_mode, body.group_reply_only_when_mentioned)
        updates.append("group_reply_mode=%s")
        params.append(resolved_group_reply_mode)
        updates.append("group_reply_only_when_mentioned=%s")
        params.append(1 if resolved_group_reply_mode == "mention_only" else 0)

    if has_group_decision_provider_id:
        if body.group_decision_provider_id is not None and not _provider_accessible_by_user(
            int(body.group_decision_provider_id), int(user["id"]), int(robot["id"])
        ):
            raise HTTPException(status_code=400, detail="group_decision_provider_id not accessible")
        updates.append("group_decision_provider_id=%s")
        params.append(int(body.group_decision_provider_id) if body.group_decision_provider_id is not None else None)
    if has_group_decision_prompt_template:
        updates.append("group_decision_prompt_template=%s")
        params.append(_normalize_group_decision_prompt_template(body.group_decision_prompt_template))
    if "group_colleagues" in body.model_fields_set:
        updates.append("group_colleagues_json=%s")
        params.append(json.dumps(_normalize_group_colleagues(body.group_colleagues), ensure_ascii=False))

    if resolved_group_reply_mode == "ai_decide":
        current_provider_id = (
            int(body.group_decision_provider_id) if has_group_decision_provider_id and body.group_decision_provider_id is not None else robot.get("group_decision_provider_id")
        )
        if current_provider_id is None:
            raise HTTPException(status_code=400, detail="group_decision_provider_id required when group_reply_mode=ai_decide")

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            if updates:
                params.append(int(robot["id"]))
                cur.execute(f"UPDATE robots SET {', '.join(updates)} WHERE id=%s", tuple(params))
            if body.group_default_reply is not None:
                cur.execute(
                    "INSERT INTO default_replies(robot_pk,scene,reply_text) VALUES(%s,'group',%s) ON DUPLICATE KEY UPDATE reply_text=VALUES(reply_text)",
                    (int(robot["id"]), body.group_default_reply),
                )
            if body.private_default_reply is not None:
                cur.execute(
                    "INSERT INTO default_replies(robot_pk,scene,reply_text) VALUES(%s,'private',%s) ON DUPLICATE KEY UPDATE reply_text=VALUES(reply_text)",
                    (int(robot["id"]), body.private_default_reply),
                )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.delete("/api/v1/robots/{robot_id}")
async def delete_robot(robot_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    is_demo = _is_demo_robot_id(robot_id)
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_robots WHERE user_id=%s AND robot_pk=%s", (int(user["id"]), int(robot["id"])))
            # Demo robots are shared experience entries: users may unbind,
            # but we should not delete the robot row/config when last user leaves.
            if not is_demo:
                cur.execute("SELECT COUNT(1) AS c FROM user_robots WHERE robot_pk=%s", (int(robot["id"]),))
                remain = int((cur.fetchone() or {}).get("c") or 0)
                if remain == 0:
                    cur.execute("DELETE FROM robots WHERE id=%s", (int(robot["id"]),))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/api/v1/providers")
async def list_providers(robot_id: Optional[str] = None, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    robot_pk: Optional[int] = None
    if robot_id:
        robot = _require_robot_access(int(user["id"]), robot_id)
        robot_pk = int(robot["id"])
    ensure_default_test_provider(int(user["id"]))
    include_system = 1 if _default_test_provider_enabled() else 0
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            if robot_pk is None:
                cur.execute(
                    """
                    SELECT DISTINCT p.*
                    FROM ai_providers p
                    LEFT JOIN routing_rules r ON r.provider_id=p.id
                    LEFT JOIN user_robots ur ON ur.robot_pk=r.robot_pk AND ur.user_id=%s
                    WHERE (%s=1 AND p.is_system=1) OR p.created_by=%s OR ur.user_id IS NOT NULL
                    ORDER BY p.id ASC
                    """,
                    (int(user["id"]), include_system, int(user["id"])),
                )
            else:
                cur.execute(
                    """
                    SELECT DISTINCT p.*
                    FROM ai_providers p
                    LEFT JOIN routing_rules r ON r.provider_id=p.id AND r.robot_pk=%s
                    WHERE (%s=1 AND p.is_system=1) OR p.created_by=%s OR r.id IS NOT NULL
                    ORDER BY p.id ASC
                    """,
                    (int(robot_pk), include_system, int(user["id"])),
                )
            rows = cur.fetchall() or []
            items = []
            for row in rows:
                is_system = bool(row.get("is_system"))
                can_manage = (not is_system) and int(row.get("created_by") or 0) == int(user["id"])
                row["enabled"] = bool(row["enabled"])
                row["asker_info_mode"] = _resolve_asker_info_mode(
                    row.get("asker_info_mode"),
                    bool(row.get("include_asker_info")),
                )
                row["include_asker_info"] = bool(row.get("include_asker_info"))
                if not is_system:
                    cur.execute(
                        """
                        SELECT DISTINCT rbt.robot_id
                        FROM routing_rules rr
                        JOIN robots rbt ON rbt.id=rr.robot_pk
                        JOIN user_robots ur2 ON ur2.robot_pk=rr.robot_pk
                        WHERE rr.provider_id=%s AND ur2.user_id=%s
                        ORDER BY rbt.robot_id ASC
                        """,
                        (int(row["id"]), int(user["id"])),
                    )
                    used_robot_rows = cur.fetchall() or []
                    used_robot_ids = [str(x.get("robot_id") or "").strip() for x in used_robot_rows if str(x.get("robot_id") or "").strip()]
                    row["used_robot_ids"] = used_robot_ids
                    row["used_robot_count"] = len(used_robot_ids)
                row["is_system"] = is_system
                row["can_manage"] = can_manage
                row["api_token_masked"] = mask_token(str(row["api_token"]))
                row.pop("api_token", None)
                row.pop("created_by", None)
                items.append(row)
            return {"items": items}
    finally:
        conn.close()


@app.post("/api/v1/providers")
async def create_provider(body: ProviderCreate, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    extra = _normalize_extra_json(body.extra_json)
    asker_info_mode = _resolve_asker_info_mode(body.asker_info_mode, body.include_asker_info)

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ai_providers(created_by,name,base_url,api_token,model,provider_type,auth_scheme,extra_json,system_prompt_template,include_asker_info,asker_info_mode,enabled)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    int(user["id"]),
                    body.name,
                    body.base_url,
                    body.api_token,
                    body.model,
                    body.provider_type,
                    _resolve_auth_scheme(body.provider_type, body.auth_scheme),
                    extra,
                    _normalize_provider_system_prompt_template(body.system_prompt_template),
                    0 if asker_info_mode == "off" else 1,
                    asker_info_mode,
                    1 if body.enabled else 0,
                ),
            )
        conn.commit()
    except pymysql.err.IntegrityError as e:
        raise HTTPException(status_code=400, detail=f"create provider failed: {e}") from e
    finally:
        conn.close()
    return {"ok": True}


@app.post("/api/v1/providers/test")
async def test_provider(body: ProviderTestRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    cfg: Dict[str, Any] = {}
    uid = int(user["id"])

    if body.provider_id is not None:
        provider_id = int(body.provider_id)
        if not _provider_owned_by_user(provider_id, uid):
            raise HTTPException(status_code=403, detail="无权测试该Provider")
        conn = db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM ai_providers WHERE id=%s AND created_by=%s LIMIT 1", (provider_id, uid))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Provider 不存在")
                cfg = dict(row)
        finally:
            conn.close()

    if body.base_url is not None:
        cfg["base_url"] = (body.base_url or "").strip()
    if body.model is not None:
        cfg["model"] = body.model
    if body.provider_type is not None:
        cfg["provider_type"] = body.provider_type
    if body.auth_scheme is not None:
        cfg["auth_scheme"] = body.auth_scheme
    if body.extra_json is not None:
        cfg["extra_json"] = _normalize_extra_json(body.extra_json)
    if body.api_token is not None:
        token = (body.api_token or "").strip()
        if token:
            cfg["api_token"] = token

    base_url = str(cfg.get("base_url") or "").strip()
    if not base_url:
        raise HTTPException(status_code=400, detail="Base URL 不能为空")

    provider_type = str(cfg.get("provider_type") or "openai")
    auth_scheme = _resolve_auth_scheme(provider_type, cfg.get("auth_scheme"))
    api_token = str(cfg.get("api_token") or "").strip()
    if provider_type != "openclaw" and not api_token:
        raise HTTPException(status_code=400, detail="API Token 不能为空")
    extra_json = cfg.get("extra_json")
    if isinstance(extra_json, dict):
        extra_json = json.dumps(extra_json, ensure_ascii=False)

    test_rule = {
        "id": cfg.get("id") or 0,
        "provider_id": cfg.get("id") or 0,
        "provider_name": cfg.get("name") or "provider_test",
        "base_url": base_url,
        "api_token": api_token,
        "model": cfg.get("model") or "",
        "provider_type": provider_type,
        "auth_scheme": auth_scheme,
        "extra_json": extra_json,
    }
    test_prompt = "hi"
    req_cfg = _build_provider_http_request(test_rule, test_prompt)
    debug_request = {
        "method": "POST",
        "url": req_cfg["url"],
        "headers": req_cfg["headers"],
        "request_body": req_cfg["payload"],
    }
    debug_curl = _build_request_curl("POST", req_cfg["url"], req_cfg["headers"], req_cfg["payload"])
    started = time.perf_counter()
    if provider_type == "openclaw":
        sample_payload = {
            "spoken": "您好,欢迎使用WorkTool~",
            "rawSpoken": "@小明 您好,欢迎使用WorkTool~",
            "receivedName": "WorkTool",
            "groupName": "WorkTool",
            "groupRemark": "小明参与的WorkTool",
            "roomType": 1,
            "atMe": True,
            "textType": 1,
            "fileBase64": "",
        }
        try:
            resp = await _call_openclaw_webhook(test_rule, sample_payload)
            elapsed = round(time.perf_counter() - started, 3)
            return {
                "ok": True,
                "elapsed_seconds": elapsed,
                "response_preview": _short_text(json.dumps(resp, ensure_ascii=False), 200),
                "debug": {"request": debug_request, "curl": debug_curl, "response_body": resp},
            }
        except HTTPException as e:
            raise HTTPException(
                status_code=e.status_code,
                detail={
                    "message": str(e.detail),
                    "debug": {"request": debug_request, "curl": debug_curl},
                },
            ) from e
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail={
                    "message": str(e),
                    "debug": {"request": debug_request, "curl": debug_curl},
                },
            ) from e

    try:
        reply = await _call_provider(test_rule, test_prompt)
        elapsed = round(time.perf_counter() - started, 3)
        return {
            "ok": True,
            "elapsed_seconds": elapsed,
            "reply_preview": _short_text(reply, 200),
            "debug": {"request": debug_request, "curl": debug_curl},
        }
    except HTTPException as e:
        raise HTTPException(
            status_code=e.status_code,
            detail={
                "message": str(e.detail),
                "debug": {"request": debug_request, "curl": debug_curl},
            },
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail={
                "message": str(e),
                "debug": {"request": debug_request, "curl": debug_curl},
            },
        ) from e


@app.put("/api/v1/providers/{provider_id}")
async def update_provider(provider_id: int, body: ProviderUpdate, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if not _provider_owned_by_user(provider_id, int(user["id"])):
        raise HTTPException(status_code=403, detail="无权修改该Provider")

    updates: List[str] = []
    params: List[Any] = []
    if body.name is not None:
        updates.append("name=%s")
        params.append(body.name)
    if body.base_url is not None:
        updates.append("base_url=%s")
        params.append(body.base_url)
    if body.api_token is not None:
        updates.append("api_token=%s")
        params.append(body.api_token)
    if body.model is not None:
        updates.append("model=%s")
        params.append(body.model)
    if body.provider_type is not None:
        updates.append("provider_type=%s")
        params.append(body.provider_type)
    if body.auth_scheme is not None:
        updates.append("auth_scheme=%s")
        params.append(body.auth_scheme)
    if body.extra_json is not None:
        updates.append("extra_json=%s")
        params.append(_normalize_extra_json(body.extra_json))
    if body.system_prompt_template is not None:
        updates.append("system_prompt_template=%s")
        params.append(_normalize_provider_system_prompt_template(body.system_prompt_template))
    if body.asker_info_mode is not None:
        mode = _resolve_asker_info_mode(body.asker_info_mode, body.include_asker_info)
        updates.append("asker_info_mode=%s")
        params.append(mode)
        updates.append("include_asker_info=%s")
        params.append(0 if mode == "off" else 1)
    elif body.include_asker_info is not None:
        mode = _resolve_asker_info_mode(None, body.include_asker_info)
        updates.append("asker_info_mode=%s")
        params.append(mode)
        updates.append("include_asker_info=%s")
        params.append(1 if body.include_asker_info else 0)
    if body.enabled is not None:
        updates.append("enabled=%s")
        params.append(1 if body.enabled else 0)
    if not updates:
        return {"ok": True}

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            params.append(provider_id)
            params.append(int(user["id"]))
            cur.execute(f"UPDATE ai_providers SET {', '.join(updates)} WHERE id=%s AND created_by=%s", tuple(params))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.delete("/api/v1/providers/{provider_id}")
async def delete_provider(provider_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if not _provider_owned_by_user(provider_id, int(user["id"])):
        raise HTTPException(status_code=403, detail="无权删除该Provider")
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM ai_providers WHERE id=%s AND created_by=%s", (provider_id, int(user["id"])))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/api/v1/robots/{robot_id}/rules")
async def list_rules(robot_id: str, scene: Optional[str] = None, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            sql = (
                "SELECT r.id,p.id AS provider_id,p.name AS provider_name,r.scene,"
                "r.pattern_match_type,r.pattern,r.content_match_type,r.content_pattern,r.priority,r.enabled "
                "FROM routing_rules r JOIN ai_providers p ON p.id=r.provider_id WHERE r.robot_pk=%s"
            )
            params: List[Any] = [int(robot["id"])]
            if scene:
                sql += " AND r.scene=%s"
                params.append(scene)
            sql += " ORDER BY r.scene ASC, r.priority ASC, r.id ASC"
            cur.execute(sql, tuple(params))
            rows = cur.fetchall() or []
            items = []
            for row in rows:
                items.append(
                    {
                        "id": int(row["id"]),
                        "robot_id": robot_id,
                        "scene": row["scene"],
                        "pattern_match_type": row.get("pattern_match_type") or "regex",
                        "pattern": row["pattern"],
                        "content_match_type": row.get("content_match_type") or "regex",
                        "content_pattern": row.get("content_pattern"),
                        "provider_id": int(row["provider_id"]),
                        "provider_name": row["provider_name"],
                        "priority": int(row["priority"]),
                        "enabled": bool(row["enabled"]),
                    }
                )
            return {"items": items}
    finally:
        conn.close()


@app.post("/api/v1/rules")
async def create_rule(body: RuleCreate, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), body.robot_id)
    _reject_demo_robot_write(body.robot_id, "机器人配置", user=user)
    if not _provider_accessible_by_user(body.provider_id, int(user["id"]), int(robot["id"])):
        raise HTTPException(status_code=403, detail="无权使用该Provider")
    pattern_match_type = body.pattern_match_type
    content_match_type = body.content_match_type
    title_pattern = (body.pattern or "").strip()
    content_pattern = (body.content_pattern or "").strip()
    if pattern_match_type != "all" and not title_pattern:
        raise HTTPException(status_code=400, detail="群名/昵称匹配方式为精准/模糊时，请填写匹配内容")
    if content_match_type != "all" and not content_pattern:
        raise HTTPException(status_code=400, detail="聊天内容匹配方式为精准/模糊时，请填写匹配内容")
    if pattern_match_type != "all" and content_match_type != "all" and not title_pattern and not content_pattern:
        raise HTTPException(status_code=400, detail="请至少填写一个匹配规则（群名/昵称 或 聊天内容）")

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO routing_rules(robot_pk,scene,pattern_match_type,pattern,content_match_type,content_pattern,provider_id,priority,enabled)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    int(robot["id"]),
                    body.scene,
                    pattern_match_type,
                    title_pattern,
                    content_match_type,
                    content_pattern or None,
                    body.provider_id,
                    body.priority,
                    1 if body.enabled else 0,
                ),
            )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.put("/api/v1/rules/{rule_id}")
async def update_rule(rule_id: int, body: RuleUpdate, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.id,r.robot_pk,r.pattern_match_type,r.pattern,r.content_match_type,r.content_pattern FROM routing_rules r
                JOIN user_robots ur ON ur.robot_pk=r.robot_pk
                WHERE r.id=%s AND ur.user_id=%s
                LIMIT 1
                """,
                (rule_id, int(user["id"])),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=403, detail="无权修改该规则")
            robot_row = _get_robot_by_pk_or_404(int(row["robot_pk"]))
            _reject_demo_robot_write(str(robot_row.get("robot_id") or ""), "机器人配置", user=user)

            updates: List[str] = []
            params: List[Any] = []
            if body.pattern_match_type is not None:
                updates.append("pattern_match_type=%s")
                params.append(body.pattern_match_type)
            if body.pattern is not None:
                updates.append("pattern=%s")
                params.append(body.pattern.strip())
            if body.content_match_type is not None:
                updates.append("content_match_type=%s")
                params.append(body.content_match_type)
            if body.content_pattern is not None:
                updates.append("content_pattern=%s")
                params.append(body.content_pattern.strip() or None)
            if body.provider_id is not None:
                if not _provider_accessible_by_user(body.provider_id, int(user["id"]), int(row["robot_pk"])):
                    raise HTTPException(status_code=403, detail="无权使用该Provider")
                updates.append("provider_id=%s")
                params.append(body.provider_id)
            if body.priority is not None:
                updates.append("priority=%s")
                params.append(body.priority)
            if body.enabled is not None:
                updates.append("enabled=%s")
                params.append(1 if body.enabled else 0)
            if body.pattern is not None or body.content_pattern is not None or body.pattern_match_type is not None or body.content_match_type is not None:
                next_pattern_match_type = (
                    body.pattern_match_type
                    if body.pattern_match_type is not None
                    else str(row.get("pattern_match_type") or "regex")
                )
                next_content_match_type = (
                    body.content_match_type
                    if body.content_match_type is not None
                    else str(row.get("content_match_type") or "regex")
                )
                next_title_pattern = body.pattern.strip() if body.pattern is not None else str(row.get("pattern") or "").strip()
                next_content_pattern = (
                    body.content_pattern.strip() if body.content_pattern is not None else str(row.get("content_pattern") or "").strip()
                )
                if next_pattern_match_type != "all" and not next_title_pattern:
                    raise HTTPException(status_code=400, detail="群名/昵称匹配方式为精准/模糊时，请填写匹配内容")
                if next_content_match_type != "all" and not next_content_pattern:
                    raise HTTPException(status_code=400, detail="聊天内容匹配方式为精准/模糊时，请填写匹配内容")
                if (
                    next_pattern_match_type != "all"
                    and next_content_match_type != "all"
                    and not next_title_pattern
                    and not next_content_pattern
                ):
                    raise HTTPException(status_code=400, detail="请至少填写一个匹配规则（群名/昵称 或 聊天内容）")
            if updates:
                params.append(rule_id)
                cur.execute(f"UPDATE routing_rules SET {', '.join(updates)} WHERE id=%s", tuple(params))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.delete("/api/v1/rules/{rule_id}")
async def delete_rule(rule_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.robot_pk
                FROM routing_rules r
                JOIN user_robots ur ON ur.robot_pk=r.robot_pk
                WHERE r.id=%s AND ur.user_id=%s
                LIMIT 1
                """,
                (rule_id, int(user["id"])),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=403, detail="无权删除该规则")
            robot_row = _get_robot_by_pk_or_404(int(row["robot_pk"]))
            _reject_demo_robot_write(str(robot_row.get("robot_id") or ""), "机器人配置", user=user)
    finally:
        conn.close()

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE r FROM routing_rules r
                JOIN user_robots ur ON ur.robot_pk=r.robot_pk
                WHERE r.id=%s AND ur.user_id=%s
                """,
                (rule_id, int(user["id"])),
            )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.put("/api/v1/robots/{robot_id}/rules/reorder")
async def reorder_rules(robot_id: str, scene: str, body: ReorderPayload, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    _reject_demo_robot_write(robot_id, "机器人配置", user=user)
    if scene not in {"group", "private"}:
        raise HTTPException(status_code=400, detail="scene must be group/private")
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            for idx, rule_id in enumerate(body.rule_ids, start=1):
                cur.execute(
                    "UPDATE routing_rules SET priority=%s WHERE id=%s AND robot_pk=%s AND scene=%s",
                    (idx, rule_id, int(robot["id"]), scene),
                )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/api/v1/forwards")
async def list_forward_rules(
    source_robot_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    uid = int(user["id"])
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            sql = (
                """
                SELECT fr.*,
                       sr.robot_id AS source_robot_id,sr.name AS source_robot_name,
                       rr.robot_id AS send_robot_id,rr.name AS send_robot_name
                FROM forward_rules fr
                JOIN robots sr ON sr.id=fr.source_robot_pk
                LEFT JOIN robots rr ON rr.id=fr.send_robot_pk
                JOIN user_robots ur ON ur.robot_pk=fr.source_robot_pk AND ur.user_id=%s
                WHERE fr.created_by=%s
                """
            )
            params: List[Any] = [uid, uid]
            if source_robot_id:
                sql += " AND sr.robot_id=%s"
                params.append(source_robot_id)
            sql += " ORDER BY fr.id DESC"
            cur.execute(sql, tuple(params))
            rows = cur.fetchall() or []
            items: List[Dict[str, Any]] = []
            for row in rows:
                items.append(
                    {
                        "id": int(row["id"]),
                        "source_robot_id": row.get("source_robot_id"),
                        "source_robot_name": row.get("source_robot_name") or "",
                        "source_scene": row.get("source_scene"),
                        "source_match_type": row.get("source_match_type"),
                        "source_pattern": row.get("source_pattern") or "",
                        "target_name": row.get("target_name") or "",
                        "use_other_robot": bool(row.get("use_other_robot")),
                        "send_robot_id": row.get("send_robot_id"),
                        "send_robot_name": row.get("send_robot_name") or "",
                        "prefix_enabled": bool(row.get("prefix_enabled")),
                        "prefix_template": row.get("prefix_template") or "",
                        "keyword_match_type": row.get("keyword_match_type"),
                        "keyword_pattern": row.get("keyword_pattern") or "",
                        "enabled": bool(row.get("enabled")),
                        "created_at": row.get("created_at"),
                        "updated_at": row.get("updated_at"),
                    }
                )
            return {"items": items}
    finally:
        conn.close()


@app.post("/api/v1/forwards")
async def create_forward_rule(body: ForwardRuleCreate, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    uid = int(user["id"])
    source_robot = _require_robot_access(uid, body.source_robot_id)
    _reject_demo_robot_write(str(source_robot.get("robot_id") or body.source_robot_id), "消息转发规则", user=user)
    source_match_type = body.source_match_type
    source_pattern = (body.source_pattern or "").strip()
    if source_match_type != "all" and not source_pattern:
        raise HTTPException(status_code=400, detail="来源对象匹配为精准/模糊时，请填写来源对象")
    target_name = (body.target_name or "").strip()
    if not target_name:
        raise HTTPException(status_code=400, detail="目标名称不能为空")
    keyword_match_type = body.keyword_match_type
    keyword_pattern = (body.keyword_pattern or "").strip()
    if keyword_match_type != "all" and not keyword_pattern:
        raise HTTPException(status_code=400, detail="关键词匹配为精准/模糊时，请填写关键词")
    send_robot_pk: Optional[int] = None
    if body.use_other_robot:
        if not (body.send_robot_id or "").strip():
            raise HTTPException(status_code=400, detail="已开启“使用其他机器人发送”，请先选择发送机器人")
        send_robot = _require_robot_access(uid, body.send_robot_id or "")
        send_robot_pk = int(send_robot["id"])
    prefix_template = (body.prefix_template or "").strip() or None

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO forward_rules(
                  created_by,source_robot_pk,source_scene,source_match_type,source_pattern,target_name,
                  use_other_robot,send_robot_pk,prefix_enabled,prefix_template,keyword_match_type,keyword_pattern,enabled
                )
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    uid,
                    int(source_robot["id"]),
                    body.source_scene,
                    source_match_type,
                    source_pattern or None,
                    target_name,
                    1 if body.use_other_robot else 0,
                    send_robot_pk,
                    1 if body.prefix_enabled else 0,
                    prefix_template,
                    keyword_match_type,
                    keyword_pattern or None,
                    1 if body.enabled else 0,
                ),
            )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.put("/api/v1/forwards/{rule_id}")
async def update_forward_rule(rule_id: int, body: ForwardRuleUpdate, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    uid = int(user["id"])
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM forward_rules WHERE id=%s AND created_by=%s LIMIT 1", (rule_id, uid))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="转发规则不存在")
            current_source_robot_row = _get_robot_by_pk_or_404(int(row["source_robot_pk"]))
            _reject_demo_robot_write(str(current_source_robot_row.get("robot_id") or ""), "消息转发规则", user=user)

            source_robot_pk = int(row["source_robot_pk"])
            if body.source_robot_id is not None:
                source_robot = _require_robot_access(uid, body.source_robot_id)
                source_robot_pk = int(source_robot["id"])

            source_scene = body.source_scene if body.source_scene is not None else row.get("source_scene")
            source_match_type = body.source_match_type if body.source_match_type is not None else row.get("source_match_type")
            source_pattern = (
                body.source_pattern.strip()
                if body.source_pattern is not None
                else str(row.get("source_pattern") or "").strip()
            )
            if source_match_type != "all" and not source_pattern:
                raise HTTPException(status_code=400, detail="来源对象匹配为精准/模糊时，请填写来源对象")

            target_name = (
                body.target_name.strip()
                if body.target_name is not None
                else str(row.get("target_name") or "").strip()
            )
            if not target_name:
                raise HTTPException(status_code=400, detail="目标名称不能为空")

            use_other_robot = bool(body.use_other_robot) if body.use_other_robot is not None else bool(row.get("use_other_robot"))
            send_robot_pk: Optional[int]
            if use_other_robot:
                target_send_robot_id = (
                    (body.send_robot_id or "").strip()
                    if body.send_robot_id is not None
                    else (
                        _get_robot_by_pk_or_404(int(row["send_robot_pk"])).get("robot_id")
                        if row.get("send_robot_pk")
                        else ""
                    )
                )
                if not target_send_robot_id:
                    raise HTTPException(status_code=400, detail="已开启“使用其他机器人发送”，请先选择发送机器人")
                send_robot = _require_robot_access(uid, target_send_robot_id)
                send_robot_pk = int(send_robot["id"])
            else:
                send_robot_pk = None

            prefix_enabled = bool(body.prefix_enabled) if body.prefix_enabled is not None else bool(row.get("prefix_enabled"))
            prefix_template = (
                body.prefix_template.strip()
                if body.prefix_template is not None
                else str(row.get("prefix_template") or "").strip()
            ) or None
            keyword_match_type = (
                body.keyword_match_type if body.keyword_match_type is not None else row.get("keyword_match_type")
            )
            keyword_pattern = (
                body.keyword_pattern.strip()
                if body.keyword_pattern is not None
                else str(row.get("keyword_pattern") or "").strip()
            )
            if keyword_match_type != "all" and not keyword_pattern:
                raise HTTPException(status_code=400, detail="关键词匹配为精准/模糊时，请填写关键词")
            enabled = bool(body.enabled) if body.enabled is not None else bool(row.get("enabled"))

            cur.execute(
                """
                UPDATE forward_rules
                SET source_robot_pk=%s,source_scene=%s,source_match_type=%s,source_pattern=%s,
                    target_name=%s,use_other_robot=%s,send_robot_pk=%s,
                    prefix_enabled=%s,prefix_template=%s,keyword_match_type=%s,keyword_pattern=%s,enabled=%s
                WHERE id=%s AND created_by=%s
                """,
                (
                    source_robot_pk,
                    source_scene,
                    source_match_type,
                    source_pattern or None,
                    target_name,
                    1 if use_other_robot else 0,
                    send_robot_pk,
                    1 if prefix_enabled else 0,
                    prefix_template,
                    keyword_match_type,
                    keyword_pattern or None,
                    1 if enabled else 0,
                    rule_id,
                    uid,
                ),
            )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.delete("/api/v1/forwards/{rule_id}")
async def delete_forward_rule(rule_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    uid = int(user["id"])
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT source_robot_pk FROM forward_rules WHERE id=%s AND created_by=%s LIMIT 1", (rule_id, uid))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="转发规则不存在")
            source_robot_row = _get_robot_by_pk_or_404(int(row["source_robot_pk"]))
            _reject_demo_robot_write(str(source_robot_row.get("robot_id") or ""), "消息转发规则", user=user)
            cur.execute("DELETE FROM forward_rules WHERE id=%s AND created_by=%s", (rule_id, uid))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/api/v1/forwards/logs")
async def list_forward_logs(
    robot_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    uid = int(user["id"])
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            where_parts = ["fr.created_by=%s"]
            params: List[Any] = [uid]
            if robot_id:
                source_robot = _require_robot_access(uid, robot_id)
                where_parts.append("fl.source_robot_pk=%s")
                params.append(int(source_robot["id"]))
            where_sql = " AND ".join(where_parts)
            cur.execute(
                f"""
                SELECT COUNT(1) AS c
                FROM forward_logs fl
                JOIN forward_rules fr ON fr.id=fl.rule_id
                WHERE {where_sql}
                """,
                tuple(params),
            )
            total = int((cur.fetchone() or {}).get("c") or 0)
            offset = (page - 1) * page_size
            cur.execute(
                f"""
                SELECT fl.*,sr.robot_id AS source_robot_id,rr.robot_id AS send_robot_id
                FROM forward_logs fl
                JOIN forward_rules fr ON fr.id=fl.rule_id
                JOIN robots sr ON sr.id=fl.source_robot_pk
                JOIN robots rr ON rr.id=fl.send_robot_pk
                WHERE {where_sql}
                ORDER BY fl.id DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [page_size, offset]),
            )
            rows = cur.fetchall() or []
            items: List[Dict[str, Any]] = []
            for row in rows:
                items.append(
                    {
                        "id": int(row["id"]),
                        "rule_id": int(row["rule_id"]),
                        "source_robot_id": row.get("source_robot_id"),
                        "send_robot_id": row.get("send_robot_id"),
                        "source_scene": row.get("source_scene"),
                        "source_name": row.get("source_name") or "",
                        "sender_name": row.get("sender_name") or "",
                        "target_name": row.get("target_name") or "",
                        "message_id": row.get("message_id") or "",
                        "question_text": row.get("question_text") or "",
                        "forwarded_text": row.get("forwarded_text") or "",
                        "status": row.get("status"),
                        "error_reason": row.get("error_reason") or "",
                        "time_cost": float(row.get("time_cost") or 0),
                        "created_at": row.get("created_at"),
                    }
                )
            return {"items": items, "total": total, "page": page, "page_size": page_size}
    finally:
        conn.close()


# ----- compatible utility endpoints -----
@app.get("/api/v1/logs/messages")
async def list_message_logs(
    robot_id: Optional[str] = None,
    scene: Optional[str] = None,
    status: Optional[str] = None,
    direction: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            where = ["ur.user_id=%s"]
            params: List[Any] = [int(user["id"])]
            if robot_id:
                where.append("r.robot_id=%s")
                params.append(robot_id)
            if scene:
                where.append("ml.scene=%s")
                params.append(scene)
            if status:
                where.append("ml.status=%s")
                params.append(status)
            if direction:
                where.append("ml.direction=%s")
                params.append(direction)

            where_sql = " AND ".join(where)
            cur.execute(
                f"""
                SELECT COUNT(1) AS c
                FROM message_logs ml
                JOIN robots r ON r.id=ml.robot_pk
                JOIN user_robots ur ON ur.robot_pk=r.id
                WHERE {where_sql}
                """,
                tuple(params),
            )
            total = int((cur.fetchone() or {}).get("c") or 0)
            offset = (page - 1) * page_size
            cur.execute(
                f"""
                SELECT ml.id,r.robot_id,ml.direction,ml.scene,ml.normalized_content,ml.status,ml.created_at
                FROM message_logs ml
                JOIN robots r ON r.id=ml.robot_pk
                JOIN user_robots ur ON ur.robot_pk=r.id
                WHERE {where_sql}
                ORDER BY ml.id DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [page_size, offset]),
            )
            items = cur.fetchall() or []
            return {"items": items, "total": total, "page": page, "page_size": page_size}
    finally:
        conn.close()


@app.get("/api/v1/logs/messages/{log_id}")
async def get_message_log(log_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ml.id,r.robot_id,ml.direction,ml.scene,ml.normalized_content,ml.status,ml.created_at
                FROM message_logs ml
                JOIN robots r ON r.id=ml.robot_pk
                JOIN user_robots ur ON ur.robot_pk=r.id
                WHERE ml.id=%s AND ur.user_id=%s
                LIMIT 1
                """,
                (log_id, int(user["id"])),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="log not found")
            return row
    finally:
        conn.close()


async def _is_platform_message_callback(robot_id: str) -> bool:
    expected = build_robot_callback_url(robot_id).strip().rstrip("/")
    if not expected:
        return False
    try:
        res = await fetch_worktool_api("/robot/robotInfo/callBack/get", {"robotId": robot_id})
    except Exception as e:
        logger.warning("detect_message_callback_source_failed robot_id=%s err=%s", robot_id, str(e))
        return False
    rows = res.get("data")
    if not isinstance(rows, list):
        return False
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            cb_type = int(row.get("type"))
        except Exception:
            continue
        if cb_type != 11:
            continue
        current = str(row.get("callBackUrl") or row.get("callbackUrl") or "").strip().rstrip("/")
        return bool(current) and current == expected
    return False


async def _process_qa_callback_task(
    *,
    robot_id: str,
    req_payload: Dict[str, Any],
    callback_url: str,
    callback_payload: Dict[str, Any],
    local_log_id: int,
) -> None:
    started_at = time.perf_counter()
    req = QARequest(**req_payload)
    robot = _get_robot_by_id_or_404(robot_id)
    robot_pk = int(robot["id"])
    scene = _scene_from_room_type(req.roomType)
    text_type = int(req.textType or 0)
    image_base64 = str(req.fileBase64 or "").strip()
    is_image_callback = text_type == 2 and bool(image_base64)
    inbound_text = "[图片]" if is_image_callback else _pick_inbound_text(req)
    match_target = _rule_match_target(scene, req)
    callback_message_id = _pick_message_id(req)
    ai_decision_reply: Optional[bool] = None
    context_session_key = _build_context_session_key(scene, req)

    _insert_message_log(robot_pk, "inbound", scene, inbound_text, "received")
    _append_chat_context_message(
        robot_pk,
        scene,
        context_session_key,
        "user",
        inbound_text,
        sender_name=(req.receivedName or "").strip(),
        message_id=callback_message_id,
    )
    try:
        await _run_forwarding_for_callback(robot, scene, req, inbound_text)
    except Exception as e:
        logger.warning("forwarding_pipeline_failed robot_id=%s err=%s", robot_id, str(e))

    if scene == "private" and not bool(robot.get("private_chat_enabled")):
        logger.info("qa_callback_skipped robot_id=%s reason=private_chat_disabled", robot_id)
        _insert_message_log(robot_pk, "outbound", scene, "", "skipped")
        _update_qa_monitor_log(local_log_id, "", "skipped", time.perf_counter() - started_at)
        return
    if scene == "group":
        colleague_name_keys = _build_group_colleague_name_keys(_load_group_colleagues_from_robot(robot))
        sender_key = _normalize_name_key(req.receivedName)
        if colleague_name_keys and sender_key and sender_key in colleague_name_keys and not bool(req.atMe):
            logger.info("qa_callback_skipped robot_id=%s reason=group_colleague_speaker_no_at", robot_id)
            _insert_message_log(robot_pk, "outbound", scene, "", "skipped")
            _update_qa_monitor_log(local_log_id, "", "skipped", time.perf_counter() - started_at, ai_decision_reply=False)
            return
        if not bool(robot.get("group_chat_enabled")):
            logger.info("qa_callback_skipped robot_id=%s reason=group_chat_disabled", robot_id)
            _insert_message_log(robot_pk, "outbound", scene, "", "skipped")
            _update_qa_monitor_log(local_log_id, "", "skipped", time.perf_counter() - started_at)
            return
        group_reply_mode = _normalize_group_reply_mode(
            str(robot.get("group_reply_mode") or ""),
            bool(robot.get("group_reply_only_when_mentioned")),
        )
        if not bool(req.atMe):
            if group_reply_mode == "mention_only":
                logger.info("qa_callback_skipped robot_id=%s reason=group_only_when_mentioned", robot_id)
                _insert_message_log(robot_pk, "outbound", scene, "", "skipped")
                _update_qa_monitor_log(local_log_id, "", "skipped", time.perf_counter() - started_at)
                return
            if group_reply_mode == "ai_decide":
                should_reply = await _should_reply_group_by_ai_decision(robot, req, inbound_text)
                ai_decision_reply = bool(should_reply)
                if not should_reply:
                    logger.info("qa_callback_skipped robot_id=%s reason=group_ai_decide_no", robot_id)
                    _insert_message_log(robot_pk, "outbound", scene, "", "skipped")
                    _update_qa_monitor_log(local_log_id, "", "skipped", time.perf_counter() - started_at, ai_decision_reply=ai_decision_reply)
                    return

    selected_rule: Optional[Dict[str, Any]] = None
    selected_rank: Optional[int] = None
    rules = _load_enabled_rules(robot_pk, scene)
    logger.info(
        "qa_callback_rules_loaded robot_id=%s scene=%s rule_count=%s match_target=%s",
        robot_id,
        scene,
        len(rules),
        _short_text(match_target, 120),
    )
    for rule in rules:
        title_match_type = str(rule.get("pattern_match_type") or "regex")
        content_match_type = str(rule.get("content_match_type") or "regex")
        title_pattern = str(rule.get("pattern") or "")
        content_pattern = str(rule.get("content_pattern") or "")
        matched_title = _match_with_mode(title_match_type, title_pattern, match_target)
        matched_content = _match_with_mode(content_match_type, content_pattern, inbound_text)
        if matched_title or matched_content:
            candidate_rank = 99
            if matched_title:
                candidate_rank = min(candidate_rank, _mode_rank(title_match_type))
            if matched_content:
                candidate_rank = min(candidate_rank, _mode_rank(content_match_type))
            if selected_rule is None:
                selected_rule = rule
                selected_rank = candidate_rank
                continue
            current_priority = int(selected_rule.get("priority") or 999999)
            candidate_priority = int(rule.get("priority") or 999999)
            current_id = int(selected_rule.get("id") or 0)
            candidate_id = int(rule.get("id") or 0)
            if (
                selected_rank is None
                or candidate_rank < selected_rank
                or (
                    candidate_rank == selected_rank
                    and (
                        candidate_priority < current_priority
                        or (candidate_priority == current_priority and candidate_id < current_id)
                    )
                )
            ):
                selected_rule = rule
                selected_rank = candidate_rank

    if not selected_rule:
        logger.info("qa_callback_rule_not_matched robot_id=%s scene=%s", robot_id, scene)
        default_reply = _load_default_reply(robot_pk, scene)
        if default_reply:
            logger.info("qa_callback_default_reply robot_id=%s scene=%s reply=%s", robot_id, scene, _short_text(default_reply, 160))
            try:
                await _send_worktool_text(robot_id, scene, req, default_reply)
                _insert_message_log(robot_pk, "outbound", scene, default_reply, "success")
                _append_chat_context_message(
                    robot_pk,
                    scene,
                    context_session_key,
                    "assistant",
                    default_reply,
                    sender_name=None,
                    message_id=callback_message_id,
                )
                _update_qa_monitor_log(local_log_id, default_reply, "success", time.perf_counter() - started_at, ai_decision_reply=ai_decision_reply)
            except Exception as e:
                logger.exception("qa_callback_default_reply_send_failed robot_id=%s scene=%s err=%s", robot_id, scene, str(e))
                _insert_message_log(robot_pk, "outbound", scene, str(e), "failed")
                _update_qa_monitor_log(local_log_id, str(e), "failed", time.perf_counter() - started_at, ai_decision_reply=ai_decision_reply)
            return
        _insert_message_log(robot_pk, "outbound", scene, "", "skipped")
        _update_qa_monitor_log(local_log_id, "", "skipped", time.perf_counter() - started_at, ai_decision_reply=ai_decision_reply)
        return

    logger.info(
        "qa_callback_rule_matched robot_id=%s scene=%s rule_id=%s provider_id=%s title_match_type=%s content_match_type=%s title_pattern=%s content_pattern=%s selected_rank=%s",
        robot_id,
        scene,
        selected_rule.get("id"),
        selected_rule.get("provider_id"),
        selected_rule.get("pattern_match_type"),
        selected_rule.get("content_match_type"),
        _short_text(str(selected_rule.get("pattern") or ""), 120),
        _short_text(str(selected_rule.get("content_pattern") or ""), 120),
        selected_rank,
    )
    try:
        provider_type = str(selected_rule.get("provider_type") or "openai").strip().lower()
        provider_name = str(selected_rule.get("provider_name") or "").strip() or None
        if provider_type == "openclaw":
            openclaw_res = await _call_openclaw_webhook(selected_rule, callback_payload)
            reply_text = f"[openclaw passthrough] {str(openclaw_res.get('messageId') or openclaw_res.get('message') or 'accepted')}"
            _insert_message_log(robot_pk, "outbound", scene, reply_text, "success")
            _update_qa_monitor_log(
                local_log_id,
                reply_text,
                "success",
                time.perf_counter() - started_at,
                provider_name=provider_name,
                ai_decision_reply=ai_decision_reply,
            )
            return

        asker_info_mode = _resolve_asker_info_mode(
            selected_rule.get("asker_info_mode"),
            bool(selected_rule.get("include_asker_info")),
        )
        provider_prompt = inbound_text
        provider_payload_extra: Optional[Dict[str, Any]] = None
        context_messages = _load_chat_context_messages(robot_pk, scene, context_session_key, CHAT_CONTEXT_MAX_MESSAGES)
        if scene == "group":
            context_messages = _compact_group_context_messages_for_current_sender(
                context_messages,
                (req.receivedName or "").strip(),
            )
        if not context_messages:
            context_messages = [{"role": "user", "content": inbound_text}]
        provider_context_messages = [{"role": str(x.get("role") or ""), "content": str(x.get("content") or "")} for x in context_messages]
        if is_image_callback:
            image_data_url = _image_data_url_from_base64(image_base64)
            if image_data_url:
                provider_context_messages = provider_context_messages[:-1]
                provider_context_messages.append(
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": inbound_text},
                            {"type": "image_url", "image_url": {"url": image_data_url}},
                        ],
                    }
                )
        current_asker_text = _build_provider_current_asker_text(req, scene)
        colleague_names = _load_group_colleagues_from_robot(robot)
        robot_display_name = await _get_robot_display_name_cached(robot_id)
        if not robot_display_name:
            robot_display_name = str(robot.get("name") or robot.get("robot_id") or "机器人").strip()
        scene_name = "群聊" if scene == "group" else "私聊"
        group_name = (req.groupName or "").strip() if scene == "group" else ""
        sender_name = (req.receivedName or "").strip() or "未知用户"
        history_lines: List[str] = []
        for x in context_messages[-12:]:
            role = str(x.get("role") or "").strip().lower()
            content = str(x.get("content") or "").strip()
            if not content:
                continue
            if role == "assistant":
                history_lines.append(f"AI：{content}")
            else:
                history_lines.append(f"用户：{content}")
        recent_context_text = "\n".join(history_lines) or "（无）"
        colleague_list_text = "，".join([str(x or "").strip() for x in colleague_names if str(x or "").strip()]) or "（无）"
        colleague_line_text = "" if colleague_list_text == "（无）" else f"这些人是你的同事：[{colleague_list_text}]"
        base_system_prompt = ""
        provider_system_template = str(selected_rule.get("system_prompt_template") or "").strip()
        if provider_system_template:
            base_system_prompt = _render_provider_system_prompt_template(
                provider_system_template,
                {
                    "robot_name": robot_display_name,
                    "scene": scene_name,
                    "group_name": group_name or "（无）",
                    "sender_name": sender_name,
                    "current_asker": current_asker_text,
                    "last_message": (inbound_text or "").strip(),
                    "colleague_line": colleague_line_text,
                    "colleague_list": colleague_list_text,
                    "recent_context": recent_context_text,
                },
            )[:12000]
        if asker_info_mode in {"system_prompt", "variables"}:
            if asker_info_mode == "system_prompt":
                messages = []
                if base_system_prompt:
                    messages.append({"role": "system", "content": base_system_prompt})
                messages.append({"role": "system", "content": _build_provider_system_prompt(robot_display_name, colleague_names, current_asker_text)})
                messages.extend(provider_context_messages)
                provider_payload_extra = {
                    "messages": messages
                }
            else:
                provider_payload_extra = {
                    "messages": provider_context_messages,
                    "variables": {
                        "prompt_inject": _build_provider_prompt_inject(robot_display_name, colleague_names, current_asker_text),
                    }
                }
        else:
            messages = []
            if base_system_prompt:
                messages.append({"role": "system", "content": base_system_prompt})
            messages.extend(provider_context_messages)
            provider_payload_extra = {"messages": messages}
        reply_text = await _call_provider(selected_rule, provider_prompt, provider_payload_extra)
        await _send_worktool_text(robot_id, scene, req, reply_text)
        _insert_message_log(robot_pk, "outbound", scene, reply_text, "success")
        _append_chat_context_message(
            robot_pk,
            scene,
            context_session_key,
            "assistant",
            reply_text,
            sender_name=None,
            message_id=callback_message_id,
        )
        _update_qa_monitor_log(
            local_log_id,
            reply_text,
            "success",
            time.perf_counter() - started_at,
            provider_name=provider_name,
            ai_decision_reply=ai_decision_reply,
        )
        return
    except Exception as e:
        logger.exception(
            "qa_callback_provider_failed robot_id=%s scene=%s rule_id=%s provider_id=%s err=%s",
            robot_id,
            scene,
            selected_rule.get("id"),
            selected_rule.get("provider_id"),
            str(e),
        )
        _insert_message_log(robot_pk, "outbound", scene, str(e), "failed")
        provider_type = str(selected_rule.get("provider_type") or "openai").strip().lower()
        provider_name = str(selected_rule.get("provider_name") or "").strip() or None
        if provider_type == "openclaw":
            _update_qa_monitor_log(
                local_log_id,
                str(e),
                "failed",
                time.perf_counter() - started_at,
                provider_name=provider_name,
                ai_decision_reply=ai_decision_reply,
            )
            return
        default_reply = _load_default_reply(robot_pk, scene)
        if default_reply:
            logger.info("qa_callback_fallback_default_reply robot_id=%s scene=%s", robot_id, scene)
            try:
                await _send_worktool_text(robot_id, scene, req, default_reply)
                _insert_message_log(robot_pk, "outbound", scene, default_reply, "success")
                _append_chat_context_message(
                    robot_pk,
                    scene,
                    context_session_key,
                    "assistant",
                    default_reply,
                    sender_name=None,
                    message_id=callback_message_id,
                )
                _update_qa_monitor_log(
                    local_log_id,
                    default_reply,
                    "success",
                    time.perf_counter() - started_at,
                    provider_name=provider_name,
                    ai_decision_reply=ai_decision_reply,
                )
            except Exception as e2:
                logger.exception("qa_callback_fallback_send_failed robot_id=%s scene=%s err=%s", robot_id, scene, str(e2))
                _insert_message_log(robot_pk, "outbound", scene, str(e2), "failed")
                _update_qa_monitor_log(
                    local_log_id,
                    str(e2),
                    "failed",
                    time.perf_counter() - started_at,
                    provider_name=provider_name,
                    ai_decision_reply=ai_decision_reply,
                )
            return
        _update_qa_monitor_log(
            local_log_id,
            str(e),
            "failed",
            time.perf_counter() - started_at,
            provider_name=provider_name,
            ai_decision_reply=ai_decision_reply,
        )
        return


async def _qa_callback_worker_loop(worker_no: int) -> None:
    global _qa_callback_queue
    while True:
        if _qa_callback_queue is None:
            await asyncio.sleep(0.1)
            continue
        task = await _qa_callback_queue.get()
        try:
            await _process_qa_callback_task(**task)
        except Exception as e:
            logger.exception("qa_callback_worker_failed worker=%s err=%s", worker_no, str(e))
        finally:
            _qa_callback_queue.task_done()


@app.post("/api/v1/callback/qa/{robot_id}", response_model=QAResponse)
async def qa_callback(robot_id: str, req: QARequest, request: Request) -> QAResponse:
    robot = _get_robot_by_id_or_404(robot_id)
    robot_pk = int(robot["id"])
    try:
        raw_payload = await request.json()
    except Exception:
        raw_payload = {}
    if not isinstance(raw_payload, dict):
        raw_payload = {}
    # Name normalization rule: prefer remark when available for both groups and private chats.
    req.groupName = _resolve_callback_group_name(req, raw_payload) or None
    req.receivedName = _resolve_callback_received_name(req, raw_payload)
    scene = _scene_from_room_type(req.roomType)
    inbound_text = _pick_inbound_text(req)
    match_target = _rule_match_target(scene, req)
    callback_message_id = _pick_message_id(req)
    callback_payload: Dict[str, Any] = dict(raw_payload)
    callback_payload.setdefault("spoken", req.spoken)
    callback_payload.setdefault("rawSpoken", req.rawSpoken)
    callback_payload.setdefault("receivedName", req.receivedName)
    callback_payload.setdefault("groupName", req.groupName)
    callback_payload.setdefault("roomType", req.roomType)
    callback_payload.setdefault("atMe", req.atMe)
    callback_payload.setdefault("textType", req.textType)
    callback_payload.setdefault("fileBase64", req.fileBase64)
    callback_payload.setdefault("messageId", req.messageId)

    # Ignore payloads without textType, and image callbacks without fileBase64.
    raw_text_type = raw_payload.get("textType") if isinstance(raw_payload, dict) else None
    has_text_type = raw_text_type is not None and str(raw_text_type).strip() != ""
    text_type = int(req.textType or 0)
    has_file_base64 = bool(str((raw_payload.get("fileBase64") if isinstance(raw_payload, dict) else "") or "").strip())
    if (not has_text_type) or (text_type == 2 and not has_file_base64):
        logger.info(
            "qa_callback_text_type_ignored robot_id=%s robot_pk=%s scene=%s room_type=%s text_type=%s has_text_type=%s has_file_base64=%s message_id=%s",
            robot_id,
            robot_pk,
            scene,
            req.roomType,
            req.textType,
            has_text_type,
            has_file_base64,
            callback_message_id or "-",
        )
        return QAResponse(code=0, message="参数接收成功")

    if _is_duplicate_qa_callback(robot_pk, req, inbound_text):
        logger.info(
            "qa_callback_duplicate_ignored robot_id=%s robot_pk=%s scene=%s room_type=%s message_id=%s match_target=%s text=%s",
            robot_id,
            robot_pk,
            scene,
            req.roomType,
            callback_message_id or "-",
            _short_text(match_target, 120),
            _short_text(inbound_text, 200),
        )
        return QAResponse(code=0, message="参数接收成功")

    callback_url = str(request.url)
    local_log_id = _insert_qa_monitor_log(robot_pk, req, inbound_text, str(request.url))
    logger.info(
        "qa_callback_received robot_id=%s robot_pk=%s scene=%s room_type=%s at_me=%s message_id=%s match_target=%s text=%s",
        robot_id,
        robot_pk,
        scene,
        req.roomType,
        req.atMe,
        callback_message_id or "-",
        _short_text(match_target, 120),
        _short_text(inbound_text, 200),
    )
    if _qa_callback_queue is None:
        logger.warning("qa_callback_queue_not_ready robot_id=%s", robot_id)
        _update_qa_monitor_log(local_log_id, "qa callback queue not ready", "failed", 0)
        return QAResponse(code=0, message="参数接收成功")
    task = {
        "robot_id": robot_id,
        "req_payload": req.dict(),
        "callback_url": callback_url,
        "callback_payload": callback_payload,
        "local_log_id": int(local_log_id),
    }
    try:
        _qa_callback_queue.put_nowait(task)
    except asyncio.QueueFull:
        logger.warning("qa_callback_queue_full robot_id=%s robot_pk=%s", robot_id, robot_pk)
        _update_qa_monitor_log(local_log_id, "qa callback queue full", "failed", 0)
    return QAResponse(code=0, message="参数接收成功")




@app.get("/api/v1/worktool/raw-commands")
async def get_worktool_raw_commands(
    robot_id: str,
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    sort: str = "create_time,desc",
    message_id: str = "",
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_robot_access(int(user["id"]), robot_id)
    params: Dict[str, Any] = {"robotId": robot_id, "page": page, "size": size, "sort": sort}
    mid = (message_id or "").strip()
    if mid:
        params["messageId"] = mid
    return await fetch_worktool_api("/wework/listRawMessage", params)


@app.get("/api/v1/worktool/raw-command-results")
async def get_worktool_raw_command_results(
    robot_id: str,
    page: int = Query(default=1, ge=1),
    size: int = Query(default=100, ge=1, le=200),
    sort: str = "run_time,desc",
    message_id: str = "",
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_robot_access(int(user["id"]), robot_id)
    params: Dict[str, Any] = {"robotId": robot_id, "page": page, "size": size, "sort": sort}
    mid = (message_id or "").strip()
    if mid:
        params["messageId"] = mid
    return await fetch_worktool_api("/robot/rawMsg/list", params)


@app.post("/api/v1/worktool/command-backlog/notice")
async def notice_worktool_command_backlog(
    body: CommandBacklogNoticeRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    uid = int(user["id"])
    robot_id = (body.robot_id or "").strip()
    if not robot_id:
        raise HTTPException(status_code=400, detail="robot_id required")
    _require_robot_access(uid, robot_id)

    pending_overdue_count = int(body.pending_overdue_count or 0)
    oldest_pending_dt = _parse_datetime_or_none(body.oldest_pending_time, raise_on_invalid=False)
    newest_result_dt = _parse_datetime_or_none(body.newest_result_time, raise_on_invalid=False) if body.newest_result_time else None
    if pending_overdue_count <= 0 or not oldest_pending_dt:
        return {"warned": False, "reason": "no_overdue_pending"}

    today_local = datetime.now().strftime("%Y-%m-%d")
    system_ref = f"{robot_id}:{today_local}:{uid}"
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1
                FROM inbox_deliveries d
                JOIN inbox_messages m ON m.id=d.message_id
                WHERE d.user_id=%s AND m.system_key='robot_command_backlog' AND m.system_ref=%s
                LIMIT 1
                """,
                (uid, system_ref),
            )
            if cur.fetchone():
                return {"warned": False, "reason": "already_warned_today", "pending_overdue_count": pending_overdue_count}

        pending_minutes = max(int((datetime.utcnow() - oldest_pending_dt).total_seconds() // 60), 0)
        newest_result_text = newest_result_dt.strftime('%Y-%m-%d %H:%M:%S') if newest_result_dt else "-"
        _create_system_inbox_message(
            conn,
            title=f"机器人 {robot_id} 指令执行可能积压",
            content=(
                f"超过5分钟仍待执行的指令数量：{pending_overdue_count}。"
                f"最早待执行时间：{oldest_pending_dt.strftime('%Y-%m-%d %H:%M:%S')}（约 {pending_minutes} 分钟）。"
                f"最近执行结果时间：{newest_result_text}。"
                "建议检查机器人在线状态、客户端网络和任务负载。"
            ),
            level="warning",
            user_ids=[uid],
            system_key="robot_command_backlog",
            system_ref=system_ref,
            expire_at=datetime.utcnow() + timedelta(days=30),
        )
        conn.commit()
        return {"warned": True, "reason": "created", "pending_overdue_count": pending_overdue_count}
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.warning("command_backlog_notice_failed user_id=%s robot_id=%s err=%s", uid, robot_id, str(e))
        return {"warned": False, "reason": "error", "pending_overdue_count": pending_overdue_count}
    finally:
        conn.close()


@app.get("/api/v1/worktool/qa-logs")
async def get_worktool_qa_logs(
    robot_id: str,
    page: int = 1,
    size: int = 20,
    sort: str = "start_time,desc",
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_robot_access(int(user["id"]), robot_id)
    return await fetch_worktool_api("/robot/qaLog/list", {"robotId": robot_id, "page": page, "size": size, "sort": sort})


@app.get("/api/v1/group-tags")
async def list_group_tags(
    robot_id: str,
    keyword: str = "",
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    kw = (keyword or "").strip()
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            if kw:
                like = f"%{kw}%"
                cur.execute(
                    """
                    SELECT t.id,t.name,t.created_at,t.updated_at,COUNT(i.id) AS item_count
                    FROM group_tags t
                    LEFT JOIN group_tag_items i ON i.tag_id=t.id
                    WHERE t.created_by=%s AND t.robot_pk=%s AND t.name LIKE %s
                    GROUP BY t.id,t.name,t.created_at,t.updated_at
                    ORDER BY t.updated_at DESC,t.id DESC
                    """,
                    (int(user["id"]), int(robot["id"]), like),
                )
            else:
                cur.execute(
                    """
                    SELECT t.id,t.name,t.created_at,t.updated_at,COUNT(i.id) AS item_count
                    FROM group_tags t
                    LEFT JOIN group_tag_items i ON i.tag_id=t.id
                    WHERE t.created_by=%s AND t.robot_pk=%s
                    GROUP BY t.id,t.name,t.created_at,t.updated_at
                    ORDER BY t.updated_at DESC,t.id DESC
                    """,
                    (int(user["id"]), int(robot["id"])),
                )
            rows = cur.fetchall() or []
    finally:
        conn.close()
    return {
        "items": [
            {
                "id": int(r["id"]),
                "name": str(r.get("name") or ""),
                "item_count": int(r.get("item_count") or 0),
                "created_at": str(r.get("created_at") or ""),
                "updated_at": str(r.get("updated_at") or ""),
            }
            for r in rows
        ]
    }


@app.post("/api/v1/group-tags")
async def create_group_tag(
    body: GroupTagCreateRequest,
    robot_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    _reject_demo_robot_write(robot_id, "标签库", user=user)
    name = _normalize_group_tag_name(body.name)
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO group_tags(created_by,robot_pk,name) VALUES(%s,%s,%s)",
                    (int(user["id"]), int(robot["id"]), name),
                )
            except pymysql.err.IntegrityError:
                raise HTTPException(status_code=400, detail="标签名已存在")
            tag_id = int(cur.lastrowid)
            cur.execute("SELECT id,name,created_at,updated_at FROM group_tags WHERE id=%s LIMIT 1", (tag_id,))
            row = cur.fetchone() or {}
        conn.commit()
    finally:
        conn.close()
    return {
        "id": int(row.get("id") or tag_id),
        "name": str(row.get("name") or name),
        "item_count": 0,
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at") or ""),
    }


@app.put("/api/v1/group-tags/{tag_id}")
async def update_group_tag(
    tag_id: int,
    body: GroupTagUpdateRequest,
    robot_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    _reject_demo_robot_write(robot_id, "标签库", user=user)
    name = _normalize_group_tag_name(body.name)
    _get_group_tag_or_404(int(tag_id), int(user["id"]), int(robot["id"]))
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "UPDATE group_tags SET name=%s WHERE id=%s AND created_by=%s AND robot_pk=%s",
                    (name, int(tag_id), int(user["id"]), int(robot["id"])),
                )
            except pymysql.err.IntegrityError:
                raise HTTPException(status_code=400, detail="标签名已存在")
            if int(cur.rowcount or 0) <= 0:
                raise HTTPException(status_code=404, detail="标签不存在")
            cur.execute(
                """
                SELECT t.id,t.name,t.created_at,t.updated_at,COUNT(i.id) AS item_count
                FROM group_tags t
                LEFT JOIN group_tag_items i ON i.tag_id=t.id
                WHERE t.id=%s AND t.created_by=%s AND t.robot_pk=%s
                GROUP BY t.id,t.name,t.created_at,t.updated_at
                LIMIT 1
                """,
                (int(tag_id), int(user["id"]), int(robot["id"])),
            )
            row = cur.fetchone() or {}
        conn.commit()
    finally:
        conn.close()
    return {
        "id": int(row.get("id") or tag_id),
        "name": str(row.get("name") or name),
        "item_count": int(row.get("item_count") or 0),
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at") or ""),
    }


@app.delete("/api/v1/group-tags/{tag_id}")
async def delete_group_tag(tag_id: int, robot_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    _reject_demo_robot_write(robot_id, "标签库", user=user)
    _get_group_tag_or_404(int(tag_id), int(user["id"]), int(robot["id"]))
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM group_tags WHERE id=%s AND created_by=%s AND robot_pk=%s",
                (int(tag_id), int(user["id"]), int(robot["id"])),
            )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/api/v1/group-tags/{tag_id}/items")
async def list_group_tag_items(
    tag_id: int,
    robot_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    _get_group_tag_or_404(int(tag_id), int(user["id"]), int(robot["id"]))
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(1) AS c FROM group_tag_items WHERE tag_id=%s", (int(tag_id),))
            total = int((cur.fetchone() or {}).get("c") or 0)
            offset = (page - 1) * page_size
            cur.execute(
                """
                SELECT id,target_type,match_type,value,created_at,updated_at
                FROM group_tag_items
                WHERE tag_id=%s
                ORDER BY updated_at DESC,id DESC
                LIMIT %s OFFSET %s
                """,
                (int(tag_id), int(page_size), int(offset)),
            )
            rows = cur.fetchall() or []
    finally:
        conn.close()
    return {
        "items": [
            {
                "id": int(r["id"]),
                "target_type": str(r.get("target_type") or "group"),
                "match_type": str(r.get("match_type") or "exact"),
                "value": str(r.get("value") or ""),
                "created_at": str(r.get("created_at") or ""),
                "updated_at": str(r.get("updated_at") or ""),
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@app.post("/api/v1/group-tags/{tag_id}/items")
async def create_group_tag_items(
    tag_id: int,
    body: GroupTagItemCreateRequest,
    robot_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    _reject_demo_robot_write(robot_id, "标签库", user=user)
    _get_group_tag_or_404(int(tag_id), int(user["id"]), int(robot["id"]))
    values = _normalize_group_tag_values(body.values or [])
    match_type = (body.match_type or "exact").strip().lower()
    if match_type not in {"exact", "regex"}:
        raise HTTPException(status_code=400, detail="match_type 仅支持 exact/regex")
    conn = db_conn()
    created = 0
    try:
        with conn.cursor() as cur:
            for v in values:
                cur.execute(
                    """
                    INSERT INTO group_tag_items(tag_id,target_type,match_type,value)
                    VALUES(%s,'group',%s,%s)
                    ON DUPLICATE KEY UPDATE value=VALUES(value)
                    """,
                    (int(tag_id), match_type, v),
                )
                if int(cur.rowcount or 0) > 0:
                    created += 1
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "created": created}


@app.delete("/api/v1/group-tags/{tag_id}/items/{item_id}")
async def delete_group_tag_item(
    tag_id: int,
    item_id: int,
    robot_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    _reject_demo_robot_write(robot_id, "标签库", user=user)
    _get_group_tag_or_404(int(tag_id), int(user["id"]), int(robot["id"]))
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM group_tag_items WHERE id=%s AND tag_id=%s", (int(item_id), int(tag_id)))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/api/v1/group-tags/group-suggestions")
async def group_tag_group_suggestions(
    robot_id: str,
    keyword: str = "",
    limit: int = Query(default=20, ge=1, le=100),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    kw = (keyword or "").strip()
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            if kw:
                like = f"%{kw}%"
                cur.execute(
                    """
                    SELECT group_name
                    FROM robot_group_cache
                    WHERE robot_pk=%s AND group_name LIKE %s
                    ORDER BY synced_at DESC,id DESC
                    LIMIT %s
                    """,
                    (int(robot["id"]), like, int(limit)),
                )
            else:
                cur.execute(
                    """
                    SELECT group_name
                    FROM robot_group_cache
                    WHERE robot_pk=%s
                    ORDER BY synced_at DESC,id DESC
                    LIMIT %s
                    """,
                    (int(robot["id"]), int(limit)),
                )
            rows = cur.fetchall() or []
    finally:
        conn.close()
    options: List[str] = []
    seen: Set[str] = set()
    for row in rows:
        val = str(row.get("group_name") or "").strip()
        if not val or val in seen:
            continue
        seen.add(val)
        options.append(val)
    return {"items": options}


@app.post("/api/v1/tasks/dispatch")
async def dispatch_task_command(body: TaskDispatchRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    robot_id = (body.robot_id or "").strip()
    if not robot_id:
        raise HTTPException(status_code=400, detail="robot_id 不能为空")
    payload = body.model_dump()
    payload.pop("robot_id", None)
    payload.pop("action", None)
    return await _dispatch_task_action_internal(int(user["id"]), robot_id, body.action, payload)


def _get_scheduled_task_or_404(task_id: int, user_id: int, robot_pk: Optional[int] = None) -> Dict[str, Any]:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            if robot_pk is None:
                cur.execute(
                    "SELECT st.*,r.robot_id FROM scheduled_tasks st JOIN robots r ON r.id=st.robot_pk WHERE st.id=%s AND st.created_by=%s LIMIT 1",
                    (int(task_id), int(user_id)),
                )
            else:
                cur.execute(
                    "SELECT st.*,r.robot_id FROM scheduled_tasks st JOIN robots r ON r.id=st.robot_pk WHERE st.id=%s AND st.created_by=%s AND st.robot_pk=%s LIMIT 1",
                    (int(task_id), int(user_id), int(robot_pk)),
                )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="定时任务不存在")
            return row
    finally:
        conn.close()


def _normalize_scheduled_task_fields(
    schedule_type: str,
    *,
    run_at: Optional[str],
    daily_time: Optional[str],
    weekly_days: Optional[List[int]],
    cron_expr: Optional[str],
) -> Dict[str, Any]:
    st = (schedule_type or "").strip().lower()
    if st not in {"once", "daily", "weekly", "cron"}:
        raise HTTPException(status_code=400, detail="schedule_type 非法")
    out: Dict[str, Any] = {
        "schedule_type": st,
        "run_at": None,
        "daily_time": None,
        "weekly_days": None,
        "cron_expr": None,
    }
    if st == "once":
        dt = _parse_datetime_or_none(run_at, raise_on_invalid=True)
        if dt is None:
            raise HTTPException(status_code=400, detail="run_at 不能为空")
        out["run_at"] = dt.strftime("%Y-%m-%d %H:%M:%S")
    elif st == "daily":
        out["daily_time"] = _parse_hms_or_400(daily_time)
    elif st == "weekly":
        out["daily_time"] = _parse_hms_or_400(daily_time)
        days = _normalize_weekly_days_or_400(weekly_days or [])
        out["weekly_days"] = ",".join([str(x) for x in days])
    elif st == "cron":
        expr = str(cron_expr or "").strip()
        if not expr:
            raise HTTPException(status_code=400, detail="cron_expr 不能为空")
        _next_cron_datetime(expr, datetime.now())
        out["cron_expr"] = expr
    out["next_run_at"] = _compute_next_run_at_by_rule(
        st,
        run_at=out["run_at"],
        daily_time=out["daily_time"],
        weekly_days=out["weekly_days"],
        cron_expr=out["cron_expr"],
    )
    return out


@app.get("/api/v1/scheduled-tasks")
async def list_scheduled_tasks(robot_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT st.*,r.robot_id
                FROM scheduled_tasks st
                JOIN robots r ON r.id=st.robot_pk
                WHERE st.created_by=%s AND st.robot_pk=%s
                ORDER BY st.updated_at DESC, st.id DESC
                """,
                (int(user["id"]), int(robot["id"])),
            )
            rows = cur.fetchall() or []
    finally:
        conn.close()
    return {"items": [_serialize_scheduled_task(x) for x in rows]}


@app.post("/api/v1/scheduled-tasks")
async def create_scheduled_task(body: ScheduledTaskCreateRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), body.robot_id)
    _reject_demo_robot_write(body.robot_id, "定时任务", user=user)
    name = str(body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name 不能为空")
    if len(name) > 128:
        raise HTTPException(status_code=400, detail="name 长度不能超过128")
    schedule = _normalize_scheduled_task_fields(
        body.schedule_type,
        run_at=body.run_at,
        daily_time=body.daily_time,
        weekly_days=body.weekly_days,
        cron_expr=body.cron_expr,
    )
    payload_json = body.payload_json if isinstance(body.payload_json, dict) else {}
    tz = str(body.timezone or "Asia/Shanghai").strip() or "Asia/Shanghai"
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO scheduled_tasks(
                  created_by,robot_pk,name,action,payload_json,schedule_type,timezone,run_at,daily_time,weekly_days,cron_expr,misfire_policy,status,next_run_at
                ) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    int(user["id"]),
                    int(robot["id"]),
                    name,
                    body.action,
                    json.dumps(payload_json, ensure_ascii=False),
                    schedule["schedule_type"],
                    tz,
                    schedule["run_at"],
                    schedule["daily_time"],
                    schedule["weekly_days"],
                    schedule["cron_expr"],
                    body.misfire_policy,
                    body.status,
                    schedule["next_run_at"].strftime("%Y-%m-%d %H:%M:%S") if schedule.get("next_run_at") else None,
                ),
            )
            task_id = int(cur.lastrowid)
            cur.execute(
                "SELECT st.*,r.robot_id FROM scheduled_tasks st JOIN robots r ON r.id=st.robot_pk WHERE st.id=%s LIMIT 1",
                (task_id,),
            )
            row = cur.fetchone() or {}
        conn.commit()
    finally:
        conn.close()
    return _serialize_scheduled_task(row)


@app.put("/api/v1/scheduled-tasks/{task_id}")
async def update_scheduled_task(task_id: int, body: ScheduledTaskUpdateRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    current = _get_scheduled_task_or_404(int(task_id), int(user["id"]))
    _reject_demo_robot_write(str(current.get("robot_id") or ""), "定时任务", user=user)
    next_schedule_type = body.schedule_type or str(current.get("schedule_type") or "once")
    next_run_at_raw = body.run_at if body.run_at is not None else str(current.get("run_at") or "")
    next_daily_time = body.daily_time if body.daily_time is not None else str(current.get("daily_time") or "")
    cur_weekly = [int(x) for x in re.split(r"[,\s]+", str(current.get("weekly_days") or "").strip()) if x.strip()]
    next_weekly_days = body.weekly_days if body.weekly_days is not None else cur_weekly
    next_cron_expr = body.cron_expr if body.cron_expr is not None else str(current.get("cron_expr") or "")
    schedule = _normalize_scheduled_task_fields(
        next_schedule_type,
        run_at=next_run_at_raw,
        daily_time=next_daily_time,
        weekly_days=next_weekly_days,
        cron_expr=next_cron_expr,
    )
    next_name = (body.name if body.name is not None else str(current.get("name") or "")).strip()
    if not next_name:
        raise HTTPException(status_code=400, detail="name 不能为空")
    next_action = body.action if body.action is not None else str(current.get("action") or "")
    next_payload = body.payload_json if body.payload_json is not None else _parse_json_object(current.get("payload_json"))
    next_tz = (body.timezone if body.timezone is not None else str(current.get("timezone") or "Asia/Shanghai")).strip() or "Asia/Shanghai"
    next_policy = body.misfire_policy if body.misfire_policy is not None else str(current.get("misfire_policy") or "skip")
    next_status = body.status if body.status is not None else str(current.get("status") or "draft")

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE scheduled_tasks
                SET name=%s,action=%s,payload_json=%s,schedule_type=%s,timezone=%s,run_at=%s,daily_time=%s,weekly_days=%s,cron_expr=%s,misfire_policy=%s,status=%s,next_run_at=%s,version=version+1
                WHERE id=%s AND created_by=%s
                """,
                (
                    next_name,
                    next_action,
                    json.dumps(next_payload if isinstance(next_payload, dict) else {}, ensure_ascii=False),
                    schedule["schedule_type"],
                    next_tz,
                    schedule["run_at"],
                    schedule["daily_time"],
                    schedule["weekly_days"],
                    schedule["cron_expr"],
                    next_policy,
                    next_status,
                    schedule["next_run_at"].strftime("%Y-%m-%d %H:%M:%S") if schedule.get("next_run_at") else None,
                    int(task_id),
                    int(user["id"]),
                ),
            )
            cur.execute(
                "SELECT st.*,r.robot_id FROM scheduled_tasks st JOIN robots r ON r.id=st.robot_pk WHERE st.id=%s LIMIT 1",
                (int(task_id),),
            )
            row = cur.fetchone() or {}
        conn.commit()
    finally:
        conn.close()
    return _serialize_scheduled_task(row)


@app.delete("/api/v1/scheduled-tasks/{task_id}")
async def delete_scheduled_task(task_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    row = _get_scheduled_task_or_404(int(task_id), int(user["id"]))
    _reject_demo_robot_write(str(row.get("robot_id") or ""), "定时任务", user=user)
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM scheduled_tasks WHERE id=%s AND created_by=%s", (int(task_id), int(user["id"])))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.post("/api/v1/scheduled-tasks/{task_id}/enable")
async def enable_scheduled_task(task_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    row = _get_scheduled_task_or_404(int(task_id), int(user["id"]))
    _reject_demo_robot_write(str(row.get("robot_id") or ""), "定时任务", user=user)
    schedule = _normalize_scheduled_task_fields(
        str(row.get("schedule_type") or "once"),
        run_at=str(row.get("run_at") or ""),
        daily_time=str(row.get("daily_time") or ""),
        weekly_days=[int(x) for x in re.split(r"[,\s]+", str(row.get("weekly_days") or "").strip()) if x.strip()],
        cron_expr=str(row.get("cron_expr") or ""),
    )
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE scheduled_tasks SET status='enabled',next_run_at=%s,version=version+1 WHERE id=%s AND created_by=%s",
                (
                    schedule["next_run_at"].strftime("%Y-%m-%d %H:%M:%S") if schedule.get("next_run_at") else None,
                    int(task_id),
                    int(user["id"]),
                ),
            )
            cur.execute(
                "SELECT st.*,r.robot_id FROM scheduled_tasks st JOIN robots r ON r.id=st.robot_pk WHERE st.id=%s LIMIT 1",
                (int(task_id),),
            )
            out = cur.fetchone() or {}
        conn.commit()
    finally:
        conn.close()
    return _serialize_scheduled_task(out)


@app.post("/api/v1/scheduled-tasks/{task_id}/pause")
async def pause_scheduled_task(task_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    row = _get_scheduled_task_or_404(int(task_id), int(user["id"]))
    _reject_demo_robot_write(str(row.get("robot_id") or ""), "定时任务", user=user)
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE scheduled_tasks SET status='paused',version=version+1 WHERE id=%s AND created_by=%s",
                (int(task_id), int(user["id"])),
            )
            cur.execute(
                "SELECT st.*,r.robot_id FROM scheduled_tasks st JOIN robots r ON r.id=st.robot_pk WHERE st.id=%s LIMIT 1",
                (int(task_id),),
            )
            out = cur.fetchone() or {}
        conn.commit()
    finally:
        conn.close()
    return _serialize_scheduled_task(out)


@app.post("/api/v1/scheduled-tasks/{task_id}/run-now")
async def run_scheduled_task_now(task_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    row = _get_scheduled_task_or_404(int(task_id), int(user["id"]))
    _reject_demo_robot_write(str(row.get("robot_id") or ""), "定时任务", user=user)
    planned = datetime.now().replace(microsecond=0)
    idem = f"task:{int(task_id)}:{planned.strftime('%Y%m%d%H%M%S')}:manual"
    conn = db_conn()
    run_id = 0
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO scheduled_task_runs(task_id,planned_at,status,idempotency_key)
                VALUES(%s,%s,'running',%s)
                """,
                (int(task_id), planned.strftime("%Y-%m-%d %H:%M:%S"), idem),
            )
            run_id = int(cur.lastrowid)
        conn.commit()
    finally:
        conn.close()
    try:
        payload = _serialize_scheduled_task(row).get("payload_json") or {}
        res = await _dispatch_task_action_internal(int(user["id"]), str(row.get("robot_id") or ""), str(row.get("action") or ""), payload)
        conn2 = db_conn()
        try:
            with conn2.cursor() as cur:
                cur.execute(
                    "UPDATE scheduled_task_runs SET status='success',finished_at=CURRENT_TIMESTAMP,result_json=%s WHERE id=%s",
                    (json.dumps(res, ensure_ascii=False), int(run_id)),
                )
            conn2.commit()
        finally:
            conn2.close()
        return {"ok": True, "run_id": run_id, "result": res}
    except Exception as e:
        conn3 = db_conn()
        try:
            with conn3.cursor() as cur:
                cur.execute(
                    "UPDATE scheduled_task_runs SET status='failed',finished_at=CURRENT_TIMESTAMP,error_text=%s WHERE id=%s",
                    (str(e)[:1000], int(run_id)),
                )
            conn3.commit()
        finally:
            conn3.close()
        raise


@app.get("/api/v1/scheduled-tasks/{task_id}/runs")
async def list_scheduled_task_runs(
    task_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _get_scheduled_task_or_404(int(task_id), int(user["id"]))
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(1) AS c FROM scheduled_task_runs WHERE task_id=%s", (int(task_id),))
            total = int((cur.fetchone() or {}).get("c") or 0)
            off = (page - 1) * page_size
            cur.execute(
                """
                SELECT *
                FROM scheduled_task_runs
                WHERE task_id=%s
                ORDER BY id DESC
                LIMIT %s OFFSET %s
                """,
                (int(task_id), int(page_size), int(off)),
            )
            rows = cur.fetchall() or []
    finally:
        conn.close()
    return {
        "items": [
            {
                "id": int(x.get("id") or 0),
                "planned_at": str(x.get("planned_at") or ""),
                "started_at": str(x.get("started_at") or ""),
                "finished_at": str(x.get("finished_at") or ""),
                "status": str(x.get("status") or ""),
                "attempt": int(x.get("attempt") or 1),
                "error_text": str(x.get("error_text") or ""),
                "result_json": _parse_json_object(x.get("result_json")) if x.get("result_json") is not None else None,
                "created_at": str(x.get("created_at") or ""),
            }
            for x in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


async def run_scheduled_tasks_tick(limit: int = 20) -> Dict[str, Any]:
    now_dt = datetime.now().replace(microsecond=0)
    conn = db_conn()
    picked = 0
    done = 0
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT st.*,r.robot_id
                FROM scheduled_tasks st
                JOIN robots r ON r.id=st.robot_pk
                WHERE st.status='enabled' AND st.next_run_at IS NOT NULL AND st.next_run_at<=%s
                ORDER BY st.next_run_at ASC, st.id ASC
                LIMIT %s
                """,
                (now_dt.strftime("%Y-%m-%d %H:%M:%S"), int(limit)),
            )
            tasks = cur.fetchall() or []
        for task in tasks:
            planned_at = task.get("next_run_at")
            version = int(task.get("version") or 0)
            task_id = int(task.get("id") or 0)
            if task_id <= 0 or planned_at is None:
                continue
            picked += 1
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE scheduled_tasks
                    SET version=version+1
                    WHERE id=%s AND status='enabled' AND version=%s
                    """,
                    (task_id, version),
                )
                if int(cur.rowcount or 0) <= 0:
                    continue
            conn.commit()

            planned_s = str(planned_at)
            idem = f"task:{task_id}:{planned_s}"
            run_id = 0
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        """
                        INSERT INTO scheduled_task_runs(task_id,planned_at,status,idempotency_key)
                        VALUES(%s,%s,'running',%s)
                        """,
                        (task_id, planned_s, idem),
                    )
                    run_id = int(cur.lastrowid)
                except pymysql.err.IntegrityError:
                    run_id = 0
            conn.commit()

            next_at = _compute_next_run_at_by_rule(
                str(task.get("schedule_type") or "once"),
                run_at=str(task.get("run_at") or ""),
                daily_time=str(task.get("daily_time") or ""),
                weekly_days=str(task.get("weekly_days") or ""),
                cron_expr=str(task.get("cron_expr") or ""),
                base_dt=planned_at if isinstance(planned_at, datetime) else now_dt,
            )
            execute_now = True
            if str(task.get("misfire_policy") or "skip") == "skip":
                # Default policy: run once only when delay is within 10 minutes; otherwise skip.
                if isinstance(planned_at, datetime) and (now_dt - planned_at).total_seconds() > 600:
                    execute_now = False
            if run_id > 0:
                if execute_now:
                    try:
                        payload = _serialize_scheduled_task(task).get("payload_json") or {}
                        res = await _dispatch_task_action_internal(
                            int(task.get("created_by") or 0),
                            str(task.get("robot_id") or ""),
                            str(task.get("action") or ""),
                            payload,
                        )
                        with conn.cursor() as cur:
                            cur.execute(
                                "UPDATE scheduled_task_runs SET status='success',finished_at=CURRENT_TIMESTAMP,result_json=%s WHERE id=%s",
                                (json.dumps(res, ensure_ascii=False), run_id),
                            )
                    except Exception as e:
                        with conn.cursor() as cur:
                            cur.execute(
                                "UPDATE scheduled_task_runs SET status='failed',finished_at=CURRENT_TIMESTAMP,error_text=%s WHERE id=%s",
                                (str(e)[:1000], run_id),
                            )
                else:
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE scheduled_task_runs SET status='skipped',finished_at=CURRENT_TIMESTAMP,error_text='misfire skipped' WHERE id=%s",
                            (run_id,),
                        )
                conn.commit()

            next_status = str(task.get("status") or "enabled")
            if str(task.get("schedule_type") or "once") == "once" and next_at is None:
                next_status = "paused"
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE scheduled_tasks SET last_run_at=CURRENT_TIMESTAMP,next_run_at=%s,status=%s,version=version+1 WHERE id=%s",
                    (next_at.strftime("%Y-%m-%d %H:%M:%S") if next_at else None, next_status, task_id),
                )
            conn.commit()
            done += 1
    finally:
        conn.close()
    return {"picked": picked, "done": done}


@app.post("/api/v1/groups/sync")
async def sync_groups_cache(robot_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    sync_res = await sync_robot_groups_by_cursor(int(robot["id"]), robot_id)
    return {"ok": True, "robot_id": robot_id, **sync_res}


@app.get("/api/v1/groups")
async def list_groups_cache(
    robot_id: str,
    keyword: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    kw = (keyword or "").strip()
    def _query_local_cache() -> Dict[str, Any]:
        conn_local = db_conn()
        try:
            with conn_local.cursor() as cur:
                where = ["robot_pk=%s"]
                params: List[Any] = [int(robot["id"])]
                if kw:
                    like = f"%{kw}%"
                    where.append("(group_name LIKE %s OR master_name LIKE %s)")
                    params.extend([like, like])
                where_sql = " AND ".join(where)
                cur.execute(f"SELECT COUNT(1) AS c FROM robot_group_cache WHERE {where_sql}", tuple(params))
                total_local = int((cur.fetchone() or {}).get("c") or 0)
                offset = (page - 1) * page_size
                cur.execute(
                    f"""
                    SELECT group_name,master_name,msg_insert_time,msg_num,members_num,group_announcement,level,source_create_time,source_update_time,synced_at
                    FROM robot_group_cache
                    WHERE {where_sql}
                    ORDER BY synced_at DESC, id DESC
                    LIMIT %s OFFSET %s
                    """,
                    tuple(params + [page_size, offset]),
                )
                rows_local = cur.fetchall() or []
                cur.execute("SELECT MAX(synced_at) AS latest_sync_at FROM robot_group_cache WHERE robot_pk=%s", (int(robot["id"]),))
                latest_local = (cur.fetchone() or {}).get("latest_sync_at")
                return {"total": total_local, "rows": rows_local, "latest_sync_at": latest_local}
        finally:
            conn_local.close()

    query_result = _query_local_cache()
    total = int(query_result["total"])
    rows = query_result["rows"]
    latest_sync_at = query_result["latest_sync_at"]

    # 懒加载：首次无缓存时自动同步一次，避免用户必须手动点“立即同步”。
    if total == 0 and latest_sync_at is None:
        try:
            await sync_robot_groups_by_cursor(int(robot["id"]), robot_id)
        except Exception:
            # 同步失败时保持原查询结果，避免读接口直接报错。
            pass
        query_result = _query_local_cache()
        total = int(query_result["total"])
        rows = query_result["rows"]
        latest_sync_at = query_result["latest_sync_at"]

    items: List[Dict[str, Any]] = []
    for row in rows:
        synced_at = row.get("synced_at")
        items.append(
            {
                "group_name": row.get("group_name") or "",
                "master_name": row.get("master_name") or "",
                "msg_insert_time": row.get("msg_insert_time") or "",
                "msg_num": row.get("msg_num"),
                "members_num": row.get("members_num"),
                "group_announcement": row.get("group_announcement") or "",
                "level": row.get("level"),
                "source_create_time": row.get("source_create_time") or "",
                "source_update_time": row.get("source_update_time") or "",
                "synced_at": str(synced_at) if synced_at is not None else "",
            }
        )
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "latest_sync_at": str(latest_sync_at) if latest_sync_at is not None else "",
    }


@app.get("/api/v1/message-monitor/logs")
async def get_message_monitor_logs(
    robot_id: str,
    page: int = 1,
    size: int = 20,
    sort: str = "start_time,desc",
    name: Optional[str] = None,
    scene: str = "all",
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    robot = _require_robot_access(int(user["id"]), robot_id)
    scene = (scene or "all").strip().lower()
    if scene not in {"all", "group", "private"}:
        raise HTTPException(status_code=400, detail="scene must be all/group/private")
    kw = (name or "").strip()
    use_local = await _is_platform_message_callback(robot_id)
    if not use_local:
        res = await fetch_worktool_api(
            "/robot/qaLog/list",
            {"robotId": robot_id, "page": page, "size": size, "sort": sort, "name": kw or None},
        )
        data = (res.get("data") if isinstance(res, dict) else None) or {}
        rows = data.get("list") or []
        if not isinstance(rows, list):
            rows = []
        filtered: List[Dict[str, Any]] = []
        kw_lower = kw.lower()
        for row in rows:
            if not isinstance(row, dict):
                continue
            room_type = int(row.get("roomType") or 0)
            if scene == "group" and room_type not in {1, 3}:
                continue
            if scene == "private" and room_type not in {2, 4}:
                continue
            if kw:
                group_name = str(row.get("groupName") or "")
                received_name = str(row.get("receivedName") or "")
                if kw_lower not in group_name.lower() and kw_lower not in received_name.lower():
                    continue
            filtered.append(row)
        data["list"] = filtered
        data["total"] = len(filtered)
        data["pageNum"] = page
        data["pageSize"] = size
        return {"source": "worktool", "data": data}

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            where_parts = ["q.robot_pk=%s"]
            params: List[Any] = [int(robot["id"])]
            if scene == "group":
                where_parts.append("q.room_type IN (1,3)")
            elif scene == "private":
                where_parts.append("q.room_type IN (2,4)")
            if kw:
                like_kw = f"%{kw}%"
                where_parts.append("(q.group_name LIKE %s OR q.received_name LIKE %s)")
                params.extend([like_kw, like_kw])
            where_sql = " AND ".join(where_parts)
            cur.execute(f"SELECT COUNT(1) AS c FROM qa_monitor_logs q WHERE {where_sql}", tuple(params))
            total = int((cur.fetchone() or {}).get("c") or 0)
            offset = (page - 1) * size
            cur.execute(
                f"""
                SELECT q.id,q.room_type,q.text_type,q.at_me,q.group_name,q.received_name,q.question,q.answer,q.provider_name,q.ai_decision_reply,q.message_id,q.callback_url,q.time_cost,q.created_at
                FROM qa_monitor_logs q
                WHERE {where_sql}
                ORDER BY q.id DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [size, offset]),
            )
            rows = cur.fetchall() or []
            items: List[Dict[str, Any]] = []
            for row in rows:
                created_at = row.get("created_at")
                start_time = created_at.isoformat() if isinstance(created_at, datetime) else str(created_at or "")
                items.append(
                    {
                        "robotId": robot_id,
                        "startTime": start_time,
                        "timeCost": float(row.get("time_cost") or 0),
                        "groupName": row.get("group_name") or "",
                        "receivedName": row.get("received_name") or "",
                        "roomType": int(row.get("room_type") or 0),
                        "textType": int(row.get("text_type") or 1),
                        "openThirdParty": 1,
                        "url": row.get("callback_url") or build_robot_callback_url(robot_id),
                        "rawSpoken": row.get("question") or "",
                        "question": row.get("question") or "",
                        "answer": row.get("answer") or "",
                        "providerName": row.get("provider_name") or "",
                        "aiDecisionReply": None if row.get("ai_decision_reply") is None else bool(row.get("ai_decision_reply")),
                        "messageId": row.get("message_id") or _public_local_message_id(row.get("id")),
                        "atMe": bool(row.get("at_me")),
                    }
                )
            return {
                "source": "local",
                "data": {"list": items, "total": total, "pageNum": page, "pageSize": size},
            }
    finally:
        conn.close()


@app.get("/api/v1/robot-info/detail")
async def get_robot_info_detail(robot_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_robot_access(int(user["id"]), robot_id)
    return await fetch_worktool_api("/robot/robotInfo/get-detail", {"robotId": robot_id})


@app.get("/api/v1/robot-info/callbacks")
async def get_robot_info_callbacks(robot_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_robot_access(int(user["id"]), robot_id)
    return await fetch_worktool_api("/robot/robotInfo/callBack/get", {"robotId": robot_id})


@app.get("/api/v1/robot-info/online")
async def get_robot_info_online(robot_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_robot_access(int(user["id"]), robot_id)
    return await fetch_worktool_api("/robot/robotInfo/online", {"robotId": robot_id})


@app.get("/api/v1/robot-info/online-infos")
async def get_robot_info_online_infos(robot_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_robot_access(int(user["id"]), robot_id)
    return await fetch_worktool_api("/robot/robotInfo/onlineInfos", {"robotId": robot_id})


@app.get("/api/v1/robot-info/version")
async def get_robot_info_version(robot_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_robot_access(int(user["id"]), robot_id)
    return await fetch_worktool_api("/robot/robotInfo/version", {"robotId": robot_id})


@app.post("/api/v1/robot-info/message-callback/test")
async def test_robot_message_callback(body: MessageCallbackPayload, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    rid = (body.robot_id or "").strip()
    _require_robot_access(int(user["id"]), rid)
    _reject_demo_robot_write(rid, "回调地址", user=user)
    callback_url = (body.callback_url or "").strip()
    if not callback_url:
        raise HTTPException(status_code=400, detail="callback_url required")

    payload = {
        "spoken": "您好,欢迎使用WorkTool~",
        "rawSpoken": "@小明 您好,欢迎使用WorkTool~",
        "receivedName": "WorkTool",
        "groupName": "WorkTool",
        "groupRemark": "小明参与的WorkTool",
        "roomType": 1,
        "atMe": "true",
        "textType": 1,
        "fileBase64": "",
    }
    timeout = aiohttp.ClientTimeout(total=8)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(callback_url, json=payload, headers={"Content-Type": "application/json"}) as resp:
                raw = await resp.text()
                if resp.status != 200:
                    raise HTTPException(
                        status_code=400,
                        detail=f"测试失败：回调地址返回 HTTP {resp.status}，响应: {_short_text(raw or '', 220)}",
                    )
                return {
                    "ok": True,
                    "robot_id": body.robot_id,
                    "callback_url": callback_url,
                    "status": resp.status,
                    "response_preview": _short_text(raw or "", 220),
                }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"测试失败：{str(e)}")


@app.post("/api/v1/robot-info/callbacks/test")
async def test_robot_callback(body: CallbackTestPayload, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _ = user
    return {"ok": True, "callback_url": body.callback_url}


@app.post("/api/v1/robot-info/message-callback/bind")
async def bind_robot_message_callback(body: MessageCallbackPayload, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    rid = (body.robot_id or "").strip()
    _require_robot_access(int(user["id"]), rid)
    _reject_demo_robot_write(rid, "回调地址", user=user)
    res = await bind_message_callback(rid, (body.callback_url or "").strip(), int(body.reply_all))
    return {"ok": True, "result": res}


@app.post("/api/v1/robot-info/callbacks/bind")
async def bind_robot_callback(body: RobotCallbackBindPayload, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    rid = (body.robot_id or "").strip()
    _require_robot_access(int(user["id"]), rid)
    _reject_demo_robot_write(rid, "回调地址", user=user)
    res = await bind_callback_by_type(rid, (body.callback_url or "").strip(), int(body.type))
    return {"ok": True, "type": body.type, "result": res}


@app.post("/api/v1/robot-info/callbacks/delete-by-type")
async def delete_robot_callback(body: RobotCallbackDeletePayload, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    rid = (body.robot_id or "").strip()
    _require_robot_access(int(user["id"]), rid)
    _reject_demo_robot_write(rid, "回调地址", user=user)
    result = await delete_callback_by_type(rid, int(body.type))
    return {"ok": True, "robot_id": rid, "type": int(body.type), "result": result}


@app.post("/api/v1/troubleshoot/search")
async def troubleshoot_search(body: TroubleshootSearchPayload, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_admin(user)
    return await run_troubleshoot_search(
        body,
        enable_troubleshoot=ENABLE_TROUBLESHOOT,
        get_worktool_api_base=get_worktool_api_base,
        fetch_worktool_api=fetch_worktool_api,
        db_conn_factory=db_conn,
    )


@app.post("/api/v1/open/troubleshoot/search")
async def open_troubleshoot_search(
    body: TroubleshootSearchPayload,
    x_open_api_key: Optional[str] = Header(None, alias="X-Open-API-Key"),
) -> Dict[str, Any]:
    _require_open_troubleshoot_access(x_open_api_key)
    return await run_troubleshoot_search(
        body,
        enable_troubleshoot=ENABLE_TROUBLESHOOT,
        get_worktool_api_base=get_worktool_api_base,
        fetch_worktool_api=fetch_worktool_api,
        db_conn_factory=db_conn,
        allowed_robot_ids=sorted(OPEN_TROUBLESHOOT_ALLOWED_ROBOT_IDS),
    )


@app.get("/api/v1/admin/inbox/messages")
async def admin_list_inbox_messages(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str = Query(default="all"),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    status_key = (status or "all").strip().lower()
    if status_key not in {"all", "draft", "published", "offline"}:
        raise HTTPException(status_code=400, detail="status must be all/draft/published/offline")
    where = []
    params: List[Any] = []
    if status_key != "all":
        where.append("m.status=%s")
        params.append(status_key)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(1) AS c FROM inbox_messages m {where_sql}", tuple(params))
            total = int((cur.fetchone() or {}).get("c") or 0)
            offset = (page - 1) * page_size
            cur.execute(
                f"""
                SELECT m.*
                FROM inbox_messages m
                {where_sql}
                ORDER BY m.id DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [page_size, offset]),
            )
            rows = cur.fetchall() or []
            items = []
            for x in rows:
                scope = x.get("recipient_scope_json")
                scope_obj = scope if isinstance(scope, dict) else {}
                items.append(
                    {
                        "id": int(x["id"]),
                        "category": x.get("category"),
                        "level": x.get("level"),
                        "title": x.get("title") or "",
                        "content": x.get("content") or "",
                        "recipient_scope": scope_obj,
                        "status": x.get("status"),
                        "publish_at": x.get("publish_at").isoformat() if isinstance(x.get("publish_at"), datetime) else (str(x.get("publish_at") or "") or None),
                        "expire_at": x.get("expire_at").isoformat() if isinstance(x.get("expire_at"), datetime) else (str(x.get("expire_at") or "") or None),
                        "created_by": int(x["created_by"]) if x.get("created_by") is not None else None,
                        "created_at": x.get("created_at").isoformat() if isinstance(x.get("created_at"), datetime) else str(x.get("created_at") or ""),
                        "updated_at": x.get("updated_at").isoformat() if isinstance(x.get("updated_at"), datetime) else str(x.get("updated_at") or ""),
                    }
                )
            return {"items": items, "page": page, "page_size": page_size, "total": total}
    finally:
        conn.close()


@app.post("/api/v1/admin/inbox/messages")
async def admin_create_inbox_message(body: InboxMessageCreate, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_admin(user)
    title = (body.title or "").strip()
    content = (body.content or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    if not content:
        raise HTTPException(status_code=400, detail="content required")
    scope = _normalize_recipient_scope(body.recipient_scope)
    publish_at = _parse_datetime_or_none(body.publish_at, raise_on_invalid=True)
    expire_at = _parse_datetime_or_none(body.expire_at, raise_on_invalid=True)
    if expire_at and publish_at and expire_at <= publish_at:
        raise HTTPException(status_code=400, detail="expire_at must be greater than publish_at")

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO inbox_messages(
                  category,level,title,content,recipient_scope_json,status,publish_at,expire_at,created_by
                ) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    body.category,
                    body.level,
                    title[:255],
                    content,
                    _recipient_scope_json(scope),
                    "published" if bool(body.publish_now) else "draft",
                    publish_at if publish_at else (datetime.utcnow() if bool(body.publish_now) else None),
                    expire_at,
                    int(user["id"]),
                ),
            )
            message_id = int(cur.lastrowid)
            publish_result = {"recipient_count": 0, "new_delivery_count": 0}
            if body.publish_now:
                publish_result = _publish_inbox_message(conn, message_id)
        conn.commit()
        return {"ok": True, "id": message_id, **publish_result}
    finally:
        conn.close()


@app.put("/api/v1/admin/inbox/messages/{message_id}")
async def admin_update_inbox_message(
    message_id: int,
    body: InboxMessageUpdate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    updates: List[str] = []
    params: List[Any] = []
    if body.category is not None:
        updates.append("category=%s")
        params.append(body.category)
    if body.level is not None:
        updates.append("level=%s")
        params.append(body.level)
    if body.title is not None:
        title = (body.title or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="title required")
        updates.append("title=%s")
        params.append(title[:255])
    if body.content is not None:
        content = (body.content or "").strip()
        if not content:
            raise HTTPException(status_code=400, detail="content required")
        updates.append("content=%s")
        params.append(content)
    if body.recipient_scope is not None:
        scope = _normalize_recipient_scope(body.recipient_scope)
        updates.append("recipient_scope_json=%s")
        params.append(_recipient_scope_json(scope))
    if body.publish_at is not None:
        updates.append("publish_at=%s")
        params.append(_parse_datetime_or_none(body.publish_at, raise_on_invalid=True))
    if body.expire_at is not None:
        updates.append("expire_at=%s")
        params.append(_parse_datetime_or_none(body.expire_at, raise_on_invalid=True))
    if body.status is not None:
        updates.append("status=%s")
        params.append(body.status)
    if not updates:
        return {"ok": True}

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            params.append(int(message_id))
            cur.execute(f"UPDATE inbox_messages SET {', '.join(updates)} WHERE id=%s", tuple(params))
            if cur.rowcount <= 0:
                raise HTTPException(status_code=404, detail="站内信不存在")
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.delete("/api/v1/admin/inbox/messages/{message_id}")
async def admin_delete_inbox_message(message_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_admin(user)
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM inbox_messages WHERE id=%s", (int(message_id),))
            if cur.rowcount <= 0:
                raise HTTPException(status_code=404, detail="站内信不存在")
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.post("/api/v1/admin/inbox/messages/{message_id}/publish")
async def admin_publish_inbox_message(message_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_admin(user)
    conn = db_conn()
    try:
        result = _publish_inbox_message(conn, int(message_id))
        conn.commit()
        return {"ok": True, **result}
    finally:
        conn.close()


@app.post("/api/v1/admin/inbox/messages/{message_id}/offline")
async def admin_offline_inbox_message(message_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_admin(user)
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE inbox_messages SET status='offline' WHERE id=%s", (int(message_id),))
            if cur.rowcount <= 0:
                raise HTTPException(status_code=404, detail="站内信不存在")
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.get("/api/v1/admin/ip-acl/blacklist")
async def admin_ip_acl_blacklist_query(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_admin(user)
    _require_feature_enabled(ENABLE_ADMIN_IP_BLACKLIST, "admin ip blacklist")
    query_path = _require_configured_path(WORKTOOL_IPACL_QUERY_PATH, "WORKTOOL_IPACL_QUERY_PATH")
    raw = await fetch_worktool_api(query_path, {})
    data = raw.get("data") if isinstance(raw, dict) else {}
    if not isinstance(data, dict):
        data = {}
    whitelist = _to_ip_list(data.get("whiteList") or data.get("whitelist") or data.get("white_list"))
    blacklist = _to_ip_list(data.get("blackList") or data.get("blacklist") or data.get("black_list"))
    if whitelist:
        mode = "whitelist_only"
    elif blacklist:
        mode = "blacklist_block"
    else:
        mode = "allow_all"
    return {"mode": mode, "blacklist": blacklist, "blacklist_count": len(blacklist)}


@app.post("/api/v1/admin/ip-acl/blacklist/add")
async def admin_ip_acl_blacklist_add(ip: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_admin(user)
    _require_feature_enabled(ENABLE_ADMIN_IP_BLACKLIST, "admin ip blacklist")
    add_path = _require_configured_path(WORKTOOL_IPACL_ADD_PATH, "WORKTOOL_IPACL_ADD_PATH")
    target_ip = (ip or "").strip()
    if not _is_valid_ip(target_ip):
        raise HTTPException(status_code=400, detail="ip格式不合法")
    res = await post_worktool_api(add_path, {"ip": target_ip, "type": "blacklist"})
    _ensure_worktool_ok(res, "新增黑名单IP")
    return {"ok": True, "ip": target_ip}


@app.post("/api/v1/admin/ip-acl/blacklist/delete")
async def admin_ip_acl_blacklist_delete(ip: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_admin(user)
    _require_feature_enabled(ENABLE_ADMIN_IP_BLACKLIST, "admin ip blacklist")
    delete_path = _require_configured_path(WORKTOOL_IPACL_DELETE_PATH, "WORKTOOL_IPACL_DELETE_PATH")
    target_ip = (ip or "").strip()
    if not _is_valid_ip(target_ip):
        raise HTTPException(status_code=400, detail="ip格式不合法")
    res = await post_worktool_api(delete_path, {"ip": target_ip, "type": "blacklist"})
    _ensure_worktool_ok(res, "删除黑名单IP")
    return {"ok": True, "ip": target_ip}


@app.get("/api/v1/admin/wework/authorization/list")
async def admin_wework_authorization_list(
    corp_id: Optional[str] = None,
    corp_name: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    _require_feature_enabled(ENABLE_ADMIN_ENTERPRISE_AUTH, "admin enterprise auth")
    list_path = _require_configured_path(WORKTOOL_WEWORK_AUTH_LIST_PATH, "WORKTOOL_WEWORK_AUTH_LIST_PATH")
    params: Dict[str, Any] = {}
    if (corp_id or "").strip():
        params["corpId"] = (corp_id or "").strip()
    if (corp_name or "").strip():
        params["corpName"] = (corp_name or "").strip()
    return await fetch_worktool_api(list_path, params)


@app.post("/api/v1/admin/wework/authorization/save")
async def admin_wework_authorization_save(
    body: WeworkAuthorizationSaveRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    _require_feature_enabled(ENABLE_ADMIN_ENTERPRISE_AUTH, "admin enterprise auth")
    save_path = _require_configured_path(WORKTOOL_WEWORK_AUTH_SAVE_PATH, "WORKTOOL_WEWORK_AUTH_SAVE_PATH")
    corp_id = (body.corpId or "").strip()
    if not corp_id:
        raise HTTPException(status_code=400, detail="corpId required")
    payload: Dict[str, Any] = {
        "corpId": corp_id,
        "corpName": (body.corpName or "").strip(),
        "agentId": (body.agentId or "").strip(),
        "isEnabled": bool(body.isEnabled) if body.isEnabled is not None else True,
        "expireTime": _normalize_wework_expire_time(body.expireTime),
        "remark": (body.remark or "").strip(),
    }
    res = await post_worktool_api(save_path, body=payload)
    _ensure_worktool_ok(res, "保存企业授权")
    return res


@app.post("/api/v1/admin/wework/authorization/delete")
async def admin_wework_authorization_delete(corp_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_admin(user)
    _require_feature_enabled(ENABLE_ADMIN_ENTERPRISE_AUTH, "admin enterprise auth")
    delete_path = _require_configured_path(WORKTOOL_WEWORK_AUTH_DELETE_PATH, "WORKTOOL_WEWORK_AUTH_DELETE_PATH")
    target = (corp_id or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="corp_id required")
    return await post_worktool_api(delete_path, {"corpId": target})


def _extract_migrated_robot_id(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    keys = {
        "newRobotId",
        "new_robot_id",
        "robotId",
        "robot_id",
        "targetRobotId",
        "target_robot_id",
        "newId",
        "new_id",
    }
    for key in keys:
        value = str(data.get(key) or "").strip()
        if value:
            return value
    for nested_key in ("data", "result"):
        value = _extract_migrated_robot_id(data.get(nested_key))
        if value:
            return value
    return ""


def _insert_robot_migrate_log(
    user: Dict[str, Any],
    action_key: str,
    action_name: str,
    old_robot_id: str,
    new_robot_id: str,
    worktool_path: str,
    request_payload: Dict[str, Any],
    result_payload: Dict[str, Any],
) -> None:
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO robot_migrate_logs(
                  operator_user_id,operator_phone,action_key,action_name,old_robot_id,new_robot_id,
                  worktool_path,request_json,result_json
                )
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    int(user["id"]) if user.get("id") is not None else None,
                    str(user.get("phone") or "").strip() or None,
                    action_key,
                    action_name,
                    old_robot_id,
                    new_robot_id or None,
                    worktool_path,
                    json.dumps(request_payload, ensure_ascii=False),
                    json.dumps(result_payload, ensure_ascii=False),
                ),
            )
        conn.commit()
    finally:
        conn.close()


def _insert_private_license_log(user: Dict[str, Any], body: PrivateLicenseLogCreateRequest) -> None:
    machine_code = (body.machine_code or "").strip()
    expire_date = (body.expire_date or "").strip()
    robot_start = (body.robot_start or "").strip() or None
    robot_end = (body.robot_end or "").strip() or None
    if not re.fullmatch(r"[0-9a-fA-F]{64}", machine_code):
        raise HTTPException(status_code=400, detail="machine_code invalid")
    if not expire_date:
        raise HTTPException(status_code=400, detail="expire_date required")
    if body.expire_epoch_ms <= 0:
        raise HTTPException(status_code=400, detail="expire_epoch_ms invalid")
    if body.restrict_robot:
        if not robot_start or not robot_end or body.robot_limit is None:
            raise HTTPException(status_code=400, detail="robot scope required")
        if body.robot_limit <= 0:
            raise HTTPException(status_code=400, detail="robot_limit invalid")
    else:
        robot_start = None
        robot_end = None

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO private_license_logs(
                  operator_user_id,operator_phone,machine_code,expire_date,expire_epoch_ms,
                  restrict_robot,robot_start,robot_end,robot_limit
                )
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    int(user["id"]) if user.get("id") is not None else None,
                    str(user.get("phone") or "").strip() or None,
                    machine_code,
                    expire_date,
                    int(body.expire_epoch_ms),
                    1 if body.restrict_robot else 0,
                    robot_start,
                    robot_end,
                    int(body.robot_limit) if body.robot_limit is not None else None,
                ),
            )
        conn.commit()
    finally:
        conn.close()


def _format_worktool_datetime(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value or "")


def _normalize_app_update_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": int(row.get("id") or 0),
        "app_name": row.get("app_name") or "",
        "title": row.get("title") or "",
        "update_log": row.get("update_log") or "",
        "remark": row.get("remark") or "",
        "version_name": row.get("version_name") or "",
        "version_code": row.get("version_code"),
        "min_version_code": row.get("min_version_code"),
        "download_url": row.get("download_url") or "",
        "create_time": _format_worktool_datetime(row.get("create_time")),
        "size": row.get("size") or "",
        "enable": bool(row.get("enable")),
    }


def _version_code_from_name(version_name: str) -> int:
    parts = [int(x) for x in re.findall(r"\d+", version_name or "")]
    if len(parts) >= 4:
        return parts[0] * 10000 + parts[1] * 1000 + parts[2] * 10 + parts[3]
    if parts:
        return int("".join(str(x) for x in parts))
    raise HTTPException(status_code=400, detail="version_name invalid")


def _safe_app_file_part(app_name: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z._-]+", "_", (app_name or "").strip()).strip("._-")
    return cleaned or "app"


def _get_latest_app_update(cur: Any, app_name: str) -> Optional[Dict[str, Any]]:
    cur.execute(
        """
        SELECT id,app_name,title,update_log,remark,version_name,version_code,min_version_code,
               download_url,create_time,size,enable
        FROM app_update
        WHERE app_name=%s
        ORDER BY create_time DESC, id DESC
        LIMIT 1
        """,
        (app_name,),
    )
    return cur.fetchone()


def _public_base_url_from_request(request: Request) -> str:
    configured = normalize_public_base_url(APP_PUBLIC_BASE_URL or CALLBACK_PUBLIC_BASE_URL_FIXED_RAW)
    if configured:
        return configured
    host = (request.headers.get("host") or "").strip()
    if not host:
        return str(request.base_url).rstrip("/")
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").split(",")[0].strip()
    if proto not in {"http", "https"}:
        proto = "https"
    return f"{proto}://{host}".rstrip("/")


async def _admin_migrate_robot(
    old_robot_id: str,
    worktool_path: str,
    action_key: str,
    action_name: str,
    user: Dict[str, Any],
) -> Dict[str, Any]:
    target = (old_robot_id or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="old_robot_id required")
    request_payload = {"oldRobotId": target}
    res = await post_worktool_api(worktool_path, request_payload)
    _ensure_worktool_ok(res, action_name)
    new_robot_id = _extract_migrated_robot_id(res)
    _insert_robot_migrate_log(
        user=user,
        action_key=action_key,
        action_name=action_name,
        old_robot_id=target,
        new_robot_id=new_robot_id,
        worktool_path=worktool_path,
        request_payload=request_payload,
        result_payload=res,
    )
    return {"ok": True, "action": action_name, "old_robot_id": target, "new_robot_id": new_robot_id, "result": res}


@app.post("/api/v1/admin/robot-migrate/wework-to-wechat")
async def admin_robot_migrate_wework_to_wechat(
    body: RobotMigrateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    return await _admin_migrate_robot(body.old_robot_id, "/robot/robotInfo/migrate/weworkToWechat", "wework-to-wechat", "企微换个微ID", user)


@app.post("/api/v1/admin/robot-migrate/wechat-to-wework")
async def admin_robot_migrate_wechat_to_wework(
    body: RobotMigrateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    return await _admin_migrate_robot(body.old_robot_id, "/robot/robotInfo/migrate/wechatToWework", "wechat-to-wework", "个微换企微ID", user)


@app.post("/api/v1/admin/robot-migrate/wework-to-new-wework")
async def admin_robot_migrate_wework_to_new_wework(
    body: RobotMigrateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    return await _admin_migrate_robot(body.old_robot_id, "/robot/robotInfo/migrate/weworkToNewWework", "wework-to-new-wework", "企微换新的企微ID", user)


@app.post("/api/v1/admin/robot-migrate/wechat-to-new-wechat")
async def admin_robot_migrate_wechat_to_new_wechat(
    body: RobotMigrateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    return await _admin_migrate_robot(body.old_robot_id, "/robot/robotInfo/migrate/wechatToNewWechat", "wechat-to-new-wechat", "个微换新的个微ID", user)


@app.get("/api/v1/admin/robot-migrate/logs")
async def admin_robot_migrate_logs(
    limit: int = Query(default=10, ge=1, le=100),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id,operator_user_id,operator_phone,action_key,action_name,old_robot_id,new_robot_id,
                       worktool_path,created_at
                FROM robot_migrate_logs
                ORDER BY id DESC
                LIMIT %s
                """,
                (int(limit),),
            )
            rows = cur.fetchall() or []
        items = []
        for row in rows:
            created_at = row.get("created_at")
            items.append(
                {
                    "id": int(row.get("id") or 0),
                    "operator_user_id": row.get("operator_user_id"),
                    "operator_phone": row.get("operator_phone") or "",
                    "action_key": row.get("action_key") or "",
                    "action_name": row.get("action_name") or "",
                    "old_robot_id": row.get("old_robot_id") or "",
                    "new_robot_id": row.get("new_robot_id") or "",
                    "worktool_path": row.get("worktool_path") or "",
                    "created_at": created_at.isoformat() if isinstance(created_at, datetime) else str(created_at or ""),
                }
            )
        return {"items": items}
    finally:
        conn.close()


@app.post("/api/v1/admin/private-license/logs")
async def admin_private_license_log_create(
    body: PrivateLicenseLogCreateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    _require_feature_enabled(ENABLE_ADMIN_ENTERPRISE_AUTH, "admin enterprise auth")
    _insert_private_license_log(user, body)
    return {"ok": True}


@app.get("/api/v1/admin/private-license/logs")
async def admin_private_license_logs(
    limit: int = Query(default=10, ge=1, le=100),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    _require_feature_enabled(ENABLE_ADMIN_ENTERPRISE_AUTH, "admin enterprise auth")
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id,operator_user_id,operator_phone,machine_code,expire_date,expire_epoch_ms,
                       restrict_robot,robot_start,robot_end,robot_limit,created_at
                FROM private_license_logs
                ORDER BY id DESC
                LIMIT %s
                """,
                (int(limit),),
            )
            rows = cur.fetchall() or []
        items = []
        for row in rows:
            created_at = row.get("created_at")
            items.append(
                {
                    "id": int(row.get("id") or 0),
                    "operator_user_id": row.get("operator_user_id"),
                    "operator_phone": row.get("operator_phone") or "",
                    "machine_code": row.get("machine_code") or "",
                    "expire_date": row.get("expire_date") or "",
                    "expire_epoch_ms": int(row.get("expire_epoch_ms") or 0),
                    "restrict_robot": bool(row.get("restrict_robot")),
                    "robot_start": row.get("robot_start") or "",
                    "robot_end": row.get("robot_end") or "",
                    "robot_limit": row.get("robot_limit"),
                    "created_at": created_at.isoformat() if isinstance(created_at, datetime) else str(created_at or ""),
                }
            )
        return {"items": items}
    finally:
        conn.close()


@app.get("/api/v1/admin/app-updates/apps")
async def admin_app_update_apps(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_admin(user)
    conn = worktool_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT app_name, COUNT(*) AS version_count, MAX(create_time) AS latest_create_time
                FROM app_update
                WHERE app_name IS NOT NULL AND app_name <> ''
                GROUP BY app_name
                ORDER BY app_name ASC
                """
            )
            rows = cur.fetchall() or []
        return {
            "items": [
                {
                    "app_name": row.get("app_name") or "",
                    "version_count": int(row.get("version_count") or 0),
                    "latest_create_time": _format_worktool_datetime(row.get("latest_create_time")),
                }
                for row in rows
            ]
        }
    finally:
        conn.close()


@app.get("/api/v1/admin/app-updates")
async def admin_app_updates(
    app_name: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    target = (app_name or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="app_name required")
    conn = worktool_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id,app_name,title,update_log,remark,version_name,version_code,min_version_code,
                       download_url,create_time,size,enable
                FROM (
                  SELECT id,app_name,title,update_log,remark,version_name,version_code,min_version_code,
                         download_url,create_time,size,enable
                  FROM app_update
                  WHERE app_name=%s
                  ORDER BY create_time DESC, id DESC
                  LIMIT 3
                ) t
                ORDER BY create_time ASC, id ASC
                """,
                (target,),
            )
            rows = cur.fetchall() or []
            latest = _get_latest_app_update(cur, target)
        return {
            "items": [_normalize_app_update_row(row) for row in rows],
            "latest": _normalize_app_update_row(latest) if latest else None,
        }
    finally:
        conn.close()


@app.post("/api/v1/admin/app-updates/upload")
async def admin_app_update_upload(
    request: Request,
    app_name: str,
    version_name: str,
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    app = (app_name or "").strip()
    version = (version_name or "").strip()
    if not app:
        raise HTTPException(status_code=400, detail="app_name required")
    if not re.fullmatch(r"\d+(?:\.\d+){1,5}", version):
        raise HTTPException(status_code=400, detail="version_name invalid")
    original = (file.filename or "").strip()
    if not original.lower().endswith(".apk"):
        raise HTTPException(status_code=400, detail="仅支持上传 apk 文件")

    app_part = _safe_app_file_part(app)
    target_dir = Path(APP_UPLOAD_DIR) / "apk" / app_part
    target_dir.mkdir(parents=True, exist_ok=True)
    target_name = f"{app_part}-{version}.apk"
    target_path = target_dir / target_name
    written = 0
    try:
        with target_path.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                out.write(chunk)
    finally:
        await file.close()
    if written <= 0:
        try:
            target_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail="上传文件为空")

    public_path = f"/uploads/apk/{quote(app_part)}/{quote(target_name)}"
    return {
        "ok": True,
        "download_url": f"{_public_base_url_from_request(request)}{public_path}",
        "path": public_path,
        "size_bytes": written,
    }


@app.post("/api/v1/admin/app-updates")
async def admin_app_update_create(
    body: AdminAppUpdateCreateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    app = (body.app_name or "").strip()
    version = (body.version_name or "").strip()
    download_url = (body.download_url or "").strip()
    if not app:
        raise HTTPException(status_code=400, detail="app_name required")
    if not re.fullmatch(r"\d+(?:\.\d+){1,5}", version):
        raise HTTPException(status_code=400, detail="version_name invalid")
    if not (download_url.startswith("http://") or download_url.startswith("https://")):
        raise HTTPException(status_code=400, detail="download_url required")

    conn = worktool_db_conn()
    try:
        with conn.cursor() as cur:
            latest = _get_latest_app_update(cur, app)
            if latest is None:
                raise HTTPException(status_code=400, detail="app_name 不存在，无法生成默认模板")
            title = (body.title or "").strip() or f"v{version}更新啦~"
            update_log = body.update_log if body.update_log is not None else (latest.get("update_log") or "")
            remark = body.remark if body.remark is not None else (latest.get("remark") or "")
            size = (body.size if body.size is not None else (latest.get("size") or "")) or ""
            version_code = int(body.version_code) if body.version_code is not None else _version_code_from_name(version)
            min_version_code = (
                int(body.min_version_code)
                if body.min_version_code is not None
                else int(latest.get("min_version_code") or 0)
            )
            enable = 1 if (bool(body.enable) if body.enable is not None else bool(latest.get("enable"))) else 0
            if enable:
                cur.execute("UPDATE app_update SET enable=0 WHERE app_name=%s", (app,))
            cur.execute(
                """
                INSERT INTO app_update(
                  app_name,title,update_log,remark,version_name,version_code,min_version_code,
                  download_url,create_time,size,enable
                )
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,NOW(),%s,%s)
                """,
                (
                    app[:192],
                    title[:765],
                    str(update_log or "")[:765],
                    str(remark or "")[:765] or None,
                    version[:192],
                    version_code,
                    min_version_code,
                    download_url[:765],
                    size[:192],
                    enable,
                ),
            )
            new_id = int(cur.lastrowid)
            cur.execute(
                """
                SELECT id,app_name,title,update_log,remark,version_name,version_code,min_version_code,
                       download_url,create_time,size,enable
                FROM app_update
                WHERE id=%s
                """,
                (new_id,),
            )
            row = cur.fetchone()
        conn.commit()
        return {"ok": True, "item": _normalize_app_update_row(row or {"id": new_id})}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@app.post("/api/v1/admin/app-updates/{update_id}/enable")
async def admin_app_update_enable(
    update_id: int,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    conn = worktool_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id,app_name,enable FROM app_update WHERE id=%s FOR UPDATE", (int(update_id),))
            target = cur.fetchone()
            if not target:
                raise HTTPException(status_code=404, detail="app版本不存在")
            app_name = target.get("app_name") or ""
            if not app_name:
                raise HTTPException(status_code=400, detail="app_name empty")
            cur.execute("UPDATE app_update SET enable=0 WHERE app_name=%s AND id<>%s", (app_name, int(update_id)))
            cur.execute("UPDATE app_update SET enable=1 WHERE id=%s", (int(update_id),))
            cur.execute(
                """
                SELECT id,app_name,title,update_log,remark,version_name,version_code,min_version_code,
                       download_url,create_time,size,enable
                FROM app_update
                WHERE id=%s
                """,
                (int(update_id),),
            )
            row = cur.fetchone()
        conn.commit()
        return {"ok": True, "item": _normalize_app_update_row(row or {"id": int(update_id)})}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@app.get("/api/v1/admin/users")
async def admin_list_users(
    phone: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _require_admin(user)
    kw = (phone or "").strip()
    like = f"%{kw}%"
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            if kw:
                cur.execute("SELECT COUNT(1) AS c FROM users WHERE phone LIKE %s", (like,))
            else:
                cur.execute("SELECT COUNT(1) AS c FROM users")
            total = int((cur.fetchone() or {}).get("c") or 0)
            offset = (page - 1) * page_size
            if kw:
                cur.execute(
                    """
                    SELECT
                      u.id,u.phone,u.company_name,u.created_at,u.last_login_at,
                      GROUP_CONCAT(DISTINCT r.robot_id ORDER BY r.robot_id SEPARATOR ',') AS robot_ids
                    FROM users u
                    LEFT JOIN user_robots ur ON ur.user_id=u.id
                    LEFT JOIN robots r ON r.id=ur.robot_pk
                    WHERE u.phone LIKE %s
                    GROUP BY u.id,u.phone,u.company_name,u.created_at,u.last_login_at
                    ORDER BY u.created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (like, page_size, offset),
                )
            else:
                cur.execute(
                    """
                    SELECT
                      u.id,u.phone,u.company_name,u.created_at,u.last_login_at,
                      GROUP_CONCAT(DISTINCT r.robot_id ORDER BY r.robot_id SEPARATOR ',') AS robot_ids
                    FROM users u
                    LEFT JOIN user_robots ur ON ur.user_id=u.id
                    LEFT JOIN robots r ON r.id=ur.robot_pk
                    GROUP BY u.id,u.phone,u.company_name,u.created_at,u.last_login_at
                    ORDER BY u.created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (page_size, offset),
                )
            rows = cur.fetchall() or []
    finally:
        conn.close()

    items = []
    for row in rows:
        ids = (row.get("robot_ids") or "").strip()
        items.append(
            {
                "id": int(row["id"]),
                "phone": row["phone"],
                "company_name": row.get("company_name"),
                "created_at": str(row["created_at"]),
                "last_login_at": str(row["last_login_at"]) if row.get("last_login_at") else None,
                "robot_ids": [x for x in ids.split(",") if x] if ids else [],
            }
        )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@app.post("/api/v1/admin/users")
async def admin_create_user(body: AdminCreateUserRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    _require_admin(user)
    phone = (body.phone or "").strip()
    password = body.password or ""
    company_name = (body.company_name or "").strip() or None
    if not _is_valid_phone(phone):
        raise HTTPException(status_code=400, detail="手机号格式不合法")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="密码长度至少8位")

    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE phone=%s LIMIT 1", (phone,))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail="手机号已存在")
            cur.execute(
                "INSERT INTO users(phone,password_hash,company_name,token_version,is_active) VALUES(%s,%s,%s,0,1)",
                (phone, _hash_password(password), company_name),
            )
            uid = int(cur.lastrowid)
        conn.commit()
        return {"ok": True, "id": uid, "phone": phone}
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn

    init_db()
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
