"""Durable event automations. All storage is in the Console database."""
import hashlib
import hmac
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

# Negative IDs are Console storage codes only; preserve the original status envelope.
STATUS_EVENT_TYPES = {'robot.online': -1, 'robot.offline': -2}
LEGACY_EVENT_TEXT_TYPES = {101: 19, 103: 20, 104: 21, 105: 22}
EVENT_NAMES = {-1: '机器人上线', -2: '机器人下线', 101: '机器人加入群组', 102: '群名变更', 103: '群解散', 104: '机器人被移出群', 105: '通过好友申请成功回调'}
VARIABLES = {'groupName', 'groupRemark', 'friendName', 'friendRemark', 'currentDate'}

def event_date():
    return datetime.now(timezone(timedelta(hours=8))).strftime('%Y%m%d')

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS console_events (
      id BIGINT PRIMARY KEY AUTO_INCREMENT, robot_pk BIGINT NOT NULL,
      event_type INT NOT NULL, identity_hash CHAR(64) NOT NULL, stable_identity TINYINT NOT NULL,
      payload_json JSON NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ce_robot_id(robot_pk,id), INDEX idx_ce_dedup(robot_pk,identity_hash,created_at),
      INDEX idx_ce_time(created_at),
      FOREIGN KEY (robot_pk) REFERENCES robots(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS event_tasks (
      id BIGINT PRIMARY KEY AUTO_INCREMENT, robot_pk BIGINT NOT NULL, created_by BIGINT NOT NULL,
      name VARCHAR(128) NOT NULL, event_type INT NOT NULL, config_json JSON NOT NULL,
      enabled TINYINT NOT NULL DEFAULT 1, last_trigger_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_et_robot(robot_pk,enabled), INDEX idx_et_creator(created_by),
      FOREIGN KEY (robot_pk) REFERENCES robots(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS event_task_runs (
      id BIGINT PRIMARY KEY AUTO_INCREMENT, event_id BIGINT NOT NULL, task_id BIGINT NULL,
      created_by BIGINT NOT NULL, task_name VARCHAR(128) NOT NULL, config_json JSON NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'queued', error_text VARCHAR(1000) NULL,
      result_json JSON NULL, started_at DATETIME NULL, finished_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_etr_event_task(event_id,task_id), INDEX idx_etr_queue(status,id),
      INDEX idx_etr_creator(created_by,id),
      FOREIGN KEY (event_id) REFERENCES console_events(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES event_tasks(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    """CREATE TABLE IF NOT EXISTS event_task_cooldowns (
      task_id BIGINT NOT NULL, subject_hash CHAR(64) NOT NULL,
      last_trigger_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id,subject_hash), INDEX idx_etc_time(last_trigger_at),
      FOREIGN KEY (task_id) REFERENCES event_tasks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
]


def init_schema(cur):
    for sql in SCHEMA:
        cur.execute(sql)


class EventAction(BaseModel):
    action: Literal['send_text', 'send_file', 'create_external_group', 'update_group'] = 'send_text'
    target: Literal['source', 'fixed'] = 'source'
    target_names: list[str] = Field(default_factory=list, max_length=20)
    content: str = Field(default='', max_length=2000)
    object_name: str = Field(default='', max_length=128)
    file_url: str = Field(default='', max_length=2048)
    file_type: str = Field(default='*', max_length=32)
    extra_text: str = Field(default='', max_length=2000)
    group_name: str = Field(default='', max_length=128)
    include_event_friend: bool = False
    extra_members: list[str] = Field(default_factory=list, max_length=20)
    group_announcement: str = Field(default='', max_length=2000)
    new_group_name: str = Field(default='', max_length=128)
    new_group_announcement: str = Field(default='', max_length=2000)
    group_remark: str = Field(default='', max_length=128)
    show_message_history: bool = False

    @model_validator(mode='after')
    def validate_fields(self):
        for field in ['content', 'extra_text', 'object_name', 'file_url', 'file_type', 'group_name',
                      'group_announcement', 'new_group_name', 'new_group_announcement', 'group_remark']:
            setattr(self, field, getattr(self, field).strip())
        for field in ['target_names', 'extra_members']:
            values = list(dict.fromkeys(x.strip() for x in getattr(self, field) if x.strip()))
            if any(len(x) > 128 for x in values):
                raise ValueError('名称或备注名不能超过128字')
            setattr(self, field, values)
        if self.action == 'send_text' and not self.content:
            raise ValueError('请填写发送内容')
        if self.action == 'send_file':
            if not self.object_name or not re.fullmatch(r'https?://[^\s]+', self.file_url):
                raise ValueError('请填写文件名称及 HTTP/HTTPS 文件地址')
            if '{{' in self.file_url or '}}' in self.file_url:
                raise ValueError('文件地址不支持事件变量')
        if self.action == 'create_external_group' and not self.group_name:
            raise ValueError('请填写新群名称')
        if self.action != 'create_external_group' and self.target == 'fixed' and not self.target_names:
            raise ValueError('请填写目标名称或备注名')
        if self.action == 'create_external_group' and not (self.extra_members or self.include_event_friend):
            raise ValueError('请添加群成员')
        if self.action == 'update_group' and not any([self.extra_members, self.include_event_friend,
                self.new_group_name, self.new_group_announcement, self.group_remark]):
            raise ValueError('请至少设置一项群修改或拉人成员')
        return self

    def validate_event(self, kind):
        if self.include_event_friend and kind != 105:
            raise ValueError('只有通过好友申请事件可以自动拉入联系人')
        if self.action != 'create_external_group' and self.target == 'source':
            if kind in (-1, -2, 103, 104):
                raise ValueError('该事件不能操作原会话，请填写固定目标')
            if kind == 105 and self.action == 'update_group':
                raise ValueError('通过好友申请事件请指定要修改或拉入的群')
        strings = [self.content, self.extra_text, self.object_name, self.group_name, self.group_announcement,
                   self.new_group_name, self.new_group_announcement, self.group_remark,
                   *self.target_names, *self.extra_members]
        for value in strings:
            for variable in re.findall(r'\{\{(.*?)\}\}', value):
                if variable != 'currentDate' and (variable not in VARIABLES or kind in (-1, -2) or ((kind == 105) != variable.startswith('friend'))):
                    raise ValueError('变量不适用于当前事件：' + variable)


class EventTaskPayload(BaseModel):
    robot_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    event_type: Literal[-1, -2, 101, 102, 103, 104, 105]
    filter_field: Literal['groupName', 'groupRemark', 'friendName', 'friendRemark'] = 'groupName'
    filter_value: str = Field(default='', max_length=128)
    target: Literal['source', 'fixed'] = 'source'
    target_names: list[str] = Field(default_factory=list, max_length=20)
    action: Literal['send_text', 'create_external_group', 'update_group'] = 'send_text'
    content: str = Field(default='', max_length=2000)
    group_name: str = Field(default='', max_length=128)
    extra_members: list[str] = Field(default_factory=list, max_length=20)
    actions: list[EventAction] | None = Field(default=None, min_length=1, max_length=10)
    cooldown_scope: Literal['subject', 'rule'] = 'subject'
    cooldown_seconds: int = Field(default=60, ge=10, le=86400)
    enabled: bool = True

    @model_validator(mode='after')
    def validate_action(self):
        self.name = self.name.strip()
        self.filter_value = self.filter_value.strip()
        if self.actions is not None:
            if not self.name:
                raise ValueError('请填写任务名称')
            if self.filter_value and (self.event_type in (-1, -2) or ((self.event_type == 105) != self.filter_field.startswith('friend'))):
                raise ValueError('筛选字段与事件类型不匹配')
            for step in self.actions:
                step.validate_event(self.event_type)
            return self
        self.content = self.content.strip()
        self.filter_value = self.filter_value.strip()
        self.target_names = list(dict.fromkeys(x.strip() for x in self.target_names if x.strip()))
        self.group_name = self.group_name.strip()
        self.extra_members = list(dict.fromkeys(x.strip() for x in self.extra_members if x.strip()))
        if any(len(x) > 128 for x in self.extra_members):
            raise ValueError('额外群成员名称过长')
        if self.action != 'send_text':
            if self.event_type != 105:
                raise ValueError('拉群动作仅支持通过好友申请成功事件')
            if not self.group_name:
                raise ValueError('请填写群名称或备注名')
            self.target = 'source'
            self.target_names = []
            self.content = ''
        if not self.name or (self.action == 'send_text' and not self.content):
            raise ValueError('任务名称和发送内容不能为空')
        if any(len(x) > 128 for x in self.target_names):
            raise ValueError('发送对象名称过长')
        if self.target == 'fixed' and not self.target_names:
            raise ValueError('请选择固定发送对象')
        if self.target == 'source' and self.event_type in (103, 104):
            raise ValueError('群已解散或机器人已离群，请指定其他发送对象')
        if self.filter_value and ((self.event_type == 105) != self.filter_field.startswith('friend')):
            raise ValueError('筛选字段与事件类型不匹配')
        for variable in re.findall(r'\{\{(.*?)\}\}', self.content if self.action == 'send_text' else self.group_name):
            if variable not in VARIABLES:
                raise ValueError('不支持的消息变量：' + variable)
            if variable != 'currentDate' and (self.event_type == 105) != variable.startswith('friend'):
                raise ValueError('消息变量与事件类型不匹配')
        return self


def decode(value):
    return json.loads(value) if isinstance(value, str) else value


def event_type(payload):
    text_type = payload.get('textType')
    if (payload.get('schemaVersion') == 2 and payload.get('category') == 'event'
            and text_type in (None, '') and 'type' not in payload):
        status = payload.get('eventType')
        return STATUS_EVENT_TYPES.get(status) if isinstance(status, str) else None
    if 'type' not in payload:
        return None
    raw = payload['type']
    # Only the known legacy event/textType pairs bypass the message pipeline.
    # Ordinary text, image and other message callbacks keep their existing behavior.
    if text_type not in (None, ''):
        if isinstance(raw, bool) or isinstance(text_type, bool):
            return None
        expected = next((value for kind, value in LEGACY_EVENT_TEXT_TYPES.items()
                         if str(raw) == str(kind)), None)
        if expected is None or str(text_type) != str(expected):
            return None
    if isinstance(raw, bool) or not re.fullmatch(r'\d{1,6}', str(raw)):
        raise HTTPException(400, '无效的事件类型')
    return int(raw)


def identity(payload):
    stable = payload.get('eventId')  # messageId may identify a query, not a unique event.
    raw = json.dumps([event_type(payload), str(stable)] if stable else payload, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(raw.encode()).hexdigest(), bool(stable)


def matches(config, payload):
    return not config['filter_value'] or config['filter_value'] in str(payload.get(config['filter_field']) or '')


def action_payload(config, payload):
    payload = {**payload, 'currentDate': config.get('_event_date') or event_date()}
    if config.get('action', 'send_text') != 'send_text':
        friend = str(payload.get('friendName') or '').strip()
        if not friend:
            raise ValueError('事件缺少联系人名称，未提交拉群指令')
        def group_variable(match):
            value = payload.get(match.group(1))
            if not isinstance(value, str) or not value.strip():
                raise ValueError('事件缺少群名变量：' + match.group(1))
            return value.strip()
        group = re.sub(r'\{\{(.*?)\}\}', group_variable, config.get('group_name', '')).strip()
        if not group or len(group) > 128:
            raise ValueError('变量替换后的群名为空或过长')
        members = list(dict.fromkeys([friend] + config.get('extra_members', [])))
        return {'group_name': group, 'select_list': members}
    targets = config['target_names']
    if config['target'] == 'source':
        fields = ('friendRemark', 'friendName') if config['event_type'] == 105 else ('groupRemark', 'groupName')
        targets = [str(payload.get(fields[0]) or payload.get(fields[1]) or '').strip()]
        if not targets[0]:
            raise ValueError('事件缺少发送对象名称，未提交任务')
    def substitute(match):
        value = payload.get(match.group(1))
        if value is None or value == '':
            raise ValueError('事件缺少消息变量：' + match.group(1))
        return str(value)
    content = re.sub(r'\{\{(.*?)\}\}', substitute, config['content'])
    if len(content) > 4000:
        raise ValueError('变量替换后消息过长')
    return {'target_names': targets, 'content': content}


def cooldown_subject(config, payload):
    if config.get('cooldown_scope', 'subject') == 'rule':
        return 'rule'
    kind = config['event_type']
    fields = ('friendName', 'friendRemark') if kind == 105 else ('groupName', 'groupRemark')
    subject = next((str(payload.get(field) or '').strip() for field in fields if str(payload.get(field) or '').strip()), '')
    return hashlib.sha256(json.dumps([kind, payload.get('roomType'), subject], ensure_ascii=False).encode()).hexdigest()


def ordered_actions(config, payload):
    """Resolve all steps before any command is submitted."""
    if not config.get('actions'):
        return [(config.get('action', 'send_text'), action_payload(config, payload))]
    payload = {**payload, 'currentDate': config.get('_event_date') or event_date()}
    def render(value, limit):
        def substitute(match):
            text = payload.get(match.group(1))
            if not isinstance(text, str) or not text.strip():
                raise ValueError('事件缺少变量：' + match.group(1))
            return text.strip()
        result = re.sub(r'\{\{(.*?)\}\}', substitute, value).strip()
        if len(result) > limit:
            raise ValueError('变量替换后的内容或名称过长')
        return result
    result = []
    for raw in config['actions']:
        step = EventAction(**raw)
        step.validate_event(config['event_type'])
        values = step.model_dump()
        for key in ['content', 'extra_text', 'object_name', 'group_name', 'group_announcement', 'new_group_name', 'new_group_announcement', 'group_remark']:
            values[key] = render(values[key], 4000 if key in ('content', 'extra_text', 'group_announcement', 'new_group_announcement') else 128)
        targets = list(dict.fromkeys(render(x, 128) for x in step.target_names))
        if step.action != 'create_external_group' and step.target == 'source':
            fields = ('friendRemark', 'friendName') if config['event_type'] == 105 else ('groupRemark', 'groupName')
            targets = [next((str(payload.get(x) or '').strip() for x in fields if str(payload.get(x) or '').strip()), '')]
            if not targets[0]:
                raise ValueError('事件缺少目标名称，未提交任何动作')
        values['target_names'] = targets
        members = [render(x, 128) for x in step.extra_members]
        if step.include_event_friend:
            friend = str(payload.get('friendName') or '').strip()
            if not friend or len(friend) > 128:
                raise ValueError('事件缺少有效的联系人名称')
            members.insert(0, friend)
        values['select_list'] = list(dict.fromkeys(members))
        result.append((step.action, values))
    return result


class CallbackAccessLogFilter(logging.Filter):
    """Do not persist the event credential in Uvicorn access logs."""
    def filter(self, record):
        if isinstance(record.args, tuple) and len(record.args) >= 3:
            args = list(record.args)
            if isinstance(args[2], str) and args[2].startswith('/api/v1/callback/qa/'):
                args[2] = args[2].split('?', 1)[0]
                record.args = tuple(args)
        return True


class EventService:
    def __init__(self, host):
        self.host = host

    def token(self, robot_id):
        secret = self.host.AUTH_JWT_SECRET
        if not secret:
            raise HTTPException(503, '平台未配置安全密钥，暂不能接入事件')
        return hmac.new(secret.encode(), ('console-event-v1:' + robot_id).encode(), hashlib.sha256).hexdigest()

    def callback_url(self, robot_id):
        return self.host.build_robot_callback_url(robot_id) + '?event_token=' + self.token(robot_id)

    def receive(self, robot, payload, token):
        supplied = str(token or '')
        if not re.fullmatch(r'[a-f0-9]{64}', supplied) or not hmac.compare_digest(supplied, self.token(robot['robot_id'])):
            raise HTTPException(403, '请在小白模式重新一键接入平台以启用事件接收')
        kind = event_type(payload)
        packed = json.dumps(payload, ensure_ascii=False)
        if len(packed.encode()) > 256 * 1024:
            raise HTTPException(413, '事件内容过大')
        for key in VARIABLES - {'currentDate'}:
            if key in payload and not isinstance(payload[key], str):
                raise HTTPException(400, '事件名称字段必须为文字')
        if payload.get('robotId') and str(payload['robotId']) != robot['robot_id']:
            raise HTTPException(400, '事件机器人不匹配')
        digest, stable = identity(payload)
        received_date = event_date()
        conn = self.host.db_conn()
        try:
            with conn.cursor() as cur:
                # Serializes dedup/cooldown decisions for one robot across API processes.
                cur.execute('SELECT id FROM robots WHERE id=%s FOR UPDATE', (robot['id'],))
                cur.execute('SELECT id FROM console_events WHERE robot_pk=%s AND identity_hash=%s' + ('' if stable else ' AND created_at >= DATE_SUB(NOW(), INTERVAL 10 SECOND)') + ' ORDER BY id DESC LIMIT 1', (robot['id'], digest))
                if cur.fetchone():
                    conn.commit()
                    return
                cur.execute('INSERT INTO console_events(robot_pk,event_type,identity_hash,stable_identity,payload_json) VALUES(%s,%s,%s,%s,%s)', (robot['id'], kind, digest, stable, packed))
                eid = cur.lastrowid
                cur.execute('SELECT * FROM event_tasks WHERE robot_pk=%s AND event_type=%s AND enabled=1 FOR UPDATE', (robot['id'], kind))
                for task in cur.fetchall():
                    config = decode(task['config_json'])
                    if not matches(config, payload):
                        continue
                    config['_event_date'] = received_date
                    subject = cooldown_subject(config, payload)
                    cur.execute('SELECT TIMESTAMPDIFF(SECOND,last_trigger_at,NOW()) < %s AS cooling FROM event_task_cooldowns WHERE task_id=%s AND subject_hash=%s', (config.get('cooldown_seconds', 60), task['id'], subject))
                    cooldown = cur.fetchone()
                    skipped = bool(cooldown and cooldown['cooling'])
                    cur.execute('INSERT INTO event_task_runs(event_id,task_id,created_by,task_name,config_json,status,error_text) VALUES(%s,%s,%s,%s,%s,%s,%s)', (eid, task['id'], task['created_by'], task['name'], json.dumps(config, ensure_ascii=False), 'skipped' if skipped else 'queued', '冷却时间内，已跳过' if skipped else None))
                    if not skipped:
                        cur.execute('INSERT INTO event_task_cooldowns(task_id,subject_hash) VALUES(%s,%s) ON DUPLICATE KEY UPDATE last_trigger_at=NOW()', (task['id'], subject))
                        cur.execute('UPDATE event_tasks SET last_trigger_at=NOW() WHERE id=%s', (task['id'],))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    async def tick(self, limit=10):
        conn = self.host.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("UPDATE event_task_runs SET status='unknown',finished_at=NOW(),error_text='执行进程中断或超时，结果待确认；不会自动重发' WHERE status='running' AND started_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)")
                cur.execute("UPDATE event_task_runs SET status='skipped',finished_at=NOW(),error_text='等待超过10分钟，已跳过过期事件' WHERE status='queued' AND created_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)")
                cur.execute("SELECT id FROM event_task_runs WHERE status='queued' ORDER BY id LIMIT %s", (limit,))
                ids = [row['id'] for row in cur.fetchall()]
            conn.commit()
        finally:
            conn.close()
        for run_id in ids:
            await self.execute(run_id)
        # Bounded retention; only settled events are eligible.
        conn = self.host.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM event_task_cooldowns WHERE last_trigger_at < DATE_SUB(NOW(), INTERVAL 1 DAY) LIMIT 200')
                cur.execute('DELETE FROM console_events WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY id LIMIT 200')
            conn.commit()
        finally:
            conn.close()

    async def execute(self, run_id):
        conn = self.host.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("UPDATE event_task_runs SET status='running',started_at=NOW() WHERE id=%s AND status='queued'", (run_id,))
                claimed = cur.rowcount
                conn.commit()  # Never automatically replay a claimed operation after a crash.
                if not claimed:
                    return
                cur.execute('SELECT x.*,e.payload_json,r.robot_id,t.enabled FROM event_task_runs x JOIN console_events e ON e.id=x.event_id JOIN robots r ON r.id=e.robot_pk LEFT JOIN event_tasks t ON t.id=x.task_id WHERE x.id=%s', (run_id,))
                row = cur.fetchone()
            status, error, result = 'skipped', '规则已暂停或删除', None
            if row and row['enabled']:
                try:
                    with conn.cursor() as cur:
                        cur.execute('SELECT id,phone,is_active FROM users WHERE id=%s', (row['created_by'],))
                        creator = cur.fetchone()
                    if not creator or not creator['is_active']:
                        raise ValueError('任务创建者账号已停用')
                    self.host._reject_demo_robot_write(row['robot_id'], '事件任务', user=creator)
                    config = decode(row['config_json'])
                    resolved = ordered_actions(config, decode(row['payload_json']))
                    commands = []
                    if config.get('actions'):
                        for action, payload in resolved:
                            commands.extend(self.host._build_task_action_items(action, payload, payload.get('target_names', [])))
                        if not commands or len(commands) > 100:
                            raise ValueError('单次事件最多提交100条指令')
                    # Validate immediately before dispatch; executor rechecks ownership as well.
                    self.host._require_robot_access(int(row['created_by']), row['robot_id'])
                except Exception as exc:
                    status, error = 'failed', str(getattr(exc, 'detail', exc))[:1000]
                else:
                    try:
                        if config.get('actions'):
                            result = await self.host._send_raw_message_batch(row['robot_id'], commands)
                            result = {**result, 'action_count': len(resolved), 'command_count': len(commands)}
                        else:
                            action, payload = resolved[0]
                            result = await self.host._dispatch_task_action_internal(int(row['created_by']), row['robot_id'], action, payload)
                        status, error = 'submitted', None
                    except Exception as exc:
                        # Submission can have reached WorkTool even when the response is lost.
                        status, error = 'unknown', ('提交结果待确认：' + str(getattr(exc, 'detail', exc)))[:1000]
            with conn.cursor() as cur:
                cur.execute("UPDATE event_task_runs SET status=%s,error_text=%s,result_json=%s,finished_at=NOW() WHERE id=%s AND status='running'", (status, error, json.dumps(result, ensure_ascii=False) if result is not None else None, run_id))
            conn.commit()
        finally:
            conn.close()


def install(host):
    logging.getLogger('uvicorn.access').addFilter(CallbackAccessLogFilter())
    service = EventService(host)
    app = host.app

    @app.get('/api/v1/event-tasks/connection')
    async def connection(robot_id: str, user=Depends(host.get_current_user)):
        robot = host._require_robot_access(int(user['id']), robot_id)
        config = await host.get_robot_event_callback(robot_id, user)
        callbacks = await host.fetch_worktool_api('/robot/robotInfo/callBack/get', {'robotId': robot_id})
        host._ensure_worktool_ok(callbacks, '读取消息接入状态')
        expected = service.callback_url(robot_id)
        detail = await host.fetch_worktool_api('/robot/robotInfo/getDetail', {'robotId': robot_id})
        host._ensure_worktool_ok(detail, '读取机器人接入状态')
        data = detail.get('data')
        if not isinstance(data, dict) or not isinstance(callbacks.get('data'), list):
            raise HTTPException(502, '接入状态响应格式异常')
        message_url = next((host._extract_callback_url(row) for row in callbacks['data'] if isinstance(row, dict) and str(row.get('type')) == '11'), '') or data.get('callbackUrl', '')
        resolved = config['event_callback_url'] or message_url
        connected = config['enabled'] is True and resolved.rstrip('/') == expected.rstrip('/') and data.get('openCallback') == 1
        conn = host.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT created_at FROM console_events WHERE robot_pk=%s ORDER BY id DESC LIMIT 1', (robot['id'],))
                latest = cur.fetchone()
        finally:
            conn.close()
        return {'connected': connected, 'callback_url': expected, 'event_callback_url': config['event_callback_url'], 'enabled': config['enabled'], 'last_event_received_at': latest['created_at'] if latest else None}

    @app.get('/api/v1/event-tasks')
    async def list_tasks(robot_id: str, user=Depends(host.get_current_user)):
        robot = host._require_robot_access(int(user['id']), robot_id)
        conn = host.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT * FROM event_tasks WHERE robot_pk=%s AND created_by=%s ORDER BY id DESC', (robot['id'], user['id']))
                return {'items': [{**decode(r['config_json']), 'id': r['id'], 'enabled': bool(r['enabled'])} for r in cur.fetchall()]}
        finally:
            conn.close()

    def save(body, user, task_id=None):
        robot = host._require_robot_access(int(user['id']), body.robot_id)
        host._reject_demo_robot_write(body.robot_id, '事件任务', user=user)
        conn = host.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT id FROM robots WHERE id=%s FOR UPDATE', (robot['id'],))
                values = (body.name, body.event_type, json.dumps(body.model_dump(), ensure_ascii=False), body.enabled)
                if task_id is None:
                    cur.execute('SELECT COUNT(*) AS n FROM event_tasks WHERE robot_pk=%s', (robot['id'],))
                    if cur.fetchone()['n'] >= 100:
                        raise HTTPException(400, '每个机器人最多配置100条事件任务')
                    cur.execute('INSERT INTO event_tasks(name,event_type,config_json,enabled,robot_pk,created_by) VALUES(%s,%s,%s,%s,%s,%s)', values + (robot['id'], user['id']))
                    task_id = cur.lastrowid
                else:
                    cur.execute('SELECT id FROM event_tasks WHERE id=%s AND created_by=%s AND robot_pk=%s FOR UPDATE', (task_id, user['id'], robot['id']))
                    if not cur.fetchone():
                        raise HTTPException(404, '事件任务不存在')
                    cur.execute('UPDATE event_tasks SET name=%s,event_type=%s,config_json=%s,enabled=%s WHERE id=%s', values + (task_id,))
                    cur.execute("UPDATE event_task_runs SET status='skipped',error_text='规则已修改，旧的待执行任务已取消',finished_at=NOW() WHERE task_id=%s AND status='queued'", (task_id,))
            conn.commit()
            return {'ok': True, 'id': task_id}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @app.post('/api/v1/event-tasks')
    async def create(body: EventTaskPayload, user=Depends(host.get_current_user)):
        return save(body, user)

    @app.put('/api/v1/event-tasks/{task_id}')
    async def update(task_id: int, body: EventTaskPayload, user=Depends(host.get_current_user)):
        return save(body, user, task_id)

    @app.delete('/api/v1/event-tasks/{task_id}')
    async def delete(task_id: int, user=Depends(host.get_current_user)):
        conn = host.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT t.*,r.robot_id FROM event_tasks t JOIN robots r ON r.id=t.robot_pk WHERE t.id=%s AND t.created_by=%s', (task_id, user['id']))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(404, '事件任务不存在')
                host._require_robot_access(int(user['id']), row['robot_id'])
                host._reject_demo_robot_write(row['robot_id'], '事件任务', user=user)
                cur.execute("UPDATE event_task_runs SET status='skipped',error_text='规则已删除',finished_at=NOW() WHERE task_id=%s AND status='queued'", (task_id,))
                cur.execute('DELETE FROM event_tasks WHERE id=%s AND created_by=%s', (task_id, user['id']))
            conn.commit()
            return {'ok': True}
        finally:
            conn.close()

    @app.get('/api/v1/events')
    async def events(robot_id: str, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), user=Depends(host.get_current_user)):
        robot = host._require_robot_access(int(user['id']), robot_id)
        conn = host.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT COUNT(*) AS n FROM console_events WHERE robot_pk=%s', (robot['id'],))
                total = cur.fetchone()['n']
                cur.execute('SELECT id,event_type,payload_json,created_at FROM console_events WHERE robot_pk=%s ORDER BY id DESC LIMIT %s OFFSET %s', (robot['id'], page_size, (page - 1) * page_size))
                items = cur.fetchall()
                runs_by_event = {}
                if items:
                    placeholders = ','.join(['%s'] * len(items))
                    cur.execute('SELECT id,event_id,task_id,task_name,status,error_text,result_json,created_at FROM event_task_runs WHERE event_id IN (' + placeholders + ') AND created_by=%s ORDER BY id', [item['id'] for item in items] + [user['id']])
                    for run in cur.fetchall():
                        runs_by_event.setdefault(run['event_id'], []).append(run)
                for item in items:
                    item['payload'] = decode(item.pop('payload_json'))
                    item['event_name'] = EVENT_NAMES.get(item['event_type'], '其他事件 / 查询结果')
                    item['runs'] = runs_by_event.get(item['id'], [])
                return {'items': items, 'total': total}
        finally:
            conn.close()

    @app.get('/api/v1/event-task-runs')
    async def runs(robot_id: str, task_id: int | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), user=Depends(host.get_current_user)):
        robot = host._require_robot_access(int(user['id']), robot_id)
        where = 'e.robot_pk=%s AND x.created_by=%s'
        params = [robot['id'], user['id']]
        if task_id is not None:
            where += ' AND x.task_id=%s'
            params.append(task_id)
        conn = host.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT COUNT(*) AS n FROM event_task_runs x JOIN console_events e ON e.id=x.event_id WHERE ' + where, params)
                total = cur.fetchone()['n']
                cur.execute('SELECT x.id,x.event_id,x.task_name,x.status,x.error_text,x.result_json,x.created_at,e.event_type,e.payload_json FROM event_task_runs x JOIN console_events e ON e.id=x.event_id WHERE ' + where + ' ORDER BY x.id DESC LIMIT %s OFFSET %s', params + [page_size, (page - 1) * page_size])
                return {'items': cur.fetchall(), 'total': total}
        finally:
            conn.close()
    return service
