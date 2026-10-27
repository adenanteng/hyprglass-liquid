"""Validate GTK3 material in both themes without changing desktop settings."""
from pathlib import Path
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('Handy', '1')
from gi.repository import Gtk, Gdk, Handy
Handy.init()

root = Path(__file__).resolve().parents[1]
css = (root / 'config/gtk3-glass.css').read_text()
settings = Gtk.Settings.get_default()
assert settings is not None, 'Run in a desktop session (or under xvfb-run)'

def walk(widget):
    yield widget
    if isinstance(widget, Gtk.Container):
        for child in widget.get_children():
            yield from walk(child)

# Each palette is loaded fresh, matching the idle portal refresh after a theme change.
for mode, bg, fg, sidebar in [('dark', '#242424', '#ffffff', '#1e1e1e'),
                              ('light', '#fafafa', '#202020', '#f2f2f2')]:
    settings.set_property('gtk-theme-name', 'adw-gtk3-dark' if mode == 'dark' else 'adw-gtk3')
    settings.set_property('gtk-application-prefer-dark-theme', False)
    palette = ''.join(f'@define-color {name} {value};\n' for name, value in {
        'window_bg_color': bg, 'window_fg_color': fg, 'view_bg_color': bg,
        'view_fg_color': fg, 'sidebar_bg_color': sidebar, 'sidebar_fg_color': fg,
        'accent_bg_color': '#3584e4', 'accent_fg_color': '#ffffff',
    }.items())
    provider = Gtk.CssProvider()
    errors = []
    provider.connect('parsing-error', lambda p, section, error: errors.append(str(error)))
    provider.load_from_data((palette + css).encode())
    assert not errors, errors
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_USER + 1)
    dialog = Gtk.FileChooserDialog(title='Glass CSS check', action=Gtk.FileChooserAction.OPEN, use_header_bar=True)
    expected = {'GtkFileChooserDialog': .50, 'GtkPlacesSidebar': .20, 'GtkTreeView': 0., 'GtkHeaderBar': 0.}
    found = set()
    for widget in walk(dialog):
        kind = widget.__gtype__.name
        if kind not in expected:
            continue
        found.add(kind)
        context = widget.get_style_context()
        color = context.get_property('background-color', Gtk.StateFlags.NORMAL)
        assert abs(color.alpha - expected[kind]) < .001, (mode, kind, color.to_string())
        foreground = context.get_color(Gtk.StateFlags.NORMAL)
        assert (foreground.red > .9 if mode == 'dark' else foreground.red < .2), (mode, kind, foreground.to_string())
        assert widget.get_opacity() == 1., (mode, kind, 'foreground faded')
    assert found == expected.keys(), found
    window = Gtk.Window()
    card = Gtk.FlowBoxChild()
    card.get_style_context().add_class('package-box')
    window.add(card)
    context = card.get_style_context()
    assert abs(context.get_property('background-color', Gtk.StateFlags.NORMAL).alpha - .18) < .001
    assert context.get_property('border-radius', Gtk.StateFlags.NORMAL) == 14
    # Pamac uses libhandy's real view switcher, whose theme paints an opaque image.
    tabs_window = Gtk.Window()
    header = Gtk.HeaderBar()
    tabs_window.set_titlebar(header)
    pages = Gtk.Stack()
    for title in ['Browse', 'Installed', 'Updates']:
        pages.add_titled(Gtk.Label(label=title), title, title)
    switcher = Handy.ViewSwitcher()
    switcher.set_stack(pages)
    header.set_custom_title(switcher)
    tabs_window.add(pages)
    buttons = [widget for widget in walk(switcher) if isinstance(widget, Gtk.ToggleButton)]
    assert len(buttons) == 3
    for state in [Gtk.StateFlags.NORMAL, Gtk.StateFlags.CHECKED,
                  Gtk.StateFlags.PRELIGHT, Gtk.StateFlags.CHECKED | Gtk.StateFlags.PRELIGHT,
                  Gtk.StateFlags.BACKDROP, Gtk.StateFlags.CHECKED | Gtk.StateFlags.BACKDROP]:
        for button in buttons:
            context = button.get_style_context()
            assert context.get_property('background-image', state) is None, (mode, state, 'solid tab image')
            assert context.get_property('background-color', state).alpha == 0., (mode, state, 'solid tab color')
    tabs_window.destroy()
    dialog.destroy()
    window.destroy()
    Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default(), provider)
    print(f'{mode}: chooser, sidebar, text opacity, Pamac cards and tab states passed')
