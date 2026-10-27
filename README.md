<div align="center">

# HyprGlass Liquid

**Backdrop-colored glass rims for Hyprland and Noctalia.**

Refraction, soft highlights, and continuous panel contours — while opaque application content stays opaque.

[![License: BSD-3-Clause](https://img.shields.io/badge/license-BSD--3--Clause-blue.svg)](LICENSE)
[![Hyprland: tested 0.56.2](https://img.shields.io/badge/Hyprland-tested%200.56.2-58c4dc)](#compatibility)
[![Noctalia: tested 5.2.1](https://img.shields.io/badge/Noctalia-tested%205.2.1-b99aff)](#compatibility)
[![Status: experimental](https://img.shields.io/badge/status-experimental-e5b567)](#known-limitations)

[Features](#features) · [Installation](#installation) · [Configuration](#configuration) · [Testing](#testing) · [Troubleshooting](#troubleshooting) · [Rollback](#rollback)

</div>

---

This is a desktop-focused modification of [HyprGlass](https://github.com/hyprnux/hyprglass), based on its **v0.11.0** source from the stable `hyprland-0.56` branch. It refines the glass treatment around application windows and Noctalia surfaces, with particular attention to the junction between a top bar and its attached dropdown.

The `liquid-glass` branch contains this modification and retains the upstream **v0.11.0** commit history (`7fc328064c63d9fbaaac8d8204eadf85dcdeae19`). The fork's `main` branch follows upstream and does not contain these customizations. Clone `liquid-glass` explicitly until it is selected as the repository's default branch.

The visual direction is inspired by Liquid Glass. This project is independent of Apple and does not reproduce the macOS renderer.

> **Build for your compositor.** This is a native Hyprland plugin, not a theme-only package. The supplied loader checks the recorded Hyprland ABI before loading the local binary. Matching headers and a fresh build are still required after compositor updates.

## Features

| Detail | Behavior |
| --- | --- |
| Backdrop-colored rims | Edge color comes from the sampled background, refraction, and highlights. |
| One glass material | Body and rim use the same blurred backdrop; there is no separate sharp rim texture. |
| Alpha-aware contours | Refraction and bevels follow the visible surface rather than its padded rectangular bounds. |
| Connected bar and dropdown | Shared interior edges are excluded from the rim, including the join's antialias fade. |
| Monitor-edge handling | A surface clipped by the monitor edge does not receive an artificial rim there. The free bottom edge of a top bar remains visible. |
| Subpixel contour refinement | Linear alpha sampling, eight search directions, and eight refinement steps reduce uneven rim widths. |
| Solid application content | Decorated windows can retain opaque content with a four-logical-pixel glass strip outside the client area. |
| Neutral shell treatment | The supplied shell presets avoid extra tint, desaturation, and adaptive dimming. |
| Managed-plugin fallback | The loader returns to the hyprpm load path when local metadata is missing, the ABI changes, or local initialization fails. |

Opaque applications remain opaque. Whole-window opacity also affects text, images, and video; this project does not attempt to identify or remove application backgrounds from flattened pixels. Applications with their own transparent backgrounds can retain that behavior.

## Compatibility

The following describes the configuration tested during development, not a support matrix for every release.

| Component | Tested version / setup |
| --- | --- |
| Operating system | Manjaro Linux |
| Hyprland | **0.56.2** |
| HyprGlass source baseline | **v0.11.0** |
| Local plugin version string | `0.11.0-optical-rim` |
| Noctalia | **5.2.1**, native shell |
| Configuration format | Hyprland Lua |
| Attached-panel layout | Top bar with an attached dropdown |

The local version string is used by both the configuration and loader. Build with the explicit version flag shown below; an arbitrary version string will not enable the supplied window-rim configuration.

### Requirements

For the plugin build:

- A running Hyprland session and **matching Hyprland development headers**.
- A C++23 compiler, C compiler, GNU Make, and `pkg-config`.
- The development dependencies used by the Makefile: Hyprland, Pixman, libdrm, and Wayland server libraries.
- `wayland-scanner` for the protocol helper.

For the startup loader:

- Bash, `jq`, `flock`, `hyprctl`, and `hyprpm`.
- A working upstream HyprGlass installation managed by hyprpm, available for fallback.

For optional checks: Python 3, `glslangValidator`, EGL/GLES development libraries, and Mesa's surfaceless EGL support for the software-rendered shader fixture.

## Installation

Run commands from the repository root unless a step says otherwise. The examples use the default user-local executable directory and respect XDG data, state, and configuration directories.

### 1. Clone and build

```bash
git clone --branch liquid-glass https://github.com/adenanteng/hyprglass-liquid.git
cd hyprglass-liquid

hyprctl version
pkg-config --modversion hyprland

make clean
make -j2 HYPRGLASS_VERSION=0.11.0-optical-rim
```

The output is `hyprglass.so`. Confirm that the installed headers target the running compositor before proceeding. Version labels alone do not prove that every ABI dependency matches.

Use the manual build instructions in this README for this modification. The inherited `hyprpm.toml` contains upstream release pins; it is not a maintained installation manifest for this fork's changes.

### 2. Prepare the upstream fallback

If you already have a working, enabled HyprGlass installation in hyprpm, keep it. Otherwise, follow the [upstream installation notes](README.upstream.md) for your Hyprland version and verify it before replacing the runtime plugin.

```bash
hyprpm list
```

The loader expects the managed plugin under either:

```text
${XDG_CACHE_HOME:-$HOME/.cache}/hyprpm/$USER/HyprGlass/hyprglass.so
/var/cache/hyprpm/$USER/HyprGlass/hyprglass.so
```

If your system uses another location, adjust `stock_path` in `scripts/load-local.sh` before installing the loader. Fallback depends on the upstream plugin being installed, enabled, and compatible with the running compositor.

### 3. Save configuration backups

```bash
glass_config_root="${XDG_CONFIG_HOME:-$HOME/.config}"
glass_state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/hyprglass-local"
glass_backup_dir="$glass_state_dir/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$glass_backup_dir"
cp -a "$glass_config_root/hypr/hyprland.lua" "$glass_backup_dir/"
```

Also back up Noctalia's settings file before merging the visual options. In the tested setup, it is `~/.local/state/noctalia/settings.toml`.

### 4. Install a uniquely named binary and the loader

Never overwrite a shared library that the compositor currently has loaded. A checksum-based filename lets an existing binary remain intact while installing a new one.

```bash
glass_data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/hyprglass-local"
glass_checksum="$(sha256sum hyprglass.so | cut -d ' ' -f 1)"
glass_binary="$glass_data_dir/hyprglass-${glass_checksum:0:16}.so"

mkdir -p "$glass_data_dir" "$HOME/.local/bin"
if [[ ! -e "$glass_binary" ]]; then
    install -m 755 hyprglass.so "$glass_binary"
fi
install -m 755 scripts/load-local.sh "$HOME/.local/bin/hyprglass-local-load"
printf '%s\n' "$glass_binary" > "$glass_data_dir/plugin-path"
hyprctl -j version | jq -er '.abiHash' > "$glass_data_dir/abi"
```

The ABI file records the **running** compositor identity. It does not inspect the binary or certify which headers built it; create it only after building against matching headers.

### 5. Merge the configuration

Follow [Configuration](#configuration) below before enabling the loader at startup. The supplied files are snippets, not complete desktop configurations.

### 6. Load and verify

If a previous local trial is loaded from a different path, unload that exact path first. The loader handles the known hyprpm installation paths; it does not discover arbitrary trial binaries.

```bash
# Only when replacing an already loaded trial:
# hyprctl plugin unload /absolute/path/to/previous-trial.so

"$HOME/.local/bin/hyprglass-local-load"
hyprctl hyprglass status
hyprctl configerrors
```

Expected plugin status:

```text
hyprglass 0.11.0-optical-rim: active
  version check: match
  shaders: ready
```

`hyprctl configerrors` should report no errors. Inspect the bar, attached panel, dock, and application borders before enabling startup loading.

### 7. Enable at login

In your existing `hyprland.start` handler, replace the old `hyprpm reload` startup command with the loader call. Keep your other startup applications as they are.

```lua
hl.on("hyprland.start", function()
    -- Keep your existing application startup commands here.
    hl.exec_cmd('"' .. os.getenv("HOME") .. '/.local/bin/hyprglass-local-load"')
end)
```

The loader runs `hyprpm reload -n` itself. Avoid launching a second independent hyprpm reload command alongside it, as that can race with plugin replacement.

## Configuration

### Hyprland

| File | Purpose |
| --- | --- |
| [`config/hyprglass.lua`](config/hyprglass.lua) | Local-version detection, window border fallback, glass presets, and Noctalia layer mappings. |
| [`config/native-blur.lua`](config/native-blur.lua) | Disables Hyprland's global blur and Noctalia layer `blur` / `blur_popups` requests. |
| [`config/noctalia-visual.toml`](config/noctalia-visual.toml) | Selected Noctalia spacing, radius, opacity, border, and shadow settings. |

You can merge the Lua snippets into your current configuration, or copy them into your Hyprland configuration directory:

```bash
glass_config_root="${XDG_CONFIG_HOME:-$HOME/.config}"
install -m 644 config/hyprglass.lua "$glass_config_root/hypr/hyprglass-local.lua"
install -m 644 config/native-blur.lua "$glass_config_root/hypr/hyprglass-native-blur.lua"
```

Then load them **after your Noctalia-generated theme is applied**:

```lua
local config_root = os.getenv("XDG_CONFIG_HOME") or (os.getenv("HOME") .. "/.config")
dofile(config_root .. "/hypr/hyprglass-native-blur.lua")
dofile(config_root .. "/hypr/hyprglass-local.lua")
```

Replace existing glass presets and conflicting Noctalia layer rules rather than stacking duplicate definitions. The native-blur snippet disables global compositor blur, so other applications that rely on it will also lose that built-in blur.

The configuration enables the exterior window rim only for `0.11.0-optical-rim`. With the stock plugin, it restores a conventional border and skips opaque windows. Whole-window opacity is not reduced by these snippets.

### Optical balance

Noctalia surfaces use backdrop-tinted bevel lighting, a linear light-facing response, Fresnel rim light, and a specular highlight. Layer lighting follows the actual alpha contour and is composited after the shell fill, so the fill cannot hide it. Shell bevel lighting covers a four-logical-pixel band to match the visible application-window rim, while its broader refractive shoulder stays intact. Fresnel and specular lighting cover that same strip, fading over its inner pixel rather than decaying inside a subpixel outer glint. The outer four logical pixels expose the refracted glass beneath the shell fill, matching the visible exterior strip around application windows. A one-pixel transition blends the inner edge into the fill; alpha coverage is preserved and no second outline is added. No inset dark band is added. On bright backdrops, masked shell rims gradually use a restrained, backdrop-colored edge and reduce additive highlights to avoid washed-out white outlines. Dark backdrops keep the existing lighting; application-window rendering is unaffected.

Panels use blur strength `0.65` with one iteration, refraction strength `1.35`, lens distortion `0.24`, and bevel size `3.5` for the refractive shoulder. Panel and dock edge lighting uses bevel strength `0.40`, backdrop tint `1.0`, Fresnel strength `0.45`, and specular strength `0.60`, matching the window preset. The `liquid-dock` preset retains a smaller shoulder size of `2.5` and refraction strength `1.2`.

The shell's body lens uses monitor coordinates and a common pixel scale across layers. Bar, dropdown, and dock therefore sample one continuous lens field, rather than restarting a rectangular lens inside each component. This also keeps the effect visible on shallow bars and docks. It changes the sampled backdrop, not the panel outline or foreground text.

The application-window preset uses blur strength `0.40`, edge thickness `0.028`, refraction strength `1.25`, edge-normal flow, refraction spread `0.25`, and lens distortion `0.24`. This makes the refracted background more visible through applications that already support transparency. Client content opacity is unchanged; opaque applications continue to cover the interior effect. The window bevel is thinner and has no added bevel shadow.

A soft, backdrop-tinted central reflection adds up to a few percent of light, controlled by specular strength. It fades before the rim and is composited behind client content, so opaque surfaces remain unchanged.

These highlights approximate glass; they do not render scene reflections. Their appearance depends on the backdrop. Background detail remains visible through transparent surfaces.

### Noctalia

Merge the keys from [`config/noctalia-visual.toml`](config/noctalia-visual.toml) into the corresponding sections of your settings. **Do not replace the entire settings file with this snippet** or create duplicate TOML sections.

The supplied look uses:

- Bar and dock background opacity of `0.16`.
- A four-pixel spacing grid: bar padding `12`, widget spacing `8`, and thickness `36`; dock padding `16` / `8`, icon size `32`, and item spacing `8`.
- Bar and dock radius `16`, shell corner-radius scale `1.25`, and notification / OSD offsets `16` / `12`.
- Notification and OSD background opacity of `0.20`.
- Glass-mode panels with native panel borders and shadows disabled.
- Disabled bar shadows and contact shadows.
- Shell shadow alpha of `0.12`; the dock keeps its native shadow.

Preserve your theme, wallpaper, widgets, layout, and application preferences. When editing the file directly, avoid simultaneous settings changes in Noctalia's UI.

```bash
noctalia config validate
noctalia msg config-reload
```

### Optional Nautilus background transparency

[`config/nautilus-glass.css`](config/nautilus-glass.css) targets only `window.nautilus-window`. It paints the base window background at **50% opacity**, with transparent view and headerbar backgrounds. The sidebar adds a subtle **20% tint** over that base (about 60% combined opacity) so it remains slightly denser than the view without a divider line. It does not lower whole-window or widget opacity; text, icons, selection states, and thumbnails retain their normal rendering.

Tested with Nautilus **50.3.1**, GTK **4.22.5**, and libadwaita **1.9.4** in dark mode. Other GTK applications are not styled by this snippet. It uses named colors from the current GTK theme, so it follows palette updates. Without HyprGlass, these areas remain transparent but lose the glass effect.

Back up your GTK files, copy the stylesheet to `${XDG_CONFIG_HOME:-$HOME/.config}/gtk-4.0/hyprglass-nautilus.css`, and append this import **after** your existing theme imports in `gtk.css`:

```css
@import url("hyprglass-nautilus.css");
```

To hide client-side close, maximize, and minimize buttons, merge `gtk-decoration-layout=:` into the existing `[Settings]` section of `gtk-4.0/settings.ini`. This setting applies to GTK4 applications, not just Nautilus; skip it if you want their usual titlebar buttons. Restart Nautilus while no file operation is running. Keep the normal XDG configuration directory; a temporary replacement can change unrelated desktop preferences.

To undo the background styling, remove the import and restart Nautilus. Restore the previous `gtk-decoration-layout` value to undo the button preference. Do not replace the entire GTK configuration with this snippet.

### Optional GTK3 applications and file chooser

[`config/gtk3-glass.css`](config/gtk3-glass.css) extends the same material to GTK3 applications and the GTK portal file chooser. It uses Noctalia's generated palette, keeps foreground opacity unchanged, and gives the main window a 50% opaque base. Sidebars add a 20% tint. Views use that single base instead of stacking solid fills. GTK dialog titlebars are painted outside the content background, so they receive the same 50% tint explicitly; normal application headerbars remain transparent. Pamac package cards get a light tint and 14px rounded corners.

This is a **global GTK3 stylesheet**, tested with `adw-gtk3` / `adw-gtk3-dark`, GTK 3.24.52, Pamac GTK3 10.7.0, and `xdg-desktop-portal-gtk` 1.15.3. Back up your current `~/.config/gtk-3.0/gtk.css`, `settings.ini`, and portal configuration before replacing an existing customization. The GTK4/Nautilus stylesheet is independent.

```bash
install -m 644 config/gtk3-glass.css "$HOME/.config/gtk-3.0/hyprglass-gtk3.css"
```

Use these imports in `~/.config/gtk-3.0/gtk.css`, replacing older conflicting material overrides after saving a backup:

```css
@import url("noctalia.css");
@import url("hyprglass-gtk3.css");
```

Keep Noctalia's built-in GTK templates enabled. Set `gtk-application-prefer-dark-theme=0` in the existing `[Settings]` section of GTK3 `settings.ini`: Noctalia selects `adw-gtk3` or `adw-gtk3-dark` through system appearance settings, so an additional forced dark preference is unnecessary. The tested desktop also uses `gtk-decoration-layout=:` to hide window control buttons, consistent with its GTK4 configuration.

For the GTK upload dialog, select the installed GTK backend in `~/.config/xdg-desktop-portal/hyprland-portals.conf`. Merge this key into its existing `[preferred]` section:

```ini
[preferred]
org.freedesktop.impl.portal.FileChooser = gtk
```

Preserve existing backend preferences for other interfaces. Reload the portal configuration when no chooser is open:

```bash
systemctl --user restart xdg-desktop-portal-gtk.service xdg-desktop-portal.service
```

GTK3 caches imported CSS palettes in long-lived processes. The supplied user path unit watches Noctalia's generated GTK3 palette and refreshes **only the GTK backend** after every open portal dialog has closed. It leaves an inactive backend inactive; its next activation reads the new palette. This follows actual file changes without modifying Noctalia's packaged templates.

```bash
mkdir -p "$HOME/.local/bin" "$HOME/.config/systemd/user"
install -m 644 scripts/refresh-gtk-portal.py "$HOME/.local/bin/hyprglass-refresh-gtk-portal"
install -m 644 config/hyprglass-gtk-portal.path config/hyprglass-gtk-portal.service \
    "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now hyprglass-gtk-portal.path
systemctl --user start hyprglass-gtk-portal.service
```

These units target the standard `~/.config` location and require Hyprland's `hyprctl`, Python 3, and a systemd user session. Adjust the path unit if you use another GTK config directory.

Pamac and other GTK3 applications may need reopening after palette changes. GTK3 applications that use an opaque X11 visual can remain opaque despite transparent CSS; native Wayland was used for the Pamac visual check. No whole-window opacity rule is applied. Dialogs drawn internally by an application rather than the GTK portal are outside the refresh service's scope.

The live test opened and closed portal dialogs on both themes without selecting files, and inspected Pamac on Wayland without running package transactions. To validate the stylesheet and refresh guard:

```bash
python3 tests/check-gtk3.py
python3 tests/test-gtk-portal.py
```

The stylesheet check requires PyGObject, GTK3, libhandy 1, the two adw-gtk3 themes, and a display. It checks the real libhandy tab buttons in normal, checked, hover, and backdrop states so the theme cannot reintroduce an opaque rectangular tab background. The refresh tests use mocked compositor/service commands. The production stylesheet has no `filter` or whole-widget `opacity` overrides.

To undo this integration, first disable the watcher:

```bash
systemctl --user disable --now hyprglass-gtk-portal.path
systemctl --user stop hyprglass-gtk-portal.service
rm "$HOME/.config/systemd/user/hyprglass-gtk-portal.path" \
   "$HOME/.config/systemd/user/hyprglass-gtk-portal.service" \
   "$HOME/.local/bin/hyprglass-refresh-gtk-portal"
systemctl --user daemon-reload
```

Restore your backed-up GTK3 CSS/settings and portal preferences, remove the added material stylesheet, and restart the GTK backend after dialogs close. Reopen GTK3 applications. This does not require rolling back the HyprGlass plugin, Nautilus, or ChatGPT.

## How the rendering changes work

The layer renderer samples the live backdrop and uses the rendered surface's alpha mask to locate the visible contour. It computes a rim normal from threshold-normalized coverage and validates the distance along that normal against the mask, then applies refraction and a backdrop-tinted shoulder highlight. The bevel is applied after panel compositing so the panel fill does not hide it.

For a top bar and attached dropdown, adjacent layer geometry marks their shared interior. That join receives neither a second optical rim nor an antialias gap. Normal estimation ignores differences between filled areas with different alpha values, preventing the upright highlight artifact at the junction.

Samples outside the monitor continue the surface coverage at the screen edge, suppressing an artificial rim where the surface is clipped. Free contours remain eligible for highlights.

Decorated application windows receive a four-logical-pixel expansion of the glass geometry outside the client area. Opaque client content covers the interior glass; the exterior strip stays visible. Fullscreen and undecorated windows do not receive that extra strip.

For the complete source changes, see [`patches/contour-relief.patch`](patches/contour-relief.patch). General upstream features and configuration are documented in [`README.upstream.md`](README.upstream.md); its release and installation guidance describes upstream, not this fork.

## Testing

### Loader behavior

```bash
python3 tests/test-loader.py
bash -n scripts/load-local.sh
```

The Python fixture uses mocked compositor commands and temporary directories. It checks successful local loading, ABI mismatch fallback, and recovery after a failed local load without changing your desktop.

### Shader validation and rendering

```bash
python3 tests/check-shaders.py

g++ -std=c++17 tests/check-relief.cpp -o tests/check-relief \
    $(pkg-config --cflags --libs egl glesv2)

LIBGL_ALWAYS_SOFTWARE=1 tests/check-relief \
    tests/original.frag tests/relief.frag tests/contour-test
```

The shader check compiles all 16 combinations of the upstream lens-edge, focus-light, frost, and contour features, plus the five auxiliary shaders. It also checks that the render fixture matches the embedded shader.

The offscreen EGL/GLES fixture checks:

- Visible rim highlights without a dark inset band, unchanged panel centers, and transparent exteriors.
- A four-pixel exposed glass strip on a bright backdrop, with unchanged body color and alpha.
- Visible reflection across the strip on a dark backdrop, with no spill into the panel body.
- Equivalent unmasked window rendering for the fixture's settings.
- Backdrop-dependent rim color and transparent-padding normalization.
- Attached joins without an interior bevel or raster gap.
- Suppressed monitor-clipped rims while free edges remain visible.
- Smooth intensity changes during fractional edge motion.
- A single highlight peak spanning three bright pixels inside the four-pixel rim, and actual rim refraction with an unchanged center on a gradient backdrop.
- Stronger window-edge refraction on the gradient fixture without shifting its center.
- Interior body refraction on a striped backdrop, unchanged alpha, and consistent lens displacement across differently sized shell surfaces.
- Subtle central reflection with unchanged alpha and no change to opaque foreground content.
- The regression that previously produced a vertical spike above the dropdown join.

The last fixture fails with the previous shader and passes with this revision. The fixture emits PPM comparison images, which are ignored by Git.

`tests/relief.frag` is a snapshot of the embedded `liquidglass.frag` shader in `src/Shaders.hpp`. Keep it synchronized when editing that shader; `check-shaders.py` fails if it drifts.

### Live checks

```bash
hyprctl hyprglass status
hyprctl configerrors
hyprctl getoption decoration:blur:enabled
```

The v0.11.0 port was built against Hyprland 0.56.2 and loaded in the tested session. The session reported an active plugin, matching version check, ready shaders, no configuration errors, and disabled native blur. The attached calendar panel was visually compared with the previous build on an empty workspace. The loader was exercised in the running session; a fresh login cycle has not yet been verified.

## Updates and maintenance

This branch includes upstream `hyprland-0.56` through `7fc328064c63d9fbaaac8d8204eadf85dcdeae19` (v0.11.0). Follow the stable branch for the installed Hyprland minor version; upstream `main` may include changes intended for another compositor revision. The new optional lens-edge, focus-light, frost, and GPU-contour features are available, but the supplied desktop profile keeps its existing settings and optical treatment.

When upgrading from the v0.10.0 local build, update the plugin-version guard in the desktop config and replace the loader along with the binary. Both now expect `0.11.0-optical-rim`. Keep the previous uniquely named binary and configuration backups until the new build has been verified.

| Update | What to do |
| --- | --- |
| Hyprland or its ABI dependencies | Start the new compositor version, align the development headers, rebuild, test, and install a new binary. Refresh the ABI record only after those checks. |
| Upstream HyprGlass | Port or merge the local changes into a compatible source version, then rerun the checks. An upstream release does not automatically include this patch. |
| Noctalia | Check layer names, panel geometry, alpha behavior, and the bar/dropdown junction. Review the visual settings against its configuration schema. |

The ABI gate skips an outdated local binary; it does **not** rebuild it. A recorded ABI match does not guarantee crash-free operation. The upstream fallback may also need a hyprpm rebuild after updates.

Keep the previously working binary until its replacement has been verified. Native plugin binaries are intentionally excluded from this repository.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Local effect disappears after a compositor update | Read the loader log. Rebuild for the new ABI rather than copying the old ABI value into the metadata file. |
| `Paused (duplicate)` or the wrong plugin responds | Inspect `hyprctl -j plugin list`. Unload the extra binary by its exact path and avoid simultaneous startup loaders. |
| Loader cannot unload the managed plugin | Check its installation path against `stock_path` in the loader. |
| Borders return to a conventional appearance | Confirm the active version is `0.11.0-optical-rim`; stock-plugin fallback intentionally restores a normal border. |
| Panels look opaque or double-bordered | Check Noctalia's panel transparency and border settings, plus duplicate layer rules or presets. |
| Some application backgrounds stay solid | This is expected for opaque applications. The plugin cannot recover separate background/text/video layers from a flattened opaque surface. |
| Shader fixture cannot initialize EGL | Check Mesa surfaceless EGL support and the EGL/GLES development environment. This fixture uses software rendering, not the active desktop renderer. |

Loader output is appended to:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/hyprglass-local/startup.log
```

```bash
tail -n 80 "${XDG_STATE_HOME:-$HOME/.local/state}/hyprglass-local/startup.log"
```

## Rollback

First replace the local-loader startup call with your previous hyprpm startup command. On the tested desktop, it was:

```lua
hl.exec_cmd("sh -c 'hyprpm reload -n && sleep 0.5 && hyprctl reload'")
```

Then restore the managed plugin in the current session:

```bash
glass_data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/hyprglass-local"
hyprctl plugin unload "$(cat "$glass_data_dir/plugin-path")"
hyprpm reload -n
hyprctl reload
hyprctl hyprglass status
```

This restores the plugin, not all visual settings. Restore your saved Hyprland and Noctalia configurations if you also want to undo the glass presets, native-blur settings, and shell styling. Keep backups outside the repository.

## Known limitations

- Attached-join geometry currently targets a **top bar**. Other placements and layouts need adaptation and visual testing.
- The contour search uses eight directions and a default alpha cutoff of `0.08`; extremely faint surfaces may require calibration.
- The appearance depends on the backdrop, surface alpha, scale, and theme. It is not an exact macOS implementation.
- Extended GPU load, battery impact, and broad multi-monitor or display-transform coverage have not been measured.
- The loader's active-build shortcut checks the plugin version string. Unload an existing local trial explicitly when switching between binaries with that same version.
- There is no automatic rebuild, binary release pipeline, or maintained hyprpm manifest for the local fork.

## Contributing

The upstream release and automatic Hyprland-update workflows are not enabled on this branch. Builds and validation use the manual commands above.

Keep changes focused and include a regression fixture for rendering fixes where practical. For a visual issue, include the Hyprland and Noctalia versions, output scale and arrangement, the relevant configuration snippets, plugin status, and a screenshot with private content removed.

Run the loader tests and shader checks before submitting a change. Record any live checks you could not perform; passing software-rendered fixtures does not establish behavior on every desktop GPU.

## Credits and license

Built on [HyprGlass by Hyprnux](https://github.com/hyprnux/hyprglass), with local contour, join, and optical-rim refinements for Hyprland and Noctalia.

Distributed under the **BSD 3-Clause License** included in [`LICENSE`](LICENSE). Preserve the upstream copyright notice and license terms when redistributing source or binaries.
