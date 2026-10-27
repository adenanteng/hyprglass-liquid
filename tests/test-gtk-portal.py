import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'scripts/refresh-gtk-portal.py'
spec = importlib.util.spec_from_file_location('refresh_portal', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PortalRefreshTest(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
