import base64
import hashlib
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15
from fastapi import HTTPException

import main


def _base64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class PrivateLicenseV2Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private_key = RSA.generate(3072)
        cls.private_key_base64 = base64.b64encode(cls.private_key.export_key(format="PEM", passphrase=None, pkcs=8)).decode("ascii")
        cls.public_key_sha256 = hashlib.sha256(cls.private_key.public_key().export_key(format="DER")).hexdigest()

    def _request(self, version: int = 2, restrict_robot: bool = True):
        expire_date = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
        expire_at = datetime.strptime(expire_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        expire_epoch_ms = int((expire_at + timedelta(hours=23, minutes=59, seconds=59)).timestamp() * 1000)
        return main.PrivateLicenseGenerateRequest(
            license_version=version,
            machine_code="a" * 64,
            remark="unit test",
            expire_date=expire_date,
            expire_epoch_ms=expire_epoch_ms,
            restrict_robot=restrict_robot,
            robot_start="20260001" if restrict_robot else None,
            robot_end="20260003" if restrict_robot else None,
            robot_limit=3 if restrict_robot else None,
        )

    def test_v2_license_matches_worktool_signing_protocol(self):
        with patch.object(main, "PRIVATE_LICENSE_V2_PRIVATE_KEY_BASE64", self.private_key_base64), patch.object(
            main, "PRIVATE_LICENSE_V2_PUBLIC_KEY_SHA256", self.public_key_sha256
        ):
            raw = main._generate_private_license(self._request())

        wrapper = json.loads(raw)
        self.assertEqual(2, wrapper["v"])
        self.assertEqual("RS256", wrapper["alg"])
        self.assertEqual(main.PRIVATE_LICENSE_V2_KEY_ID, wrapper["kid"])

        payload = json.loads(_base64url_decode(wrapper["payload"]).decode("utf-8"))
        self.assertEqual("a" * 64, payload["machineHash"])
        self.assertEqual("worktool-official", payload["issuer"])
        self.assertEqual("20260001", payload["robotIdStart"])
        self.assertEqual("20260003", payload["robotIdEnd"])
        self.assertEqual(3, payload["robotLimit"])

        signing_input = (
            f"WORKTOOL-LICENSE.2.RS256.{wrapper['kid']}.{wrapper['payload']}"
        ).encode("ascii")
        pkcs1_15.new(self.private_key.public_key()).verify(
            SHA256.new(signing_input), _base64url_decode(wrapper["signature"])
        )

    def test_v2_can_generate_unrestricted_license(self):
        with patch.object(main, "PRIVATE_LICENSE_V2_PRIVATE_KEY_BASE64", self.private_key_base64), patch.object(
            main, "PRIVATE_LICENSE_V2_PUBLIC_KEY_SHA256", self.public_key_sha256
        ):
            wrapper = json.loads(main._generate_private_license(self._request(restrict_robot=False)))
        payload = json.loads(_base64url_decode(wrapper["payload"]).decode("utf-8"))
        self.assertNotIn("robotIdStart", payload)
        self.assertNotIn("robotIdEnd", payload)
        self.assertNotIn("robotLimit", payload)

    def test_v2_rejects_key_not_matching_worktool_public_key(self):
        with patch.object(main, "PRIVATE_LICENSE_V2_PRIVATE_KEY_BASE64", self.private_key_base64), patch.object(
            main, "PRIVATE_LICENSE_V2_PUBLIC_KEY_SHA256", "0" * 64
        ):
            with self.assertRaises(HTTPException) as context:
                main._generate_private_license(self._request())
        self.assertEqual(503, context.exception.status_code)

    def test_v1_remains_available(self):
        with patch.object(main, "PRIVATE_LICENSE_SECRET_KEY", "1234567890abcdef"):
            wrapper = json.loads(main._generate_private_license(self._request(version=1)))
        self.assertEqual(1, wrapper["v"])
        self.assertTrue(wrapper["data"])


if __name__ == "__main__":
    unittest.main()
