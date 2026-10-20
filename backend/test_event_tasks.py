import asyncio
import json
import logging
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pymysql
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

import main
from event_tasks import CallbackAccessLogFilter, EventService, EventTaskPayload, action_payload, event_type, identity, init_schema, install, matches, ordered_actions, cooldown_subject


def config(**kwargs):
    return EventTaskPayload(robot_id='robot-test', name='入群说明', event_type=101, content='欢迎加入{{groupName}}', **kwargs).model_dump()


class EventUnitTests(unittest.TestCase):
    def test_file_optional_text_resolves_and_reuses_extra_text_protocol(self):
        for text in ['', '你好{{friendName}}，日期{{currentDate}}']:
            cfg = EventTaskPayload(robot_id='r', name='文件', event_type=105, actions=[{
                'action': 'send_file', 'object_name': '说明.pdf',
                'file_url': 'https://example.com/a.pdf', 'extra_text': text
            }]).model_dump()
            cfg['_event_date'] = '20261020'
            action, payload = ordered_actions(cfg, {'friendName': '小张'})[0]
            commands = main._build_task_action_items(action, payload, payload['target_names'])
            self.assertEqual(len(commands), 1)
            self.assertEqual(commands[0]['type'], 218)
            if text:
                self.assertEqual(commands[0]['extraText'], '你好小张，日期20261020')
            else:
                self.assertNotIn('extraText', commands[0])
        with self.assertRaises(ValidationError):
            EventTaskPayload(robot_id='r', name='文件', event_type=105, actions=[{
                'action': 'send_file', 'object_name': 'a', 'file_url': 'https://example.com/a',
                'extra_text': '{{groupName}}'
            }])

    def test_event_date_in_all_event_kinds_and_steps(self):
        for kind in [-1, -2, 101, 102, 103, 104, 105]:
            task = EventTaskPayload(robot_id='r', name='日期', event_type=kind, actions=[
                {'action': 'send_text', 'target': 'fixed', 'target_names': ['通知群'], 'content': '{{currentDate}}'},
                {'action': 'create_external_group', 'group_name': '{{currentDate}}服务群', 'extra_members': ['成员']}
            ]).model_dump()
            task['_event_date'] = '20261020'
            with patch('event_tasks.event_date', return_value='20261021'):
                result = ordered_actions(task, {'currentDate': '19990101'})
            self.assertEqual(result[0][1]['content'], '20261020')
            self.assertEqual(result[1][1]['group_name'], '20261020服务群')

    def test_dispatch_classification(self):
        self.assertIsNone(event_type({'textType': 1, 'type': 101}))
        self.assertIsNone(event_type({'spoken': 'hello'}))
        self.assertEqual(event_type({'type': '101'}), 101)
        for raw in [True, 'abc', 1.5, -1]:
            with self.assertRaises(HTTPException):
                event_type({'type': raw})

    def test_legacy_event_pairs_and_message_precedence(self):
        for kind, legacy in [(101, 19), (103, 20), (104, 21), (105, 22)]:
            for body in [{'type': kind, 'textType': legacy},
                         {'type': str(kind), 'textType': str(legacy)}]:
                self.assertEqual(event_type(body), kind)
            for text in [1, 2, True, 99]:
                self.assertIsNone(event_type({'type': kind, 'textType': text}))
        self.assertIsNone(event_type({'textType': 19}))
        self.assertIsNone(event_type({'type': 102, 'textType': 19}))

    def test_status_envelope_and_stable_identity(self):
        for name, kind in [('robot.online', -1), ('robot.offline', -2)]:
            body = {'schemaVersion': 2, 'category': 'event', 'eventType': name, 'eventId': 'same'}
            self.assertEqual(event_type(body), kind)
            self.assertEqual(identity(body), identity({**body, 'occurredAt': 123}))
        online = {'schemaVersion': 2, 'category': 'event', 'eventType': 'robot.online', 'eventId': 'same'}
        self.assertNotEqual(identity(online), identity({**online, 'eventType': 'robot.offline'}))
        for changes in [{'schemaVersion': 1}, {'category': 'message'}, {'eventType': []}, {'textType': 1}]:
            self.assertIsNone(event_type({**online, **changes}))

    def test_http_legacy_and_status_events_do_not_enter_message_pipeline(self):
        bodies = [{'type': 101, 'textType': 19, 'groupName': '群'},
                  {'type': 102, 'groupName': '测试下群事件3'},
                  {'type': 103, 'textType': 20}, {'type': 104, 'textType': 21},
                  {'type': 105, 'textType': 22},
                  {'schemaVersion': 2, 'category': 'event', 'eventType': 'robot.online'},
                  {'schemaVersion': 2, 'category': 'event', 'eventType': 'robot.offline'}]
        with patch.object(main, '_get_robot_by_id_or_404', return_value={'id': 1, 'robot_id': 'r'}), patch.object(main.event_service, 'receive') as receive, patch.object(main, '_insert_qa_monitor_log') as log:
            client = TestClient(main.app)
            for body in bodies:
                response = client.post('/api/v1/callback/qa/r?event_token=t', json=body)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['code'], 200)
            self.assertEqual(receive.call_count, len(bodies))
            log.assert_not_called()

    def test_group_actions_build_expected_worktool_commands(self):
        for action, kind in [('create_external_group', 206), ('update_group', 207)]:
            cfg = EventTaskPayload(robot_id='r', name='拉群', event_type=105, action=action,
                group_name='服务群', extra_members=['客服']).model_dump()
            with patch.object(main, '_require_robot_access', return_value={'id': 1}), patch.object(main, '_resolve_targets_by_group_tags', return_value=[]), patch.object(main, '_send_raw_message_batch', new=AsyncMock(return_value={})) as send:
                asyncio.run(main._dispatch_task_action_internal(1, 'r', action, action_payload(cfg, {'friendName': '张三'})))
                command = send.await_args.args[1][0]
                self.assertEqual(command['type'], kind)
                self.assertEqual(command['groupName'], '服务群')
                self.assertEqual(command['selectList'], ['张三', '客服'])

    def test_friend_group_actions_and_legacy_defaults(self):
        self.assertEqual(config()['action'], 'send_text')
        for action in ['create_external_group', 'update_group']:
            cfg = EventTaskPayload(robot_id='r', name='好友拉群', event_type=105, action=action,
                group_name='{{friendName}}服务群', extra_members=['客服', '客服', ' 张三 ']).model_dump()
            self.assertEqual(action_payload(cfg, {'friendName': '张三', 'friendRemark': ''}),
                {'group_name': '张三服务群', 'select_list': ['张三', '客服']})
            with self.assertRaises(ValueError):
                action_payload(cfg, {'friendRemark': '备注'})
            with self.assertRaises(ValueError):
                action_payload(cfg, {'friendName': 'a' * 129})
            for changes in [{'event_type': 101}, {'group_name': ''}, {'group_name': '{{secret}}'}, {'group_name': '{{groupName}}'}]:
                with self.assertRaises(ValidationError):
                    EventTaskPayload(**{**cfg, **changes})

    def test_multistep_builds_one_ordered_batch(self):
        cfg = EventTaskPayload(robot_id='r', name='欢迎拉群', event_type=105, actions=[
            {'action': 'send_text', 'content': '欢迎{{friendName}}'},
            {'action': 'create_external_group', 'group_name': '{{friendName}}服务群', 'include_event_friend': True, 'extra_members': ['客服']},
            {'action': 'update_group', 'target': 'fixed', 'target_names': ['{{friendName}}服务群'], 'new_group_announcement': '欢迎{{friendName}}'},
            {'action': 'send_file', 'target': 'fixed', 'target_names': ['{{friendName}}服务群'], 'object_name': '指南.pdf', 'file_url': 'https://example.com/guide.pdf'},
        ]).model_dump()
        steps = ordered_actions(cfg, {'friendName': '张三', 'friendRemark': ''})
        commands = [command for action, payload in steps for command in main._build_task_action_items(action, payload, payload.get('target_names', []))]
        with patch.object(main, 'post_worktool_api', new=AsyncMock(return_value={'code': 200})) as send:
            result = asyncio.run(main._send_raw_message_batch('r', commands))
            send.assert_awaited_once()
            body = send.await_args.kwargs['body']
            self.assertEqual(body['socketType'], 2)
            self.assertEqual([x['type'] for x in body['list']], [203, 206, 207, 218])
            self.assertEqual(body['list'][1]['selectList'], ['张三', '客服'])
            self.assertEqual(body['list'][2]['groupName'], '张三服务群')
            self.assertEqual(result['batch_count'], 1)

    def test_event_contexts_and_invalid_steps(self):
        for kind in [-1, -2, 103, 104]:
            with self.assertRaises(ValidationError):
                EventTaskPayload(robot_id='r', name='通知', event_type=kind, actions=[{'content': '通知'}])
            cfg = EventTaskPayload(robot_id='r', name='通知', event_type=kind, actions=[{'target': 'fixed', 'target_names': ['管理员'], 'content': '通知'}]).model_dump()
            self.assertEqual(ordered_actions(cfg, {})[0][1]['target_names'], ['管理员'])
        for action in [
            {'action': 'update_group', 'new_group_announcement': '公告'},
            {'action': 'update_group', 'extra_members': ['客服']},
        ]:
            cfg = EventTaskPayload(robot_id='r', name='入群设置', event_type=101, actions=[action]).model_dump()
            self.assertEqual(ordered_actions(cfg, {'groupName': '客户群'})[0][1]['target_names'], ['客户群'])
        for steps in [[], [{'content': 'a'}] * 11, [{'action': 'update_group', 'target': 'fixed', 'target_names': ['群']}], [{'content': '{{secret}}'}]]:
            with self.assertRaises(ValidationError):
                EventTaskPayload(robot_id='r', name='无效', event_type=101, actions=steps)
        cfg = EventTaskPayload(robot_id='r', name='变量', event_type=105, actions=[{'content': '欢迎'}, {'content': '{{friendRemark}}'}]).model_dump()
        with self.assertRaises(ValueError):
            ordered_actions(cfg, {'friendName': '张三', 'friendRemark': ''})

    def test_cooldown_subjects_are_independent_by_default(self):
        cfg = {'event_type': 105}
        self.assertNotEqual(cooldown_subject(cfg, {'friendName': '甲'}), cooldown_subject(cfg, {'friendName': '乙'}))
        self.assertEqual(cooldown_subject(cfg, {'friendName': '甲', 'friendRemark': '旧'}), cooldown_subject(cfg, {'friendName': '甲', 'friendRemark': '新'}))
        self.assertEqual(cooldown_subject({**cfg, 'cooldown_scope': 'rule'}, {'friendName': '甲'}), cooldown_subject({**cfg, 'cooldown_scope': 'rule'}, {'friendName': '乙'}))

    def test_validate_unsafe_or_incompatible_actions(self):
        for kwargs in [{'event_type': 103}, {'target': 'fixed', 'target_names': []}, {'content': '  '}, {'content': '{{secret}}'}, {'content': '{{friendName}}'}, {'cooldown_seconds': 0}, {'filter_field': 'friendName', 'filter_value': 'a'}]:
            data = config()
            data.update(kwargs)
            with self.assertRaises(ValidationError):
                EventTaskPayload(**data)

    def test_match_and_render(self):
        cfg = config(filter_value='客户')
        self.assertTrue(matches(cfg, {'groupName': '客户服务'}))
        self.assertFalse(matches(cfg, {'groupName': '技术'}))
        self.assertEqual(action_payload(cfg, {'groupName': '客户服务', 'groupRemark': '备注'}), {'content': '欢迎加入客户服务', 'target_names': ['备注']})
        with self.assertRaises(ValueError):
            action_payload(cfg, {})
        cfg['content'] = '{{groupRemark}}'
        with self.assertRaises(ValueError):
            action_payload(cfg, {'groupName': '客户服务'})

    def test_dedup_identity(self):
        self.assertEqual(identity({'type': 101, 'groupName': 'a'}), identity({'groupName': 'a', 'type': 101}))
        self.assertEqual(identity({'type': 101, 'eventId': '1', 'extra': 'a'}), identity({'type': 101, 'eventId': '1', 'extra': 'b'}))
        self.assertNotEqual(identity({'type': 101, 'messageId': '1', 'groupName': 'a'}), identity({'type': 101, 'messageId': '1', 'groupName': 'b'}))

    def test_bad_token_rejected_before_db(self):
        service = EventService(SimpleNamespace(AUTH_JWT_SECRET='test', db_conn=Mock()))
        with self.assertRaises(HTTPException):
            service.receive({'id': 1, 'robot_id': 'r'}, {'type': 101}, 'invalid')
        service.host.db_conn.assert_not_called()
        self.assertNotEqual(service.token('r'), service.token('other'))

    def test_http_event_does_not_enter_message_pipeline(self):
        with patch.object(main, '_get_robot_by_id_or_404', return_value={'id': 1, 'robot_id': 'r'}), patch.object(main.event_service, 'receive') as receive, patch.object(main, '_insert_qa_monitor_log') as log:
            response = TestClient(main.app).post('/api/v1/callback/qa/r?event_token=t', json={'type': 101, 'receivedName': None, 'groupName': '群'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['code'], 200)
            receive.assert_called_once()
            log.assert_not_called()

    def test_message_callback_keeps_existing_ack_and_dedup(self):
        with patch.object(main, '_get_robot_by_id_or_404', return_value={'id': 1, 'robot_id': 'r'}), patch.object(main.event_service, 'receive') as receive, patch.object(main, '_is_duplicate_qa_callback', return_value=True), patch.object(main, '_insert_qa_monitor_log') as log:
            client = TestClient(main.app)
            for body in [{'textType': 1, 'spoken': 'hello'}, {'textType': 2}, {'unrelated': 'payload'}]:
                response = client.post('/api/v1/callback/qa/r', json=body)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['code'], 0)
            receive.assert_not_called()
            log.assert_not_called()

    def test_connection_requires_inherited_signed_url_and_enabled_switch(self):
        main.app.dependency_overrides[main.get_current_user] = lambda: {'id': 1}
        try:
            with patch.object(main, 'AUTH_JWT_SECRET', 'test'), patch.object(main, 'build_robot_callback_url', return_value='https://console.example/api/v1/callback/qa/r'), patch.object(main, '_require_robot_access', return_value={'id': 1}), patch.object(main, 'get_robot_event_callback', new=AsyncMock(return_value={'enabled': True, 'event_callback_url': ''})) as config_read:
                expected = main.event_service.callback_url('r')
                async def fetch(path, params):
                    return {'code': 200, 'data': [{'type': 11, 'callBackUrl': expected}] if path.endswith('/get') else {'openCallback': 1}}
                db = MagicMock()
                cursor = db.cursor.return_value.__enter__.return_value
                cursor.fetchone.return_value = None
                with patch.object(main, 'fetch_worktool_api', new=fetch), patch.object(main, 'db_conn', return_value=db):
                    client = TestClient(main.app)
                    state = client.get('/api/v1/event-tasks/connection?robot_id=r').json()
                    self.assertTrue(state['connected'])
                    self.assertIsNone(state['last_event_received_at'])
                    cursor.fetchone.return_value = {'created_at': '2026-10-19T17:00:00'}
                    self.assertEqual(client.get('/api/v1/event-tasks/connection?robot_id=r').json()['last_event_received_at'], '2026-10-19T17:00:00')
                    config_read.return_value = {'enabled': False, 'event_callback_url': ''}
                    self.assertFalse(client.get('/api/v1/event-tasks/connection?robot_id=r').json()['connected'])
                    config_read.return_value = {'enabled': True, 'event_callback_url': 'https://external.example/events'}
                    self.assertFalse(client.get('/api/v1/event-tasks/connection?robot_id=r').json()['connected'])
        finally:
            main.app.dependency_overrides.pop(main.get_current_user, None)

    def test_access_logs_hide_event_token(self):
        record = logging.LogRecord('uvicorn.access', 20, '', 1, '%s %s %s %s %s', ('client', 'POST', '/api/v1/callback/qa/r?event_token=secret', '1.1', 200), None)
        CallbackAccessLogFilter().filter(record)
        self.assertNotIn('secret', record.getMessage())
        self.assertIn('/api/v1/callback/qa/r', record.getMessage())

    def test_new_api_requires_login(self):
        client = TestClient(main.app)
        for path in ['/event-tasks', '/events', '/event-task-runs', '/event-tasks/connection']:
            self.assertIn(client.get('/api/v1' + path + '?robot_id=r').status_code, (401, 403))


@unittest.skipUnless(os.getenv('EVENT_TEST_MYSQL_HOST'), 'requires isolated EVENT_TEST_MYSQL_HOST')
class EventDatabaseTests(unittest.TestCase):
    def setUp(self):
        def db_conn():
            return pymysql.connect(host=os.environ['EVENT_TEST_MYSQL_HOST'], user='root', password='', database='console_events_test', cursorclass=pymysql.cursors.DictCursor, charset='utf8mb4', autocommit=False)
        self.db_conn = db_conn
        conn = db_conn()
        with conn.cursor() as cur:
            for table in ['event_task_runs', 'event_task_cooldowns', 'event_tasks', 'console_events', 'robots', 'users']:
                cur.execute('DROP TABLE IF EXISTS ' + table)
            cur.execute("CREATE TABLE users(id BIGINT PRIMARY KEY,phone VARCHAR(20) DEFAULT 'test',is_active TINYINT DEFAULT 1) ENGINE=InnoDB")
            cur.execute('CREATE TABLE robots(id BIGINT PRIMARY KEY,robot_id VARCHAR(128)) ENGINE=InnoDB')
            cur.execute('INSERT INTO users(id) VALUES(1),(2)')
            cur.execute("INSERT INTO robots VALUES(1,'robot-test'),(2,'other')")
            init_schema(cur)
        conn.commit()
        conn.close()
        self.robot = {'id': 1, 'robot_id': 'robot-test'}
        self.host = SimpleNamespace(app=FastAPI(), AUTH_JWT_SECRET='test', db_conn=db_conn, get_current_user=lambda: {'id': 1}, _require_robot_access=Mock(return_value=self.robot), _reject_demo_robot_write=Mock(), _dispatch_task_action_internal=AsyncMock(return_value={'messageId': 'mock-id'}))
        self.host._build_task_action_items = main._build_task_action_items
        self.host._send_raw_message_batch = AsyncMock(return_value={'item_count': 2})
        self.service = install(self.host)
        self.client = TestClient(self.host.app)
        self.task_id = self.client.post('/api/v1/event-tasks', json=config()).json()['id']

    def sql(self, sql, args=()):
        conn = self.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(sql, args)
                rows = cur.fetchall()
            conn.commit()
            return rows
        finally:
            conn.close()

    def receive(self, **payload):
        body = {'type': 101, 'groupName': '客户群', **payload}
        self.service.receive(self.robot, body, self.service.token('robot-test'))

    def test_legacy_and_status_storage_preserves_payload_and_dedup(self):
        bodies = [{'type': 101, 'textType': 19, 'groupName': '客户群'},
                  {'type': 102, 'groupName': '测试下群事件3'},
                  {'type': 103, 'textType': 20}, {'type': 104, 'textType': 21},
                  {'type': 105, 'textType': 22},
                  {'schemaVersion': 2, 'category': 'event', 'eventType': 'robot.online', 'eventId': 'online'},
                  {'schemaVersion': 2, 'category': 'event', 'eventType': 'robot.offline', 'eventId': 'offline'}]
        for body in bodies:
            for _ in range(2):
                self.service.receive(self.robot, body, self.service.token('robot-test'))
        rows = self.sql('SELECT event_type,payload_json FROM console_events ORDER BY id')
        self.assertEqual([r['event_type'] for r in rows], [101, 102, 103, 104, 105, -1, -2])
        self.assertEqual([json.loads(r['payload_json']) for r in rows], bodies)
        self.assertEqual(len(self.sql('SELECT id FROM event_task_runs')), 1)

    def test_receive_dedup_cooldown_dispatch_and_no_replay(self):
        self.receive()
        self.receive()
        self.receive(groupName='另一个群')
        self.assertEqual(len(self.sql('SELECT id FROM console_events')), 2)
        self.assertEqual([r['status'] for r in self.sql('SELECT status FROM event_task_runs ORDER BY id')], ['queued', 'queued'])
        asyncio.run(self.service.tick())
        asyncio.run(self.service.tick())
        self.assertEqual(self.host._dispatch_task_action_internal.await_count, 2)
        self.host._dispatch_task_action_internal.assert_any_await(1, 'robot-test', 'send_text', {'content': '欢迎加入客户群', 'target_names': ['客户群']})
        self.assertEqual(self.sql('SELECT status FROM event_task_runs ORDER BY id')[0]['status'], 'submitted')
        self.host._reject_demo_robot_write.assert_called_with('robot-test', '事件任务', user={'id': 1, 'phone': 'test', 'is_active': 1})

    def test_group_action_dispatch_uses_event_friend_without_sending_text(self):
        for action in ['create_external_group', 'update_group']:
            task = EventTaskPayload(robot_id='robot-test', name='自动拉群', event_type=105,
                action=action, group_name='服务群', extra_members=['客服']).model_dump()
            response = self.client.post('/api/v1/event-tasks', json=task)
            self.assertEqual(response.status_code, 200)
            self.receive(type=105, friendName='张三', eventId=action)
            asyncio.run(self.service.tick())
            self.host._dispatch_task_action_internal.assert_awaited_with(1, 'robot-test', action,
                {'group_name': '服务群', 'select_list': ['张三', '客服']})
            self.client.delete('/api/v1/event-tasks/' + str(response.json()['id']))

    def create_ordered_friend_task(self, **changes):
        body = {'robot_id': 'robot-test', 'name': '欢迎并拉群', 'event_type': 105,
            'actions': [{'action': 'send_text', 'content': '欢迎{{friendName}}'},
                        {'action': 'update_group', 'target': 'fixed', 'target_names': ['服务群'], 'include_event_friend': True}], **changes}
        response = self.client.post('/api/v1/event-tasks', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['id']

    def test_ordered_dispatch_submits_once_and_different_friends_do_not_cool_each_other(self):
        tid = self.create_ordered_friend_task()
        self.receive(type=105, friendName='甲', eventId='a')
        self.receive(type=105, friendName='乙', eventId='b')
        self.receive(type=105, friendName='甲', eventId='c')
        self.assertEqual([r['status'] for r in self.sql('SELECT status FROM event_task_runs WHERE task_id=%s ORDER BY id', (tid,))], ['queued', 'queued', 'skipped'])
        asyncio.run(self.service.tick())
        asyncio.run(self.service.tick())
        self.assertEqual(self.host._send_raw_message_batch.await_count, 2)
        commands = self.host._send_raw_message_batch.await_args_list[0].args[1]
        self.assertEqual([x['type'] for x in commands], [203, 207])
        self.assertEqual(commands[1]['selectList'], ['甲'])
        self.host._dispatch_task_action_internal.assert_not_awaited()

    def test_callback_to_scheduler_posts_one_ordered_worktool_list(self):
        self.create_ordered_friend_task()
        self.host._send_raw_message_batch = main._send_raw_message_batch
        self.receive(type=105, friendName='甲', eventId='ordered-e2e')
        with patch.object(main, 'post_worktool_api', new=AsyncMock(return_value={'code': 200, 'data': 'mock-message-id'})) as post:
            asyncio.run(self.service.tick())
            post.assert_awaited_once()
            self.assertEqual(post.await_args.args[0], '/wework/sendRawMessage')
            body = post.await_args.kwargs['body']
            self.assertEqual([x['type'] for x in body['list']], [203, 207])
            self.assertEqual(body['list'][0]['receivedContent'], '欢迎甲')
            self.assertEqual(body['list'][1]['selectList'], ['甲'])
        self.assertEqual(self.sql('SELECT status FROM event_task_runs')[0]['status'], 'submitted')

    def test_rule_scope_keeps_global_cooldown_option(self):
        tid = self.create_ordered_friend_task(cooldown_scope='rule')
        self.receive(type=105, friendName='甲', eventId='a')
        self.receive(type=105, friendName='乙', eventId='b')
        self.assertEqual([r['status'] for r in self.sql('SELECT status FROM event_task_runs WHERE task_id=%s ORDER BY id', (tid,))], ['queued', 'skipped'])

    def test_later_missing_variable_prevents_all_submission(self):
        self.create_ordered_friend_task(actions=[{'content': '欢迎'}, {'content': '{{friendRemark}}'}])
        self.receive(type=105, friendName='甲')
        asyncio.run(self.service.tick())
        self.host._send_raw_message_batch.assert_not_awaited()
        self.assertEqual(self.sql('SELECT status FROM event_task_runs')[0]['status'], 'failed')

    def test_ambiguous_ordered_batch_is_not_replayed(self):
        self.create_ordered_friend_task()
        self.receive(type=105, friendName='甲')
        self.host._send_raw_message_batch.side_effect = asyncio.TimeoutError()
        asyncio.run(self.service.tick())
        asyncio.run(self.service.tick())
        self.host._send_raw_message_batch.assert_awaited_once()
        self.assertEqual(self.sql('SELECT status FROM event_task_runs')[0]['status'], 'unknown')

    def test_concurrent_duplicate_ingress(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: self.receive(), range(8)))
        self.assertEqual(len(self.sql('SELECT id FROM console_events')), 1)
        self.assertEqual(len(self.sql('SELECT id FROM event_task_runs')), 1)

    def test_dedup_sliding_window_and_stable_identity(self):
        self.receive(eventId='stable')
        self.sql('UPDATE console_events SET created_at=DATE_SUB(NOW(),INTERVAL 1 DAY)')
        self.receive(eventId='stable')
        self.assertEqual(len(self.sql('SELECT id FROM console_events')), 1)
        self.receive(groupName='new')
        self.sql('UPDATE console_events SET created_at=DATE_SUB(NOW(),INTERVAL 11 SECOND)')
        self.receive(groupName='new')
        self.assertEqual(len(self.sql('SELECT id FROM console_events')), 3)

    def test_concurrent_workers_claim_once(self):
        self.receive()
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda _: asyncio.run(self.service.execute(1)), range(2)))
        self.assertEqual(self.host._dispatch_task_action_internal.await_count, 1)

    def test_worker_restart_recovers_queued_only(self):
        self.receive()
        restarted = EventService(self.host)
        asyncio.run(restarted.tick())
        self.assertEqual(self.sql('SELECT status FROM event_task_runs')[0]['status'], 'submitted')
        self.sql("UPDATE event_task_runs SET status='running',started_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE)")
        asyncio.run(restarted.tick())
        self.assertEqual(self.sql('SELECT status FROM event_task_runs')[0]['status'], 'unknown')
        self.assertEqual(self.host._dispatch_task_action_internal.await_count, 1)

    def test_ambiguous_submission_never_retried(self):
        self.receive()
        self.host._dispatch_task_action_internal.side_effect = asyncio.TimeoutError()
        asyncio.run(self.service.tick())
        asyncio.run(self.service.tick())
        self.assertEqual(self.sql('SELECT status FROM event_task_runs')[0]['status'], 'unknown')
        self.assertEqual(self.host._dispatch_task_action_internal.await_count, 1)

    def test_revoked_permission_prevents_send(self):
        self.receive()
        self.host._require_robot_access.side_effect = HTTPException(403, 'denied')
        asyncio.run(self.service.tick())
        self.assertEqual(self.sql('SELECT status FROM event_task_runs')[0]['status'], 'failed')
        self.host._dispatch_task_action_internal.assert_not_awaited()

    def test_disabled_creator_prevents_send(self):
        self.receive()
        self.sql('UPDATE users SET is_active=0 WHERE id=1')
        asyncio.run(self.service.tick())
        self.assertEqual(self.sql('SELECT status FROM event_task_runs')[0]['status'], 'failed')
        self.host._dispatch_task_action_internal.assert_not_awaited()

    def test_paused_or_deleted_rule_cancels_queued_work(self):
        self.receive()
        data = config(enabled=False)
        self.assertEqual(self.client.put('/api/v1/event-tasks/' + str(self.task_id), json=data).status_code, 200)
        asyncio.run(self.service.tick())
        self.host._dispatch_task_action_internal.assert_not_awaited()
        self.assertEqual(self.client.delete('/api/v1/event-tasks/' + str(self.task_id)).status_code, 200)
        self.assertEqual(len(self.sql('SELECT id FROM event_task_runs')), 1)
        self.assertIsNone(self.sql('SELECT task_id FROM event_task_runs')[0]['task_id'])

    def test_tasks_and_runs_are_scoped_to_creator(self):
        self.receive()
        self.host.app.dependency_overrides[self.host.get_current_user] = lambda: {'id': 2}
        self.assertEqual(self.client.get('/api/v1/event-tasks?robot_id=robot-test').json()['items'], [])
        self.assertEqual(self.client.put('/api/v1/event-tasks/' + str(self.task_id), json=config()).status_code, 404)
        self.assertEqual(self.client.delete('/api/v1/event-tasks/' + str(self.task_id)).status_code, 404)
        self.assertEqual(self.client.get('/api/v1/events?robot_id=robot-test').json()['items'][0]['runs'], [])
        self.assertEqual(self.client.get('/api/v1/event-task-runs?robot_id=robot-test').json()['total'], 0)

    def test_unknown_event_recorded_without_automation(self):
        self.receive(type=512)
        self.assertEqual(len(self.sql('SELECT id FROM console_events')), 1)
        self.assertEqual(self.sql('SELECT id FROM event_task_runs'), ())

    def test_transaction_failure_rolls_back_event_and_run(self):
        self.sql('DROP TABLE event_task_runs')
        with self.assertRaises(pymysql.Error):
            self.receive()
        self.assertEqual(self.sql('SELECT id FROM console_events'), ())

    def test_missing_target_or_variable_fails_without_send(self):
        self.receive(groupName='')
        asyncio.run(self.service.tick())
        self.assertEqual(self.sql('SELECT status FROM event_task_runs')[0]['status'], 'failed')
        self.host._dispatch_task_action_internal.assert_not_awaited()

    def test_expired_queue_skipped_and_old_records_cleaned(self):
        self.receive()
        self.sql('UPDATE event_task_runs SET created_at=DATE_SUB(NOW(),INTERVAL 11 MINUTE)')
        asyncio.run(self.service.tick())
        self.assertEqual(self.sql('SELECT status FROM event_task_runs')[0]['status'], 'skipped')
        self.host._dispatch_task_action_internal.assert_not_awaited()
        self.sql('UPDATE console_events SET created_at=DATE_SUB(NOW(),INTERVAL 31 DAY)')
        asyncio.run(self.service.tick())
        self.assertEqual(self.sql('SELECT id FROM console_events'), ())
        self.assertEqual(self.sql('SELECT id FROM event_task_runs'), ())


if __name__ == '__main__':
    unittest.main()
