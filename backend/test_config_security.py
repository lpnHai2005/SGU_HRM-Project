"""Fail-fast coverage for required backend secrets and database URLs."""

import os
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from app.core.config import Settings, _load_settings, settings


REQUIRED_SECRET_SETTINGS = ("DATABASE_URL", "SYNC_DATABASE_URL", "JWT_SECRET_KEY")


class SettingsSecurityTests(unittest.TestCase):
    def test_database_and_jwt_settings_are_required_without_defaults(self):
        for name in REQUIRED_SECRET_SETTINGS:
            self.assertTrue(Settings.model_fields[name].is_required(), name)

    def test_blank_database_and_jwt_settings_are_rejected(self):
        with self.assertRaises(ValidationError):
            Settings(
                _env_file=None,
                DATABASE_URL="",
                SYNC_DATABASE_URL="",
                JWT_SECRET_KEY="",
            )

    def test_startup_error_names_missing_settings_without_echoing_values(self):
        blank = {name: "" for name in REQUIRED_SECRET_SETTINGS}
        with patch.dict(os.environ, blank):
            with self.assertRaises(RuntimeError) as caught:
                _load_settings(env_file=None)

        message = str(caught.exception)
        for name in REQUIRED_SECRET_SETTINGS:
            self.assertIn(name, message)
        self.assertNotIn("password=", message.lower())
        self.assertNotIn("secret-manager-marker", message)

    def test_current_configuration_keeps_ot_policy_disabled(self):
        self.assertEqual(settings.OT_REGISTRATION_POLICY_MODE, "DISABLED")


if __name__ == "__main__":
    unittest.main()
