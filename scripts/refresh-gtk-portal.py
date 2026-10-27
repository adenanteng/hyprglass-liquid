"""Reload GTK's cached palette after Noctalia changes it, once dialogs are closed."""
import json
import subprocess
import time


def refresh():
    while True:
        clients = json.loads(subprocess.check_output(['hyprctl', '-j', 'clients'], text=True))
        if not any(client['class'] == 'xdg-desktop-portal-gtk' for client in clients):
            break
        time.sleep(1)
    # An inactive backend reads the latest CSS on its next activation.
    subprocess.run(['systemctl', '--user', 'try-restart', 'xdg-desktop-portal-gtk.service'], check=True)


if __name__ == '__main__':
    refresh()
