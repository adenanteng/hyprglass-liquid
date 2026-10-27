import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'scripts/refresh-gtk-portal.py'
spec = importlib.util.spec_from_file_location('refresh_portal', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PortalRefreshTest(unittest.TestCase):
    def setUp(self):
        self.sync = patch.object(module, 'sync_appearance').start()
        self.addCleanup(patch.stopall)

    @patch.object(module.subprocess, 'run')
    @patch.object(module.subprocess, 'check_output', return_value='[]')
    def test_idle_refreshes_only_gtk_backend(self, clients, run):
        module.refresh()
        run.assert_called_once_with(['systemctl', '--user', 'try-restart', 'xdg-desktop-portal-gtk.service'], check=True)

    @patch.object(module.time, 'sleep')
    @patch.object(module.subprocess, 'run')
    @patch.object(module.subprocess, 'check_output', side_effect=['[{"class":"xdg-desktop-portal-gtk"}]', '[]'])
    def test_open_dialog_defers_refresh(self, clients, run, sleep):
        def wait(_):
            run.assert_not_called()
        sleep.side_effect = wait
        module.refresh()
        sleep.assert_called_once_with(1)
        run.assert_called_once()

    @patch.object(module.subprocess, 'run')
    @patch.object(module.subprocess, 'check_output', return_value='not-json')
    def test_invalid_state_never_restarts(self, clients, run):
        with self.assertRaises(ValueError):
            module.refresh()
        run.assert_not_called()


class AppearanceSyncTest(unittest.TestCase):
    @patch.object(module.subprocess, 'run')
    @patch.object(module.subprocess, 'check_output')
    def test_both_gtk_versions_follow_theme_and_keep_other_settings(self, mode, run):
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'HOME', Path(directory)):
            paths = [Path(directory) / '.config' / ('gtk-' + version) / 'settings.ini' for version in ('3.0', '4.0')]
            for path in paths:
                path.parent.mkdir(parents=True)
                path.write_text('[Settings]\ngtk-theme-name=adw-gtk3-dark\ngtk-application-prefer-dark-theme=1\ngtk-font-name=Plus Jakarta Sans 10\ngtk-cursor-theme-name=Bibata-Modern-Ice\n')
            for value, theme in [('light', 'adw-gtk3'), ('dark', 'adw-gtk3-dark')]:
                mode.return_value = value + '\n'
                module.sync_appearance()
                for path in paths:
                    text = path.read_text()
                    self.assertIn('gtk-theme-name=' + theme + '\n', text)
                    self.assertIn('gtk-application-prefer-dark-theme=0\n', text)
                    self.assertIn('gtk-font-name=Plus Jakarta Sans 10\n', text)
                    self.assertIn('gtk-cursor-theme-name=Bibata-Modern-Ice\n', text)
                self.assertEqual((Path(directory) / '.config/hyprglass-local/xsettingsd.conf').read_text(), 'Net/ThemeName "' + theme + '"\n')
            self.assertEqual(run.call_count, 2)
            module.sync_appearance()
            self.assertEqual(run.call_count, 2, 'Unchanged theme should not reload XSettings')

    @patch.object(module.subprocess, 'check_output', return_value='unexpected')
    def test_unknown_mode_is_rejected(self, mode):
        with self.assertRaises(ValueError):
            module.sync_appearance()


if __name__ == '__main__':
    unittest.main()
