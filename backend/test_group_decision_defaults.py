import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import main


class DecisionDefaultsTest(unittest.TestCase):
    def test_official_engine_is_selected_when_none_given(self):
        conn = MagicMock()
        conn.cursor.return_value.__enter__.return_value.fetchone.return_value = {'id': 12}
        with patch.object(main, '_default_test_provider_enabled', return_value=True), patch.object(main, 'ensure_default_test_provider'), patch.object(main, 'db_conn', return_value=conn):
            self.assertEqual(main._resolve_group_decision_provider_id(None, 1), 12)
        conn.close.assert_called_once()

    def test_custom_engine_is_preserved_and_access_checked(self):
        with patch.object(main, '_provider_accessible_by_user', return_value=True) as access, patch.object(main, 'db_conn') as db:
            self.assertEqual(main._resolve_group_decision_provider_id(37, 1, 4), 37)
        access.assert_called_once_with(37, 1, 4)
        db.assert_not_called()

    def test_inaccessible_custom_engine_is_not_silently_replaced(self):
        with patch.object(main, '_provider_accessible_by_user', return_value=False):
            with self.assertRaises(main.HTTPException) as error:
                main._resolve_group_decision_provider_id(37, 1)
        self.assertEqual(error.exception.status_code, 400)

    def test_missing_official_engine_has_actionable_error(self):
        with patch.object(main, '_default_test_provider_enabled', return_value=False):
            with self.assertRaises(main.HTTPException) as error:
                main._resolve_group_decision_provider_id(None, 1)
        self.assertIn('高级个性化设置', error.exception.detail)


class DecisionUpdateTest(unittest.IsolatedAsyncioTestCase):
    async def update(self, body, current_provider):
        conn = MagicMock()
        robot = {'id': 4, 'robot_id': 'test', 'group_reply_mode': 'ai_decide', 'group_decision_provider_id': current_provider}
        with patch.object(main, '_require_robot_access', return_value=robot), patch.object(main, '_reject_demo_robot_write'), patch.object(main, '_resolve_group_decision_provider_id', return_value=12) as resolve, patch.object(main, 'db_conn', return_value=conn):
            await main.update_robot('test', body, {'id': 1})
        return conn.cursor.return_value.__enter__.return_value.execute.call_args, resolve

    async def test_enabling_ai_selects_official_engine_and_persists_it(self):
        execute, resolve = await self.update(main.RobotUpdate(group_reply_mode='ai_decide'), None)
        resolve.assert_called_once_with(None, 1, 4)
        self.assertIn('group_decision_provider_id=%s', execute.args[0])
        self.assertIn(12, execute.args[1])

    async def test_editing_name_keeps_custom_engine(self):
        execute, resolve = await self.update(main.RobotUpdate(name='new name'), 37)
        resolve.assert_not_called()
        self.assertNotIn('group_decision_provider_id', execute.args[0])

    async def test_clear_custom_selection_uses_official_engine(self):
        execute, resolve = await self.update(main.RobotUpdate(group_decision_provider_id=None), 37)
        resolve.assert_called_once_with(None, 1, 4)
        self.assertIn(12, execute.args[1])


class DecisionCreateTest(unittest.IsolatedAsyncioTestCase):
    async def test_create_ai_robot_persists_default_engine(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = None
        cursor.lastrowid = 4
        with patch.object(main, 'db_conn', return_value=conn), patch.object(main, 'validate_worktool_robot_exists', new=AsyncMock()), patch.object(main, 'build_robot_callback_url', return_value='https://example.com/callback'), patch.object(main, 'get_setting', return_value='false'), patch.object(main, '_resolve_group_decision_provider_id', return_value=12) as resolve, patch.object(main, '_provider_accessible_by_user', return_value=True), patch.object(main, 'ensure_default_message_callback', new=AsyncMock(return_value={})):
            await main.create_robot(main.RobotCreate(robot_id='test', group_reply_mode='ai_decide'), {'id': 1})
        resolve.assert_called_once_with(None, 1)
        insert = next(call for call in cursor.execute.call_args_list if 'INSERT INTO robots(' in call.args[0])
        self.assertEqual(insert.args[1][6], 12)
