-- Apply after the Noctalia generated theme. This is a snippet, not a full desktop config.
-- Use the outside glass rim only while this local build is loaded.
local optical_windows = false
for _, plugin in ipairs(hl.get_loaded_plugins()) do
    if plugin.name == "hyprglass" and plugin.version == "0.10.0-optical-rim" then
        optical_windows = true
    end
end

-- Keep the application rim after Noctalia's generated border colors.
hl.config({
    general = {
        border_size = 1,
        col = {
            active_border = optical_windows and "rgba(00000000)" or { colors = { "rgba(dce7ee55)", "rgba(9aacba22)", "rgba(20273355)" }, angle = 135 },
            inactive_border = optical_windows and "rgba(00000000)" or { colors = { "rgba(dce7ee22)", "rgba(9aacba11)", "rgba(20273333)" }, angle = 135 },
        },
    },
})


-- ============================================================
-- HYPRGLASS
-- Noctalia v5
-- macOS Tahoe / Liquid Glass
-- Neutral for Light & Dark
-- ============================================================

if hl.plugin.hyprglass then
    local hg = hl.plugin.hyprglass

    -- ========================================================
    -- GLOBAL
    -- ========================================================

    hg.config({
        default_theme = "light",
        default_preset = "tahoe-window",
        skip_opaque_windows = not optical_windows,

        -- Cool-white tint yang sangat tipis.
        -- Format: RRGGBBAA
        tint_color = 0xeef3ff16,

        -- Netral supaya tetap enak di light maupun dark.
        brightness = 0.97,
        contrast = 1.05,
        saturation = 1.00,

        vibrancy = 0.20,
        vibrancy_darkness = 0.08,

        -- Menjaga detail tetap terlihat di wallpaper
        -- sangat terang maupun sangat gelap.
        adaptive_dim = 0.10,
        adaptive_boost = 0.10,

        layers = {
            enabled = true,
        },
    })


    -- ========================================================
    -- TAHOE
    --
    -- Full Liquid Glass.
    -- Dipakai untuk:
    -- - Dock
    -- - Floating panel
    -- - Notification
    -- - OSD
    -- - Window switcher
    --
    -- Efek dibuat sengaja cukup agresif.
    -- ========================================================

    hg.preset("tahoe", {
        -- ----------------------------------------------------
        -- GLASS BODY
        -- ----------------------------------------------------

        glass_opacity = 0.82,

        -- Jangan terlalu blur.
        -- Kita ingin masih melihat detail yang ter-refract.
        blur_strength = 0.80,
        blur_iterations = 2,

        -- ----------------------------------------------------
        -- GLASS BEZEL / DEPTH
        -- ----------------------------------------------------

        edge_thickness = 0.085,

        -- ----------------------------------------------------
        -- OPTICAL DISTORTION
        -- ----------------------------------------------------

        refraction_strength = 0.95,
        lens_distortion = 0.62,

        -- ----------------------------------------------------
        -- LIGHT RESPONSE
        -- ----------------------------------------------------

        fresnel_strength = 0.92,
        specular_strength = 1.00,

        -- ----------------------------------------------------
        -- DISPERSION
        -- ----------------------------------------------------

        chromatic_aberration = 0.16,

        -- ----------------------------------------------------
        -- COLOR
        -- ----------------------------------------------------

        contrast = 1.10,
        saturation = 1.02,
        vibrancy = 0.24,
    })


    -- Separate window bevels from Noctalia's layer presets.
    hg.preset("tahoe-window", {
        inherits = "liquid-shell",
        blur_strength = 0.40,
        edge_thickness = 0.028,
        refraction_strength = 1.25,
        refraction_flow = 1.0,
        refraction_spread = 0.25,
        lens_distortion = 0.24,
        fresnel_strength = 0.45,
        specular_strength = 0.60,
        bevel_strength = 0.40,
        bevel_size = 1.5,
        bevel_shadow = 0.0,
        bevel_tint = 1.0,
    })

    -- Shell glass is independent of application-window glass.
    hg.preset("liquid-shell", {
        glass_opacity = 1.0,
        blur_strength = 0.65,
        blur_iterations = 1,
        tint_color = 0xffffff00,
        brightness = 1.0,
        contrast = 1.0,
        saturation = 1.0,
        vibrancy = 0.0,
        adaptive_dim = 0.0,
        adaptive_boost = 0.0,
        edge_thickness = 0.055,
        refraction_strength = 1.35,
        lens_distortion = 0.24,
        chromatic_aberration = 0.06,
        fresnel_strength = 0.45,
        fresnel_tint = 0.75,
        specular_strength = 0.60,
        specular_angle = 315.0,
        bevel_strength = 0.40,
        bevel_size = 3.5,
        bevel_angle = 315.0,
        bevel_shadow = 0.0,
        bevel_tint = 1.0,
    })

    -- Small dock surfaces need a narrower, quieter rim than large panels.
    hg.preset("liquid-dock", {
        inherits = "liquid-shell",
        bevel_size = 2.5,
        bevel_strength = 0.40,
        refraction_strength = 1.2,
        fresnel_strength = 0.45,
        specular_strength = 0.60,
    })

    -- Reduce the rim at the bar/panel join, without turning it off.
    hg.preset("liquid-attached", {
        inherits = "liquid-shell",
        -- The bar and dropdown share one rim, with the live windows behind them.
        xray = false,
    })


    -- ========================================================
    -- NOCTALIA BAR
    -- ========================================================

    hg.layer("noctalia-bar-default", {
        preset = "liquid-attached",

        mask_mode = "auto",
        mask_threshold = 0.08,
    })


    -- ========================================================
    -- NOCTALIA ATTACHED PANEL
    --
    -- Launcher / Control Center yang attached ke bar.
    -- ========================================================

    hg.layer("noctalia-attached-panel", {
        preset = "liquid-attached",

        mask_mode = "auto",
        mask_threshold = 0.08,
    })


    -- ========================================================
    -- NOCTALIA FLOATING PANEL
    --
    -- Kalau panel dibuka sebagai floating, kita bisa memakai
    -- full Tahoe karena tidak perlu menyatu dengan bar.
    -- ========================================================

    hg.layer("noctalia-panel", {
        preset = "liquid-shell",

        mask_mode = "auto",
        mask_threshold = 0.08,
    })


    -- ========================================================
    -- NOCTALIA DOCK
    --
    -- Ini yang seharusnya paling kelihatan "Liquid Glass".
    -- ========================================================

    hg.layer("noctalia-dock", {
        preset = "liquid-dock",

        mask_mode = "auto",
        mask_threshold = 0.08,
    })


    -- ========================================================
    -- NOCTALIA NOTIFICATION
    -- ========================================================

    hg.layer("noctalia-notification", {
        preset = "liquid-shell",

        mask_mode = "auto",
        mask_threshold = 0.10,
    })


    -- ========================================================
    -- NOCTALIA OSD
    -- Volume / Brightness / etc.
    -- ========================================================

    hg.layer("noctalia-osd", {
        preset = "liquid-shell",

        mask_mode = "auto",
        mask_threshold = 0.10,
    })


    -- ========================================================
    -- NOCTALIA WINDOW SWITCHER
    -- ========================================================

    hg.layer("noctalia-window-switcher", {
        preset = "liquid-shell",

        mask_mode = "auto",
        mask_threshold = 0.10,
    })
end