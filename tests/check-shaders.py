"""Compile every glass feature combination and keep the render fixture in sync."""
from pathlib import Path
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
shaders = dict(re.findall(r'\{"([^"]+)", R"GLSL\((.*?)\)GLSL"\}',
                          (root / 'src/Shaders.hpp').read_text(), re.S))
glass = shaders.pop('liquidglass.frag').lstrip('\n')
assert glass == (root / 'tests/relief.frag').read_text(), 'Render fixture is stale'
features = re.findall(r'SGlassFeatureDefine\{[^,]+, "([^"]+)"\}',
                      (root / 'src/ShaderVariants.hpp').read_text())
assert len(features) == 4
with tempfile.TemporaryDirectory(prefix='hyprglass-shaders-') as directory:
    path = Path(directory) / 'shader.frag'
    for mask in range(1 << len(features)):
        defines = ''.join(f'#define {name} 1\n' for bit, name in enumerate(features) if mask & (1 << bit))
        version, source = glass.split('\n', 1)
        path.write_text(version + '\n' + defines + source)
        subprocess.run(['glslangValidator', '-S', 'frag', str(path)], check=True)
    for name, source in shaders.items():
        path.write_text(source.lstrip('\n'))
        subprocess.run(['glslangValidator', '-S', name.rsplit('.', 1)[1], str(path)], check=True)
print(f'All 16 glass feature variants and {len(shaders)} auxiliary shaders passed.')
