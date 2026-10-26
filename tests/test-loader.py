import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MOCK = '''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['MOCK_ROOT'])
state = root / 'state'
args = sys.argv[1:]
with (root / 'calls').open('a') as f: f.write(pathlib.Path(sys.argv[0]).name + ' ' + ' '.join(args) + '\\n')
if pathlib.Path(sys.argv[0]).name == 'hyprpm':
    if not state.exists(): state.write_text('stock')
elif args == ['-j', 'version']: print(json.dumps({'abiHash': os.environ['MOCK_ABI']}))
elif args == ['-j', 'plugin', 'list']:
    value = state.read_text() if state.exists() else ''
    print(json.dumps([{'name': 'hyprglass', 'version': '0.10.0-optical-rim' if value == 'local' else '0.10.0'}] if value else []))
elif args[:2] == ['plugin', 'unload']:
    state.unlink(missing_ok=True)
elif args[:2] == ['plugin', 'load']:
    if os.environ.get('MOCK_FAIL') == '1': sys.exit(1)
    state.write_text('local')
elif args == ['hyprglass', 'status'] and state.exists() and state.read_text() == 'local': print('hyprglass 0.10.0-optical-rim: active\\nshaders: ready')
'''

class LoaderTest(unittest.TestCase):
    def run_loader(self, abi='matching', fail=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            install = root / 'data/hyprglass-local'
            install.mkdir(parents=True)
            (install / 'abi').write_text('matching\n')
            (install / 'plugin.so').touch()
            (install / 'plugin-path').write_text(str(install / 'plugin.so'))
            for command in ('hyprctl', 'hyprpm'):
                p = root / command
                p.write_text(MOCK)
                p.chmod(0o755)
            env = dict(os.environ, PATH=str(root)+os.pathsep+os.environ['PATH'],
                       XDG_DATA_HOME=str(root/'data'), XDG_STATE_HOME=str(root/'logs'),
                       MOCK_ROOT=str(root), MOCK_ABI=abi, MOCK_FAIL='1' if fail else '0')
            result = subprocess.run(['bash', str(ROOT/'scripts/load-local.sh')], env=env)
            return result.returncode, (root/'state').read_text(), (root/'calls').read_text()

    def test_matching_abi_loads_local(self):
        code, state, calls = self.run_loader()
        self.assertEqual((code, state), (0, 'local'))
        self.assertIn('plugin unload', calls)

    def test_changed_abi_keeps_managed(self):
        code, state, calls = self.run_loader('changed')
        self.assertEqual((code, state), (0, 'stock'))
        self.assertNotIn('plugin load', calls)

    def test_failed_local_load_restores_managed(self):
        code, state, _ = self.run_loader(fail=True)
        self.assertEqual((code, state), (1, 'stock'))

if __name__ == '__main__':
    unittest.main()
