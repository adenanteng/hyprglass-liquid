hl.config({ decoration = { blur = { enabled = false } } })
hl.layer_rule({
    name = "noctalia",
    match = { namespace = "^noctalia-(bar-.+|notification|dock|panel|attached-panel|osd|window-switcher)$" },
    no_anim = true,
    ignore_alpha = 0.1,
    blur = false,
    blur_popups = false,
})
