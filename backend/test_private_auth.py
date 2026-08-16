import unittest
from unittest.mock import patch

import main


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


if __name__ == "__main__":
    unittest.main()
