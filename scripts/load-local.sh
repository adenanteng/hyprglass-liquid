#!/usr/bin/env bash
set -euo pipefail
local_dir="${XDG_DATA_HOME:-$HOME/.local/share}/hyprglass-local"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/hyprglass-local"
mkdir -p "$state_dir"
exec >>"$state_dir/startup.log" 2>&1
exec 9>"$state_dir/loader.lock"
flock -n 9 || exit 0
printf '\n[%s] Loading Hyprglass\n' "$(date -Is)"
fallback() {
    hyprpm reload -n || true
    hyprctl reload
}
current_abi="$(hyprctl -j version | jq -er '.abiHash')"
if [[ ! -f "$local_dir/abi" || ! -f "$local_dir/plugin-path" ]] ||
   [[ "$current_abi" != "$(cat "$local_dir/abi")" ]]; then
    echo 'Local build ABI mismatch or missing installation; using hyprpm. Rebuild local plugin after updating Hyprland.'
    fallback
    exit 0
fi
plugin_path="$(cat "$local_dir/plugin-path")"
if [[ ! -f "$plugin_path" ]]; then
    echo 'Local plugin binary is missing; using hyprpm.'
    fallback
    exit 0
fi
if hyprctl -j plugin list | jq -e '.[] | select(.name == "hyprglass" and .version == "0.10.0-optical-rim")' >/dev/null; then
    hyprctl reload
    exit 0
fi
hyprpm reload -n || true
if hyprctl -j plugin list | jq -e '.[] | select(.name == "hyprglass")' >/dev/null; then
    stock_path="${XDG_CACHE_HOME:-$HOME/.cache}/hyprpm/$USER/HyprGlass/hyprglass.so"
    # Manjaro's hyprpm cache is outside XDG_CACHE_HOME on this desktop.
    [[ -f "$stock_path" ]] || stock_path="/var/cache/hyprpm/$USER/HyprGlass/hyprglass.so"
    if ! hyprctl plugin unload "$stock_path"; then
        echo 'Could not unload managed plugin; leaving it active.'
        hyprctl reload
        exit 1
    fi
fi
hyprctl plugin load "$plugin_path" || true
hyprctl reload
# Shader creation happens on a render frame after loading/configuration.
ready=false
for attempt in {1..10}; do
    status="$(hyprctl hyprglass status 2>&1 || true)"
    if [[ "$status" == *'hyprglass 0.10.0-optical-rim: active'* && "$status" == *'shaders: ready'* ]]; then
        ready=true
        break
    fi
    sleep 0.1
done
if [[ "$ready" != true ]]; then
    echo 'Local plugin failed; restoring managed plugin.'
    hyprctl plugin unload "$plugin_path" || true
    fallback
    exit 1
fi
hyprctl reload
hyprctl hyprglass status
