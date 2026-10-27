#version 300 es
precision highp float;

/*
 * Apple-style Liquid Glass Fragment Shader — Thick-glass refraction model
 *
 * The window is modeled as a thick convex glass slab:
 *   - Center: flat surface → clean frosted blur, no distortion
 *   - Edges: curved surface → refraction pulls in content from beyond
 *     the window boundary, creating natural color bleeding
 *
 * Rendering layers:
 * 1. Edge refraction via smooth outward direction (optionally along the edges,
 *    optionally rim-only) + exponential proximity
 * 2. Chromatic aberration (per-channel refraction scale)
 * 3. Edge raw-texture blend for vivid color pickup
 * 4. Subtle center dome lens magnification
 * 5. Frosted tint (brightness boost + desaturation)
 * 6. Configurable color tint overlay, then frosted grain
 * 7. Bevel (thin lit line at the edge)
 * 8. Fresnel edge glow (white or tinted by the background)
 * 9. Specular highlight (top)
 * 10. Inner shadow (bottom rim)
 */

uniform sampler2D tex;
uniform vec2 fullSize;
uniform vec2 invFullSize;      // = 1.0 / fullSize, hoisted out of the per-pixel divisions below
uniform vec4 radii;            // per-corner radius: top-left, top-right, bottom-right, bottom-left
uniform vec2 uvPadding;

uniform float refractionStrength;
uniform float noiseStrength;
uniform float chromaticAberration;
uniform float fresnelStrength;
uniform float specularStrength;
uniform float glassOpacity;
uniform float edgeThickness;
uniform float invBezelWidthPx; // = 1.0 / (edgeThickness * minDim), hoisted per-draw (minDim: the glass box's smaller side)
uniform vec3 tintColor;
uniform float tintAlpha;
uniform float lensDistortion;
uniform float lensMaxPx;       // = lensDistortion * minDim * 0.006, hoisted per-draw
uniform float brightness;
uniform float contrast;
uniform float saturation;
uniform float vibrancy;
uniform float vibrancyDarkness;
uniform float adaptiveDim;
uniform float adaptiveBoost;
uniform float roundingPower;
uniform float invRoundingPower; // = 1.0 / roundingPower, hoisted per-draw
uniform float refractionFlow;
uniform float refractionSpread;
uniform float fresnelTint;
uniform float bevelStrength;
uniform float bevelSize;
uniform float monitorScale;
uniform vec3 fresnelColor;
uniform float fresnelColorAlpha;
uniform vec3 bevelColor;
uniform float bevelColorAlpha;
uniform float bevelTint;
uniform float bevelAngle;
uniform float bevelShadow;
uniform float specularAngle;

uniform sampler2D maskTex;
uniform int useMask;
uniform vec2 maskUVOffset;
uniform vec2 maskUVScale;
uniform float maskAlphaThreshold;
uniform float maskCoverage;    // alpha mask: glass fades in over this alpha range above the threshold (0 = hard mask)
uniform vec4 joinedRect;       // adjacent attached surface, in this layer's pixel coordinates
uniform int maskMode;          // 0 = alpha threshold, 1 = protocol region
uniform int regionRectCount;   // 0..64
uniform vec4 regionRects[64];  // box-local pixels: xy = offset from box top-left, zw = size

// The glass shape: the outline, bezel, lens, refraction centre and lighting
// all follow this sub-rect of the drawn box. Smaller than the drawn box only
// for subsurface items (e.g. a capsule pill inside a wider hit-test area) and
// layers with a fixed shape. Box-local pixels, same space as regionRects.
// Windows and other layers pass offset (0,0) and size == fullSize.
uniform vec2 glassBoxOffsetPx;
uniform vec2 glassBoxSizePx;
// glassUV = uv * glassUVScale - glassUVOffset: 0..1 across the glass box.
// = fullSize / glassBoxSizePx and glassBoxOffsetPx / glassBoxSizePx, hoisted
// per-draw; exactly (1,1) and (0,0) when the glass box is the whole box, so
// glassUV == uv bit for bit for windows and layers.
uniform vec2 glassUVScale;
uniform vec2 glassUVOffset;

// Maps this fragment's own box UV into the sample texture's normalized space
// before uvPadding is applied. Identity (offset 0, scale 1) unless the sample
// texture covers a smaller area than this box — PROTOCOL_REGION layers only,
// where the background is only ever sampled/blurred inside the blur region's
// bounding box (see GlassRenderer::sampleBackground callers in GlassLayerSurface.cpp).
uniform vec2 sampleUVOffset;
uniform vec2 sampleUVScale;

#ifdef HYPRGLASS_FEATURE_LENS_EDGE
uniform float lensHeightPx;          // edge_height in framebuffer px, > 0
uniform float lensReflection;        // fresnel_reflection, 0..1
uniform float lensReflectionReachPx; // farthest the rim mirrors outside the glass, inside the sample padding

const float LENS_IOR = 1.5;
// refractive index spread per unit of chromatic_aberration: red below LENS_IOR, blue above
const float LENS_DISPERSION = 0.25;
// refraction_strength that bends by exactly what Snell's law gives
const float LENS_REFERENCE_STRENGTH = 0.6;
#endif

#ifdef HYPRGLASS_FEATURE_FOCUS_LIGHT
uniform float focusLight;           // focus_light times the focus fade, > 0
uniform vec3  focusLightColor;
uniform float focusLightColorAlpha;

// Logical px, so the light looks the same on every monitor scale.
const float FOCUS_LIGHT_LINE_DEPTH = 1.0;  // the bright line peaks this far in from the edge
const float FOCUS_LIGHT_LINE_WIDTH = 1.0;
const float FOCUS_LIGHT_SHEEN_FALLOFF = 4.0; // the soft sheen inside it fades out over ~3 of these
const float FOCUS_LIGHT_SHEEN = 0.3;       // sheen brightness, relative to the line
const float FOCUS_LIGHT_FLOOR = 0.5;       // the side facing away from bevel_angle keeps this much
const float FOCUS_LIGHT_REACH = 24.0;      // deeper, the light is under a third of a colour step: skipped
#endif

#ifdef HYPRGLASS_FEATURE_FROST
uniform sampler2D frostTex;  // tex blurred further, at half its size: same UVs as tex
uniform float frostAmount;   // frost times its ease, > 0

const float FROST_SATURATION_LIFT = 0.35; // frosted glass reads slightly more colourful ...
const float FROST_DIM = 0.10;             // ... and slightly deeper, at full amount
#endif

#ifdef HYPRGLASS_FEATURE_CONTOUR
// Layers with mask_mode = contour: the edge follows the outline the app draws, read
// from a distance field (Contour.hpp) instead of the layer's rectangle.
uniform highp sampler2D contourTex; // r: signed distance to the outline in px (negative inside), gb: its gradient
uniform vec2 contourUVScale;      // box UV -> field UV: the field covers whole texels, the box need not
uniform float contourReferencePx; // the bezel is a fraction of this, not of the layer's short side
uniform float contourReachPx;     // where the field stops; the edge effects fade out before it
#endif

in vec2 v_texcoord;
layout(location = 0) out vec4 fragColor;

// ============================================================================
// TEXTURE SAMPLING (window UV -> padded texture UV)
// ============================================================================

// Box UV -> sample-texture-local UV (undoes sampleUVOffset/uvScale's
// shrink before the padding remap below sees it).
vec2 toSampleBoxUV(vec2 wuv) {
    return (wuv - sampleUVOffset) / sampleUVScale;
}

vec2 toTexUV(vec2 wuv) {
    return wuv * (1.0 - 2.0 * uvPadding) + uvPadding;
}

vec4 sampleBlurred(vec2 wuv) {
    if (useMask == 1) {
        vec2 halfPixel = maskUVScale * invFullSize * 0.5;
        vec2 screenUV = clamp(wuv * maskUVScale + maskUVOffset, halfPixel, vec2(1.0) - halfPixel);
        wuv = (screenUV - maskUVOffset) / maskUVScale;
    }
    vec2 tuv = toTexUV(toSampleBoxUV(wuv));
#ifdef HYPRGLASS_FEATURE_FROST
    vec4 sampled = mix(texture(tex, clamp(tuv, 0.001, 0.999)), texture(frostTex, clamp(tuv, 0.001, 0.999)), frostAmount);
#else
    vec4 sampled = texture(tex, clamp(tuv, 0.001, 0.999));
#endif
    // Blur mixes valid pixels with transparent monitor padding; normalize that coverage.
    if (useMask == 1 && sampled.a > 0.001)
        sampled.rgb /= sampled.a;
    return sampled;
}

// hash12 from "Hash without Sine" (Dave Hoskins), tuned for integer pixel coordinates
float pixelHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// ============================================================================
// SDF
// ============================================================================

float lpNorm(vec2 v, float p, float invP) {
    // Exact identity: pow(x^2+y^2, 0.5) == length(v) when p == 2.0 (the
    // Hyprland default). Native sqrt is a single correctly-rounded hardware
    // op vs. two pow()s (exp2/log2-based) + a third pow() for the outer root.
    if (p == 2.0) return length(v);
    return pow(pow(abs(v.x), p) + pow(abs(v.y), p), invP);
}

// Quadrant lookup for the per-corner radius. p is measured from the box
// center (as getRoundedBoxSDF/getBevelSDF compute it below): negative y is
// the top half (v_texcoord grows downward — see the specular highlight's
// 1.0 - glassUV.y), negative x is the left half. cornerRadii is (top-left,
// top-right, bottom-right, bottom-left).
float pickCornerRadius(vec2 p, vec4 cornerRadii) {
    float top    = p.x < 0.0 ? cornerRadii.x : cornerRadii.y;
    float bottom = p.x < 0.0 ? cornerRadii.w : cornerRadii.z;
    return p.y < 0.0 ? top : bottom;
}

// posPx/boxSizePx: pixel-space position relative to (and size of) the box the
// SDF is measured against — the glass box (see glassBoxOffsetPx/SizePx above),
// not necessarily the fragment's full drawn box.
float getRoundedBoxSDF(vec2 posPx, vec2 boxSizePx, vec4 cornerRadii) {
    vec2 p = posPx - boxSizePx * 0.5;
    vec2 halfSize = boxSizePx * 0.5;
    float r = pickCornerRadius(p, cornerRadii);
    float clampedR = min(r, min(halfSize.x, halfSize.y));
    vec2 q = abs(p) - halfSize + clampedR;
    return min(max(q.x, q.y), 0.0) + lpNorm(max(q, 0.0), roundingPower, invRoundingPower) - clampedR;
}

float getCornerSDF(vec2 uv) {
    vec2 boxLocalPx = uv * fullSize - glassBoxOffsetPx;
    return getRoundedBoxSDF(boxLocalPx, glassBoxSizePx, radii);
}

// Edge distance for the bevel, crease-free. Inside the window, getCornerSDF is
// max(q.x, q.y) - r: the distance to whichever edge is nearer. That has a crease
// along each corner's 45-degree diagonal, so the edge refraction (and anything
// else driven by edgeProximity) shows a straight seam in all four corners.
//
// Here the contour lines are rounded rectangles that match the window outline
// exactly at the edge (depth 0) and get rounder going inward: at depth d the box
// is inset by d and its corner radius is r + d. The radius only grows, so the
// top and side bevels always blend round the corner. Per pixel the depth is a
// closed-form quadratic in the corner zone:
//   |a + 2d| = r + d,  a = |p| - halfSize + r   =>   7d^2 + (4(ax+ay) - 2r) d + |a|^2 - r^2 = 0
// and the plain straight-edge distance elsewhere. Past depth (h - r) / 2, with h
// the smaller half-size, the radius would outgrow the inset box: from there the
// contours are stadiums, i.e. the plain distance to the box rounded by h (so a
// capsule gets its exact distance everywhere).
float getBevelSDF(vec2 uv) {
    vec2  H = glassBoxSizePx * 0.5;
    float h = min(H.x, H.y);
    vec2  signedP = uv * fullSize - glassBoxOffsetPx - H;
    float r = min(pickCornerRadius(signedP, radii), h);
    vec2  p = abs(signedP);
    vec2  a = p - H + r;
    float d = min(r - a.x, r - a.y);                      // straight-edge depth
    float B = 4.0 * (a.x + a.y) - 2.0 * r;
    float C = dot(a, a) - r * r;
    float disc = B * B - 28.0 * C;
    if (disc >= 0.0) {
        float dc = (-B + sqrt(disc)) / 14.0;
        if (a.x + 2.0 * dc >= 0.0 && a.y + 2.0 * dc >= 0.0)
            d = dc;                                        // in a corner zone: the rounded contour
    }
    vec2 s = p - H + h;
    return -max(d, h - length(max(s, 0.0)) - min(max(s.x, s.y), 0.0));
}

// ============================================================================
// REFRACTION DIRECTION
// Pixel-space direction toward the glass box center — perfectly smooth everywhere,
// no SDF gradient needed (optional edge-following blend below). On straight edges the perpendicular pixel distance
// dominates, giving approximately edge-normal direction. At corners it
// naturally follows the diagonal.
// ============================================================================

vec2 refractionDir(vec2 glassUV) {
    vec2 toCenterPx = (vec2(0.5) - glassUV) * glassBoxSizePx;
    float len = length(toCenterPx);
    return len > 0.1 ? toCenterPx / len : vec2(0.0);
}

// Smooth edge-following field: points into the glass box, hugging each edge's normal
// away from the corners and blending crease-free through the diagonals.
vec2 edgeDir(vec2 posPx) {   // posPx: from the glass box center
    vec2 halfSize = max(glassBoxSizePx * 0.5, vec2(0.5)); // a sub-pixel glass box rounds to 0
    vec2 n = abs(posPx) / halfSize;
    vec2 g = sign(posPx) * pow(n, vec2(7.0)) / halfSize;
    float len = length(g);
    return len > 0.0 ? -g / len : vec2(0.0);   // points INTO the box
}

// light direction for a clockwise angle in degrees, 0 = from the top (screen y grows downward)
vec2 lightDir(float angleDeg) {
    float a = radians(angleDeg);
    return vec2(sin(a), -cos(a));
}

// exact outward normal from the SDF gradient; only meaningful right at the edge
vec2 sdfOutwardNormal(vec2 uv) {
    vec2 h = vec2(1.0) / fullSize;
    vec2 grad = vec2(
        getCornerSDF(uv + vec2(h.x, 0.0)) - getCornerSDF(uv - vec2(h.x, 0.0)),
        getCornerSDF(uv + vec2(0.0, h.y)) - getCornerSDF(uv - vec2(0.0, h.y))
    );
    float len = length(grad);
    return len > 0.0 ? grad / len : vec2(0.0, -1.0);
}

#ifdef HYPRGLASS_FEATURE_LENS_EDGE
// ============================================================================
// LENS EDGE
// The rim (the edge width) is a convex glass wall edge_height tall: a quarter
// ellipse across its width, vertical at the edge and flat from its inner side
// on, so the centre is not bent at all. A vertical eye ray refracts where it
// enters the rim (Snell's law) and runs down through the glass to the backdrop.
// ============================================================================

// The edge distance main() uses (bevelSdf), so the rim normal has no crease either.
float lensEdgeSDF(vec2 uv) {
    return roundingPower == 2.0 ? getBevelSDF(uv) : getCornerSDF(uv);
}

// Inward distance, in px, between where the eye ray enters the glass and where
// it meets the backdrop: n is the surface normal as (inward, up), surfacePx the
// glass height there. gain scales it, capPx bounds it smoothly.
float lensBendPx(vec2 n, float surfacePx, float ior, float gain, float capPx) {
    vec2 ray = refract(vec2(0.0, -1.0), n, 1.0 / ior);
    float runPx = surfacePx * ray.x / max(-ray.y, 1e-3);
    return capPx * tanh(clamp(gain * runPx / capPx, -8.0, 8.0));
}

// At a square or tight corner the rim normal turns all the way round within a
// few pixels, so every ray there bends toward one point (a dark curl) and the
// reflection swirls. Fades both out near a corner whose radius is under the rim width.
float lensCornerFade(vec2 uv, float rimPx) {
    vec2  halfBox    = glassBoxSizePx * 0.5;
    vec2  fromCenter = uv * fullSize - glassBoxOffsetPx - halfBox;
    float radius     = min(pickCornerRadius(fromCenter, radii), min(halfBox.x, halfBox.y));
    float toCorner   = length(max(halfBox - abs(fromCenter), 0.0));
    return mix(smoothstep(0.0, rimPx, toCorner), 1.0, clamp(radius / rimPx, 0.0, 1.0));
}
#endif

// ============================================================================
// MAIN — Thick-glass refraction model
// ============================================================================

// Layers include transparent padding and shadows; their box is not the panel edge.
float layerAlpha(vec2 uv, vec2 offsetPx) {
    vec2 p = uv * fullSize + offsetPx;
    if (joinedRect.z > 0.0 && all(greaterThanEqual(p, joinedRect.xy)) &&
        all(lessThanEqual(p, joinedRect.xy + joinedRect.zw)))
        return 1.0;
    vec2 layerUV = uv + offsetPx * invFullSize;
    vec2 sampleUV = layerUV * maskUVScale + maskUVOffset;
    // Continue the visible surface beyond the monitor: a clipped edge has no glass rim.
    if (any(lessThan(sampleUV, vec2(0.0))) || any(greaterThan(sampleUV, vec2(1.0)))) {
        vec2 halfPixel = maskUVScale * invFullSize * 0.5;
        return texture(maskTex, clamp(sampleUV, halfPixel, vec2(1.0) - halfPixel)).a;
    }
    // The temp framebuffer is only cleared inside this layer's box.
    if (any(lessThan(layerUV, vec2(0.0))) || any(greaterThan(layerUV, vec2(1.0))))
        return 0.0;
    return texture(maskTex, sampleUV).a;
}

float contourCoverage(vec2 uv, vec2 offsetPx) {
    float threshold = max(maskAlphaThreshold, 0.08);
    return smoothstep(threshold * 0.5, threshold * 1.5, layerAlpha(uv, offsetPx));
}

void layerContour(vec2 uv, float radiusPx, out float distancePx, out vec2 outward) {
    float threshold = max(maskAlphaThreshold, 0.08);
    distancePx = radiusPx;
    outward = vec2(0.0);
    for (int i = 0; i < 8; ++i) {
        float angle = float(i) * 0.7853981634;
        vec2 dir = vec2(cos(angle), sin(angle));
        if (layerAlpha(uv, dir * radiusPx) >= threshold)
            continue;
        float lo = 0.0;
        float hi = radiusPx;
        for (int j = 0; j < 8; ++j) {
            float mid = (lo + hi) * 0.5;
            if (layerAlpha(uv, dir * mid) >= threshold)
                lo = mid;
            else
                hi = mid;
        }
        if (hi < distancePx) {
            distancePx = hi;
            outward = dir;
        }
    }
    if (dot(outward, outward) > 0.5) {
        vec2 boundary = outward * distancePx;
        vec2 normal = vec2(
            contourCoverage(uv, boundary - vec2(1.0, 0.0)) - contourCoverage(uv, boundary + vec2(1.0, 0.0)),
            contourCoverage(uv, boundary - vec2(0.0, 1.0)) - contourCoverage(uv, boundary + vec2(0.0, 1.0)));
        if (length(normal) > 0.001) {
            normal = normalize(normal);
            // Validate the normal ray against the mask; tangent projection can invent an edge at a concave join.
            if (dot(outward, normal) > 0.5 && layerAlpha(uv, normal * radiusPx) < threshold) {
                float lo = 0.0;
                float hi = radiusPx;
                for (int j = 0; j < 8; ++j) {
                    float mid = (lo + hi) * 0.5;
                    if (layerAlpha(uv, normal * mid) >= threshold)
                        lo = mid;
                    else
                        hi = mid;
                }
                distancePx = min(distancePx, hi);
                outward = normal;
            }
        }
    }
}

void main() {
    vec2 uv = v_texcoord;

    // Layers only: sample the temp FBO to get the rendered surface pixel.
    // Glass only covers visible content: layer pixels under the mask threshold get none.
    // For windows, hasMask is false and this block is skipped entirely.
    vec4 surfacePixel = vec4(0.0);
    float maskRamp = 1.0;
    bool hasMask = (useMask == 1);
    if (hasMask) {
        vec2 maskUV = uv * maskUVScale + maskUVOffset;
        surfacePixel = texture(maskTex, clamp(maskUV, 0.001, 0.999));

        if (maskMode == 1) {
            vec2 pixelPos = uv * fullSize;
            bool insideRegion = false;
            for (int i = 0; i < regionRectCount; i++) {
                vec4 r = regionRects[i];
                if (pixelPos.x >= r.x && pixelPos.y >= r.y &&
                    pixelPos.x <= r.x + r.z && pixelPos.y <= r.y + r.w) {
                    insideRegion = true;
                    break;
                }
            }
            if (!insideRegion) { fragColor = surfacePixel; return; } // premultiplied, output as-is
        } else {
            // Below the threshold the content gets no glass but is still drawn
            // (shadows, faint fills), like outside a region.
            if (surfacePixel.a < maskAlphaThreshold) { fragColor = surfacePixel; return; } // premultiplied, output as-is
            // Antialiased edges get proportionally less glass, so rounded corners fade
            // out instead of ending on a hard, stepped edge. Not smoothstep(): it is undefined
            // when threshold + coverage rounds to threshold in float.
            if (maskCoverage > 0.0) {
                float t = clamp((surfacePixel.a - maskAlphaThreshold) / maskCoverage, 0.0, 1.0);
                maskRamp = t * t * (3.0 - 2.0 * t);
            }
        }
    }

#ifdef HYPRGLASS_FEATURE_CONTOUR
    // The traced outline replaces the layer box. The mask above already limits the glass
    // to the visible content, so the outline only shapes the edge effects, not the cut.
    vec4  contourSample  = texture(contourTex, uv * contourUVScale);
    float cornerSdf      = contourSample.r;
    float cornerAlpha    = 1.0;
    float contourGradLen = length(contourSample.gb);
    // zero where the field is flat (deep inside, or past its reach): no edge there
    vec2  contourOutward = contourGradLen > 0.05 ? contourSample.gb / contourGradLen : vec2(0.0);
#else
    float cornerSdf    = getCornerSDF(uv);
    float cornerAlpha  = 1.0 - smoothstep(-1.5, 0.5, cornerSdf);
    vec2 contourPos = uv * fullSize;
    if (hasMask && joinedRect.z > 0.0 &&
        all(greaterThanEqual(contourPos, joinedRect.xy - vec2(monitorScale))) &&
        all(lessThanEqual(contourPos, joinedRect.xy + joinedRect.zw + vec2(monitorScale))))
        cornerAlpha = 1.0;
#endif

    if (hasMask) {
        // Layers and subsurface items: the glass box (glassBoxOffsetPx/SizePx) can be
        // smaller than the drawn box/region — e.g. a capsule glass shape inside a
        // rectangular blur region, or a layer's fixed shape. Outside it, fall back to the
        // plain surface pixel instead of dropping it (a hard discard here would
        // silently delete client content, like an icon, that simply isn't under
        // the glass). cornerAlpha fades smoothly across the boundary (the same
        // curve already used for glassA below), so this is an antialiased
        // "glass * coverage, surface over" blend, not a hard cutover — the
        // actual blend happens in the hasMask composite at the bottom of main().
        if (cornerAlpha < 0.001) {
            fragColor = surfacePixel;
            return;
        }
    } else {
        // Windows: no surface pixel to fall back to outside the glass shape.
        if (cornerSdf > 0.0) discard;
        if (cornerAlpha < 0.001) discard;
    }

    // Position within the glass box: everything shaped by the glass (bezel, lens,
    // refraction centre, lighting) follows it, not the drawn box.
    vec2 glassUV = uv * glassUVScale - glassUVOffset;
#ifdef HYPRGLASS_FEATURE_CONTOUR
    float minDim = contourReferencePx;
#else
    float minDim = min(glassBoxSizePx.x, glassBoxSizePx.y);
#endif
    float bezelWidthPx = max(edgeThickness * minDim, 1e-4); // same floor as invBezelWidthPx

    // ========================================
    // EDGE PROXIMITY + DIRECTION
    // edgeProximity: 1.0 at boundary, exponential decay inward
    // inwardDir: pixel-space direction toward center (smooth everywhere)
    // Clamped to 1.0: cornerSdf can be positive here (a layer or item glass box
    // can be smaller than fullSize, so fragments just outside it still reach
    // this code with cornerAlpha > 0.001), and exp() of a positive value would
    // otherwise overshoot every effect that scales off edgeProximity.
    // ========================================
    // crease-free bevel distance, so the edge has no seam along the corner diagonals;
    // it assumes circular corners, so a superellipse outline keeps the exact SDF
#ifdef HYPRGLASS_FEATURE_CONTOUR
    // The field is smoothed, so it has no corner seam to avoid. Its reach is the end of the
    // data: the window takes the effects to zero before it, rather than cutting them off.
    float bevelSdf = cornerSdf;
    float edgeProximity = min(exp(bevelSdf * invBezelWidthPx), 1.0) *
                          (1.0 - smoothstep(0.5 * contourReachPx, contourReachPx, -bevelSdf));
    vec2 inwardDir = -contourOutward;
#else
    float bevelSdf = roundingPower == 2.0 ? getBevelSDF(uv) : cornerSdf;
    float edgeProximity = min(exp(bevelSdf * invBezelWidthPx), 1.0);
    vec2 inwardDir = refractionDir(glassUV);
#endif
#ifdef HYPRGLASS_FEATURE_CONTOUR
    vec2 edgeNormal = contourOutward;
#else
    vec2 edgeNormal = sdfOutwardNormal(uv);
#endif
    float rimSdf = cornerSdf;
    float rimWidthPx = max(bevelSize * monitorScale * 3.0, 1.0);
#ifndef HYPRGLASS_FEATURE_CONTOUR
    if (hasMask) {
        float contourWidth = clamp(bevelSize * monitorScale * 3.0, 1.0, 20.0 * monitorScale);
        float searchRadius = max(contourWidth * 2.0, bevelSize * monitorScale * 2.0);
        float distancePx;
        vec2 outward;
        layerContour(uv, searchRadius, distancePx, outward);
        bool foundEdge = dot(outward, outward) > 0.5;
        edgeProximity = foundEdge ? exp(-distancePx / contourWidth) : 0.0;
        inwardDir = foundEdge ? -outward : vec2(0.0);
        edgeNormal = outward;
        rimSdf = -distancePx;
    }
#endif
    float rimT = clamp(-rimSdf / rimWidthPx, 0.0, 1.0);
    // One rounded shoulder, with a smooth transition into the flat body.
    float rimCurve = 9.48148148 * rimT * pow(1.0 - rimT, 3.0);
    if (hasMask)
        edgeProximity = rimCurve;
    vec2 posPx = (glassUV - 0.5) * glassBoxSizePx;

#ifdef HYPRGLASS_FEATURE_LENS_EDGE
    // ========================================
    // LENS EDGE REFRACTION (see lensBendPx). Replaces the soft edge refraction
    // below: refraction_flow and refraction_spread do not apply. Each channel has
    // its own refractive index, so the rainbow shows only where the rim is steep.
    // ========================================
    float rimDepthPx = max(-bevelSdf, 0.0);
    bool  inRim      = rimDepthPx < bezelWidthPx;
    vec2  offsetR    = vec2(0.0);
    vec2  offsetG    = vec2(0.0);
    vec2  offsetB    = vec2(0.0);
    vec2  lensInward    = inwardDir;
    vec2  lensNormal    = vec2(0.0, 1.0); // (inward, up)
    float lensSurfacePx = 0.0;            // glass height over the backdrop here
    float lensCornerWeight = 1.0;
    if (inRim) {
        float u    = 1.0 - rimDepthPx / bezelWidthPx; // 1 at the edge, 0 at the rim's inner side
        float rise = sqrt(max(1.0 - u * u, 0.0));
        lensSurfacePx = lensHeightPx * rise;
        lensNormal    = normalize(vec2(-u / bezelWidthPx, rise / max(lensHeightPx, 1e-3)));

#ifdef HYPRGLASS_FEATURE_CONTOUR
        lensInward = inwardDir;
#else
        vec2 grad = vec2(lensEdgeSDF(uv + vec2(invFullSize.x, 0.0)) - bevelSdf,
                         lensEdgeSDF(uv + vec2(0.0, invFullSize.y)) - bevelSdf);
        float gradLen = length(grad);
        if (gradLen > 1e-4) lensInward = -grad / gradLen;

        lensCornerWeight = lensCornerFade(uv, bezelWidthPx);
#endif
        float gain   = refractionStrength / LENS_REFERENCE_STRENGTH * lensCornerWeight;
        vec2  inwardStep = lensInward * invFullSize;
        offsetG = inwardStep * lensBendPx(lensNormal, lensSurfacePx, LENS_IOR, gain, bezelWidthPx);
        offsetR = offsetG;
        offsetB = offsetG;
        if (chromaticAberration > 0.001) {
            float spread = chromaticAberration * LENS_DISPERSION;
            offsetR = inwardStep * lensBendPx(lensNormal, lensSurfacePx, max(LENS_IOR - spread, 1.0), gain, bezelWidthPx);
            offsetB = inwardStep * lensBendPx(lensNormal, lensSurfacePx, LENS_IOR + spread, gain, bezelWidthPx);
        }
    }
#else
    // ========================================
    // EDGE REFRACTION
    // Offset sampling UV inward (toward center) at edges — like looking
    // through the curved thick edge of a glass slab. This compresses
    // and distorts what's already behind the window, without reaching
    // beyond the window boundary.
    // ========================================
    float refractionPx = refractionStrength * 50.0;
    if (hasMask)
        refractionPx = refractionStrength * rimWidthPx * 0.7;
    float lensFalloff = edgeProximity;
    if (refractionSpread < 0.999) {
        // rim-only lens: window the exponential tail so the centre stays flat
        float depth = -bevelSdf;
        float tailWindow = 1.0 - smoothstep(1.5 * bezelWidthPx, 3.0 * bezelWidthPx, depth);
        lensFalloff = mix(edgeProximity * tailWindow, edgeProximity, refractionSpread);
    }
    float refractionMag = lensFalloff * refractionPx;
    if (hasMask) {
        refractionMag = rimCurve * refractionPx;
    }
    vec2 dir = inwardDir;
#ifndef HYPRGLASS_FEATURE_CONTOUR
    // (a traced outline already pulls along each edge's own normal)
    if (refractionFlow > 0.001) {
        // pull along the edges instead of toward the centre
        vec2 mixedDir = mix(inwardDir, edgeDir(posPx), refractionFlow);
        float mixedLen = length(mixedDir);
        dir = mixedLen > 0.0001 ? mixedDir / mixedLen : inwardDir;
    }
#endif
    vec2 baseOffset = dir * refractionMag * invFullSize;

    // ========================================
    // CHROMATIC ABERRATION — per-channel refraction scale
    // Blue refracts more than red → natural spectral fringing at edges.
    // ========================================
    float chromaSpread = chromaticAberration * 0.35;
    vec2 offsetR = baseOffset * (1.0 - chromaSpread);
    vec2 offsetG = baseOffset;
    vec2 offsetB = baseOffset * (1.0 + chromaSpread);
#endif

    // ========================================
    // CENTER DOME LENS (subtle magnification in the flat interior)
    // Fades near edges so it doesn't interfere with edge refraction.
    // ========================================
    vec2 domeUV = vec2(0.0);
#ifndef HYPRGLASS_FEATURE_CONTOUR   // a dome needs one centre: a traced outline has one per card
    if (lensDistortion > 0.001) {
        // Attached shell surfaces share one monitor-space lens, including across their join.
        vec2 lensUV = hasMask ? uv * maskUVScale + maskUVOffset : glassUV;
        vec2 c = (lensUV - 0.5) * 2.0;
        vec2 dGrad = vec2(
            -4.0 * c.x * (1.0 - c.y * c.y),
            -4.0 * c.y * (1.0 - c.x * c.x)
        );
        float lensFade = hasMask ? 1.0 : 1.0 - edgeProximity;
        float lensScalePx = lensMaxPx;
        if (hasMask) {
            vec2 monitorSizePx = fullSize / max(maskUVScale, vec2(0.0001));
            lensScalePx *= min(monitorSizePx.x, monitorSizePx.y) / max(minDim, 1.0);
        }
        domeUV = dGrad * lensScalePx * lensFade * invFullSize;
    }
#endif

    // ========================================
    // BACKGROUND SAMPLING (frosted blur only)
    // Nearby color influence comes naturally from the Gaussian blur
    // kernel crossing the window boundary — no explicit raw sampling.
    // ========================================
    vec3 color;
    vec2 uvR = uv + offsetR + domeUV;
    vec2 uvG = uv + offsetG + domeUV;
    vec2 uvB = uv + offsetB + domeUV;

#ifdef HYPRGLASS_FEATURE_LENS_EDGE
    if (chromaticAberration > 0.001 && inRim) {
#else
    if (chromaticAberration > 0.001 && edgeProximity > 0.01) {
#endif
        color.r = sampleBlurred(uvR).r;
        color.g = sampleBlurred(uvG).g;
        color.b = sampleBlurred(uvB).b;
    } else {
        color = sampleBlurred(uvG).rgb;
    }

#ifdef HYPRGLASS_FEATURE_FROST
    // Frosted glass (frost): the backdrop was blurred further above; it also gets
    // a little more colour and depth, before the theme's tone mapping below.
    {
        float frostLum = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = max(mix(vec3(frostLum), color, 1.0 + FROST_SATURATION_LIFT * frostAmount), 0.0) * (1.0 - FROST_DIM * frostAmount);
    }
#endif

    // ========================================
    // FROSTED TINT (per-theme tone mapping)
    // ========================================
    float blurredLum = dot(color, vec3(0.2126, 0.7152, 0.0722));

    // Frosted desaturation
    color = mix(vec3(blurredLum), color, saturation);

    // Tight smoothstep range maps the blur-compressed luminance (~0.3-0.7)
    // to the full [0,1] adaptive range, creating visible per-region differentiation
    float lumCurve = smoothstep(0.25, 0.55, blurredLum);

    // Dim: multiplicative — effective at darkening bright areas
    color *= brightness * (1.0 - adaptiveDim * lumCurve);

    // Boost: additive lift — multiplicative can't brighten near-black content
    color += vec3(adaptiveBoost * (1.0 - lumCurve) * 0.5);

    // Contrast (pivot around midpoint)
    color = mix(vec3(0.5), color, contrast);

    // Vibrancy (selective saturation boost scaled by existing saturation)
    float currentLum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float sat = max(color.r, max(color.g, color.b)) - min(color.r, min(color.g, color.b));
    float darkFactor = 1.0 - vibrancyDarkness * (1.0 - blurredLum);
    color = mix(vec3(currentLum), color, 1.0 + vibrancy * sat * darkFactor);

    // ========================================
    // COLOR TINT OVERLAY
    // ========================================
    color = mix(color, tintColor, tintAlpha);

    // A soft central reflection stays behind client content and fades before the rim.
    vec2 reflectionPos = uv - vec2(0.5);
    float reflectionBand = exp(-pow((reflectionPos.x + 0.35 * reflectionPos.y) / 0.38, 2.0));
    float reflectionFade = 1.0 - smoothstep(0.15, 0.50, length(reflectionPos));
    float reflectionAmount = 0.03 * clamp(specularStrength, 0.0, 1.5) * reflectionBand * reflectionFade;
    float reflectionMax = max(max(color.r, color.g), color.b);
    vec3 reflectionHue = mix(vec3(1.0), reflectionMax > 0.001 ? color / reflectionMax : vec3(1.0), 0.25);
    color = mix(color, reflectionHue, reflectionAmount);

#ifdef HYPRGLASS_FEATURE_LENS_EDGE
    // ========================================
    // RIM REFLECTION — the rim mirrors what is around the glass, as much as
    // Schlick's Fresnel term gives for its slope: strongest where it is steepest.
    // ========================================
    if (lensReflection > 0.001 && inRim) {
        vec2 mirrored = reflect(vec2(0.0, -1.0), lensNormal); // (inward, up)
        // mirrored downward it lands on the backdrop just outside the edge; mirrored
        // upward it sees the surroundings, read as far out as the sample reaches
        // (one formula for both, so the reach has no seam where the slope crosses 45 degrees)
        float runPx   = lensSurfacePx * -mirrored.x / max(-mirrored.y, 1e-3);
        float reachPx = lensReflectionReachPx * tanh(min((rimDepthPx + runPx) / lensReflectionReachPx, 8.0));
        vec4  seen    = sampleBlurred(uv - lensInward * reachPx * invFullSize);
        // Schlick with lensReflection as the reflectance straight on (real glass: 0.04,
        // a thin line only), fading out across the rim so the flat centre gets no seam
        float u        = 1.0 - rimDepthPx / bezelWidthPx;
        float straight = lensReflection * u;
        float fresnel  = straight + (1.0 - straight) * pow(1.0 - clamp(lensNormal.y, 0.0, 1.0), 5.0);
        // padding past the screen edge is cleared to transparent: mirror only what was sampled
        float amount   = clamp(lensReflection * fresnel * seen.a * lensCornerWeight, 0.0, 1.0);
        // Layer samples are already normalized for transparent monitor padding.
        vec3 reflectedRGB = hasMask ? seen.rgb : seen.rgb / max(seen.a, 0.001);
        color = mix(color, reflectedRGB, amount);
    }
#endif

    // grain-free copy for the rim tints, so the grain does not speckle their hue
    vec3 tintSource = color;

    // ========================================
    // FROSTED GRAIN
    // Hashed on box-local pixels so the grain moves with the glass and keeps
    // its size on any window; after the tint so the tint does not fade it.
    // ========================================
    if (noiseStrength > 0.001)
        color += (pixelHash(floor(uv * fullSize)) - 0.5) * noiseStrength * 0.1;

    // ========================================
    // BEVEL — thin lit line hugging the edge, brightest on the side facing the light
    // ========================================
    float brightBackdrop = hasMask ? smoothstep(0.60, 0.90, dot(tintSource, vec3(0.2126, 0.7152, 0.0722))) : 0.0;
    vec3 rimReflection = vec3(0.0);
    float rimExposure = 1.0 - smoothstep(3.0 * monitorScale, 4.0 * monitorScale, -rimSdf);
    float lightingProximity = hasMask ? rimExposure : edgeProximity;
    float bevelLit = 0.0;
    float bevelDark = 0.0;
    vec3 bevelLight = vec3(1.0);
    if (bevelStrength > 0.001) {
        // Shell fills need illumination across the window's full exposed four-pixel rim.
        float sizePx = max((hasMask ? 4.0 : bevelSize) * monitorScale, 1.0);
        // Alpha-mask coverage needs a wider outer fade than the analytic window SDF.
        float core = hasMask ? min(0.66 * sizePx, monitorScale) : 0.25 * sizePx;
        float tail = sizePx;
        float ring = (1.0 - smoothstep(-core, 0.0, rimSdf)) * smoothstep(-tail, -core, rimSdf);

        // lit side faces the light, the far side fades out and can be shadowed
        float facing = clamp(dot(edgeNormal, lightDir(bevelAngle)) * 0.5 + 0.5, 0.0, 1.0);

        if (bevelColorAlpha > 0.001) bevelLight = mix(vec3(1.0), bevelColor, bevelColorAlpha);   // a dark colour gives a dark line
        if (bevelTint > 0.001) {
            float maxC = max(max(tintSource.r, tintSource.g), tintSource.b);
            bevelLight = mix(bevelLight, maxC > 0.001 ? tintSource / maxC : vec3(1.0), bevelTint);
        }

        // Bright backdrops need a restrained, hue-preserving edge instead of a clipped white highlight.
        if (hasMask)
            bevelLight = mix(bevelLight, clamp(tintSource, 0.0, 1.0) * 0.80, brightBackdrop);

        // the fresnel tint below reads the bevelled colour, so bevel the copy too
        bevelLit = clamp(ring * facing * bevelStrength, 0.0, 1.0);
        bevelDark = hasMask ? 0.0 : clamp(ring * (1.0 - facing) * bevelShadow, 0.0, 1.0);
        if (!hasMask) {
            color = mix(mix(color, bevelLight, bevelLit), vec3(0.0), bevelDark);
            tintSource = mix(mix(tintSource, bevelLight, bevelLit), vec3(0.0), bevelDark);
        }
    }

    // ========================================
    // FRESNEL RIM GLOW (edge zone)
    // ========================================
    if (fresnelStrength > 0.001) {
        float fresnel = lightingProximity * lightingProximity * fresnelStrength * 0.15;
        vec3 fresnelLight = vec3(1.0);
        if (fresnelColorAlpha > 0.001) fresnelLight = mix(vec3(1.0), fresnelColor, fresnelColorAlpha);   // chosen colour, then the tint below
        if (fresnelTint > 0.001) {
            // rim light in the background's own hue, at full brightness so the gain matches white
            float maxC = max(max(tintSource.r, tintSource.g), tintSource.b);
            fresnelLight = mix(fresnelLight, maxC > 0.001 ? tintSource / maxC : vec3(1.0), fresnelTint);
        }
        if (hasMask) rimReflection += fresnelLight * fresnel;
        else color += fresnelLight * fresnel;
    }

    // ========================================
    // SPECULAR — subtle top highlight (edge zone)
    // ========================================
    if (specularStrength > 0.001) {
#ifdef HYPRGLASS_FEATURE_CONTOUR
        // the edge facing the light, like the top of a box at angle 0
        float specT = clamp(0.5 + 0.5 * dot(contourOutward, lightDir(specularAngle)), 0.0, 1.0);
#else
        float specT = max(1.0 - glassUV.y, 0.0);
        if (abs(specularAngle) > 0.001) {
            // rotate the highlight gradient toward the light: at angle 0, lightDir gives
            // (0,-1) and dot(glassUV-0.5, L) = 0.5-glassUV.y, so 0.5+dot(...) reduces to 1-glassUV.y exactly
            vec2 L = lightDir(specularAngle);
            specT = clamp(0.5 + dot(glassUV - 0.5, L), 0.0, 1.0);
        }
#endif
        float topBias = pow(specT, 2.0);
        float spec = topBias * lightingProximity * lightingProximity * specularStrength * 0.08;
        if (hasMask) rimReflection += vec3(1.0, 0.99, 0.97) * spec;
        else color += vec3(1.0, 0.99, 0.97) * spec;
    }

    // ========================================
    // INNER SHADOW (bottom rim)
    // ========================================
    if (!hasMask) {
#ifdef HYPRGLASS_FEATURE_CONTOUR
        // the edge facing away from the light: 1 at the bottom, a quarter at the sides, like a box
        float bottomBias = pow(0.5 + 0.5 * contourOutward.y, 2.0);
#else
        // max(): item fragments just above the glass box have glassUV.y < 0, where pow() is undefined
        float bottomBias = pow(max(glassUV.y, 0.0), 2.0);
#endif
        float shadow = bottomBias * edgeProximity * edgeProximity * 0.06;
        color *= 1.0 - shadow;
    }

#ifdef HYPRGLASS_FEATURE_FOCUS_LIGHT
    // ========================================
    // FOCUS LIGHT — the active window's edge lit all the way round: a bright
    // line just inside the edge over a soft sheen, brightest on the side the
    // bevel light comes from. Last, so the inner shadow does not dim it.
    // ========================================
    float depthLogical = max(-bevelSdf, 0.0) / max(monitorScale, 0.001);
    if (depthLogical < FOCUS_LIGHT_REACH) {
        float lineT = (depthLogical - FOCUS_LIGHT_LINE_DEPTH) / FOCUS_LIGHT_LINE_WIDTH;
        float profile = exp(-lineT * lineT) + FOCUS_LIGHT_SHEEN * exp(-depthLogical / FOCUS_LIGHT_SHEEN_FALLOFF);

        // outward normal of the same crease-free distance, so the corners light without a seam
        float sdfRight = roundingPower == 2.0 ? getBevelSDF(uv + vec2(invFullSize.x, 0.0)) : getCornerSDF(uv + vec2(invFullSize.x, 0.0));
        float sdfDown  = roundingPower == 2.0 ? getBevelSDF(uv + vec2(0.0, invFullSize.y)) : getCornerSDF(uv + vec2(0.0, invFullSize.y));
        vec2  grad     = vec2(sdfRight - bevelSdf, sdfDown - bevelSdf);
        float gradLen  = length(grad);
        vec2  outward  = gradLen > 1e-4 ? grad / gradLen : vec2(0.0, -1.0);
        float facing   = clamp(dot(outward, lightDir(bevelAngle)) * 0.5 + 0.5, 0.0, 1.0);

        vec3 light = focusLightColorAlpha > 0.001 ? mix(vec3(1.0), focusLightColor, focusLightColorAlpha) : vec3(1.0);
        color = mix(color, light, clamp(focusLight * mix(FOCUS_LIGHT_FLOOR, 1.0, facing) * profile, 0.0, 1.0));
    }
#endif

    // float framebuffers (FP16 under wide-gamut cm) store unbounded values and
    // the glass re-samples its own output: unclamped color diverges over frames
    color = clamp(color, 0.0, 1.0);
    float glassA = clamp(glassOpacity * cornerAlpha * maskRamp, 0.0, 1.0);

    if (hasMask) {
        // Layers only: composite the rendered surface over the glass effect
        // in a single pass. surfacePixel is premultiplied alpha from Hyprland's
        // surface rendering, so we unpremultiply before the 'over' blend.
        float surfA = surfacePixel.a;
        vec3 surfRGB = surfA > 0.001 ? surfacePixel.rgb / surfA : vec3(0.0);

        float compA = surfA + glassA * (1.0 - surfA);
        vec3 compRGB = compA > 0.001
            ? (surfRGB * surfA + color * glassA * (1.0 - surfA)) / compA
            : vec3(0.0);
        // Expose the same four-pixel glass strip that surrounds application content.
        compRGB = mix(compRGB, color, rimExposure);
        // Surface fills must not cover the shell's light-facing bevel.
        compRGB = clamp(mix(mix(compRGB, bevelLight, bevelLit), vec3(0.0), bevelDark) + rimReflection * (1.0 - 0.80 * brightBackdrop), 0.0, 1.0);

        // Hyprland's compositor expects premultiplied alpha (blend GL_ONE, GL_ONE_MINUS_SRC_ALPHA).
        fragColor = vec4(compRGB * compA, compA);
    } else {
        // Windows: output the glass effect alone, surface is rendered separately by Hyprland.
        // Premultiplied: without this, a fading window's glass keeps full RGB contribution
        // because the GL_ONE source factor adds raw color regardless of alpha.
        fragColor = vec4(color * glassA, glassA);
    }
}
