import unittest
from unittest.mock import patch

import main
from fastapi import HTTPException


class PrivateAccountValidationTests(unittest.TestCase):
    def test_private_username_and_existing_phone_are_accepted(self):
        self.assertTrue(main._is_valid_login_account("admin"))
        self.assertTrue(main._is_valid_login_account("user.name-01"))
        self.assertTrue(main._is_valid_login_account("13800138000"))

    def test_invalid_usernames_are_rejected(self):
        for value in ("ab", "1username", "user name", "user@name", "a" * 21):
            with self.subTest(value=value):
                self.assertFalse(main._is_valid_private_account(value))

    def test_username_is_normalized_and_private_admin_is_superuser(self):
        self.assertEqual(main._normalize_login_account("Admin"), "admin")
        self.assertTrue(main._is_admin_phone("ADMIN"))

    def test_saas_never_enables_or_initializes_private_admin(self):
        with patch.object(main, "APP_DEPLOYMENT_MODE", "saas"):
            self.assertFalse(main._is_admin_phone(main.PRIVATE_ADMIN_USERNAME))
            # Must return before opening a database connection.
            with patch.object(main, "db_conn", side_effect=AssertionError("db must not be touched")):
                main.ensure_private_admin()

    def test_admin_accounts_cannot_be_disabled(self):
        with self.assertRaises(HTTPException) as ctx:
            main._require_user_status_change_allowed(main.PRIVATE_ADMIN_USERNAME, False)
        self.assertEqual(ctx.exception.status_code, 403)

        with patch.object(main, "ADMIN_PHONE_WHITELIST", {"manager_user"}):
            with self.assertRaises(HTTPException) as other_admin_ctx:
                main._require_user_status_change_allowed("manager_user", False)
        self.assertEqual(other_admin_ctx.exception.status_code, 403)

    def test_normal_users_can_be_disabled_or_enabled(self):
        main._require_user_status_change_allowed("normal_user", False)
        main._require_user_status_change_allowed("normal_user", True)

    def test_admin_accounts_can_remain_enabled(self):
        main._require_user_status_change_allowed(main.PRIVATE_ADMIN_USERNAME, True)


if __name__ == "__main__":
    unittest.main()
