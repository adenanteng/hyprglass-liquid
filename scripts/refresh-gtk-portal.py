"""Sync GTK/XSettings appearance, then reload cached portal colors when idle."""
import json
from pathlib import Path
import configparser
import io
import subprocess
import time

HOME = Path.home()


def sync_appearance():
    mode = subprocess.check_output(['noctalia', 'msg', 'theme-mode-get'], text=True).strip()
    if mode not in ('dark', 'light'):
        raise ValueError('Unexpected Noctalia theme mode: ' + mode)
    theme = 'adw-gtk3-dark' if mode == 'dark' else 'adw-gtk3'
    for version in ('3.0', '4.0'):
        path = HOME / '.config' / ('gtk-' + version) / 'settings.ini'
        settings = configparser.ConfigParser(interpolation=None)
        settings.optionxform = str
        settings.read(path)
        if not settings.has_section('Settings'):
            settings.add_section('Settings')
        if settings['Settings'].get('gtk-theme-name') == theme and settings['Settings'].get('gtk-application-prefer-dark-theme') == '0':
            continue
        settings['Settings']['gtk-theme-name'] = theme
        settings['Settings']['gtk-application-prefer-dark-theme'] = '0'
        output = io.StringIO()
        settings.write(output, space_around_delimiters=False)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.ini.tmp')
        temporary.write_text(output.getvalue())
        temporary.replace(path)
    path = HOME / '.config/hyprglass-local/xsettingsd.conf'
    content = 'Net/ThemeName "' + theme + '"\n'
    if not path.exists() or path.read_text() != content:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.conf.tmp')
        temporary.write_text(content)
        temporary.replace(path)
        subprocess.run(['systemctl', '--user', 'reload-or-restart', 'hyprglass-xsettings.service'], check=True)


def refresh():
    sync_appearance()
    while True:
        clients = json.loads(subprocess.check_output(['hyprctl', '-j', 'clients'], text=True))
        if not any(client['class'] == 'xdg-desktop-portal-gtk' for client in clients):
            break
        time.sleep(1)
    # An inactive backend reads the latest CSS on its next activation.
    subprocess.run(['systemctl', '--user', 'try-restart', 'xdg-desktop-portal-gtk.service'], check=True)


if __name__ == '__main__':
    refresh()
