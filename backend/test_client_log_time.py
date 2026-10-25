import unittest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
import main

class TimeLogTests(unittest.IsolatedAsyncioTestCase):
    def test_time_validation(self):
        body = main.ClientLogTimeRequest(robot_id=' robot ', start_time='2026-10-25 11:02:00', end_time='2026-10-25 11:02:00')
        self.assertEqual(main._validate_client_log_time(body), {'robotId': 'robot', 'startTime': body.start_time, 'endTime': body.end_time})
        for start, end in [('2026-10-25 11:03:00', body.end_time), ('2026-02-30 11:00:00', body.end_time), ('2026-10-25T11:00:00Z', body.end_time)]:
            with self.assertRaises(HTTPException):
                main._validate_client_log_time(main.ClientLogTimeRequest(robot_id='robot', start_time=start, end_time=end))

    async def test_list_states(self):
        for rows, status in [([], 'pending'), ([{'errorCode': 0}], 'success'), ([{'errorCode': 1, 'errorReason': 'unsupported'}], 'failed')]:
            with patch.object(main, '_require_admin'), patch.object(main, 'fetch_worktool_api', new_callable=AsyncMock, return_value={'code': 200, 'data': {'total': len(rows), 'list': rows}}) as fetch:
                result = await main.admin_client_log_time_result(' robot ', '2114200000000000000', {})
                self.assertEqual(result['status'], status)
                fetch.assert_awaited_once_with('/robot/clientLogSnippet/list', {'robotId': 'robot', 'requestMessageId': '2114200000000000000'})

    async def test_bad_upstream(self):
        for response in [{'code': 500, 'message': 'error'}, {'code': 200, 'data': {}}]:
            with patch.object(main, '_require_admin'), patch.object(main, 'fetch_worktool_api', new_callable=AsyncMock, return_value=response), self.assertRaises(HTTPException):
                await main.admin_client_log_time_result('robot', '123', {})

    async def test_admin_required(self):
        with patch.object(main, '_require_admin', side_effect=HTTPException(403)), patch.object(main, 'fetch_worktool_api', new_callable=AsyncMock) as fetch, self.assertRaises(HTTPException):
            await main.admin_client_log_time_result('robot', '123', {})
        fetch.assert_not_awaited()
