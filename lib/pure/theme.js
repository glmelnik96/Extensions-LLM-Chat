/**
 * Host-theme palette derivation (AppSkinInfo → CSS design tokens).
 *
 * Pure, side-effect-free. Loaded as a browser global (window.PURE_THEME) and
 * as a Node module (require) so it can be unit-tested.
 *
 * AE's brightness slider reports the panel background via AppSkinInfo
 * (RGB 0-255, sometimes floats). We derive the full token set from that one
 * color: surfaces scale relative to it, text/accents flip between a dark and
 * a light scheme at the luminance midpoint. All var names must exist in
 * styles.css :root — this module only overrides them.
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.PURE_THEME = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  function clamp (v) {
    return Math.max(0, Math.min(255, Math.round(v)))
  }

  function toHex (r, g, b) {
    function h (v) {
      var s = clamp(v).toString(16)
      return s.length === 1 ? '0' + s : s
    }
    return '#' + h(r) + h(g) + h(b)
  }

  /** Shift an rgb color by delta on every channel (negative = darker). */
  function shade (rgb, delta) {
    return toHex(rgb.red + delta, rgb.green + delta, rgb.blue + delta)
  }

  /** Perceived luminance 0-255 (ITU-R BT.601 weights). */
  function luminance (rgb) {
    return 0.299 * rgb.red + 0.587 * rgb.green + 0.114 * rgb.blue
  }

  /**
   * Build the CSS custom-property overrides for a given panel background.
   * @param {{red:number, green:number, blue:number}} bg — 0-255 channels
   *   (floats accepted, as CEP reports them).
   * @returns {{isLight: boolean, vars: Object<string, string>}}
   */
  function derivePalette (bg) {
    var lum = luminance(bg)
    var isLight = lum >= 128

    var vars
    if (!isLight) {
      // Dark scheme: surfaces step UP from the host background,
      // the transcript/input well steps DOWN.
      vars = {
        '--bg-panel': shade(bg, 0),
        '--bg-deep': shade(bg, -15),
        '--surface': shade(bg, 8),
        '--surface-hover': shade(bg, 19),
        '--border': shade(bg, 28),
        '--border-subtle': shade(bg, 14),
        '--text': '#e8e8e8',
        '--text-dim': '#9d9d9d',
        '--text-faint': '#707070',
        '--accent': '#5c9ce0',
        '--accent-strong': '#7ab4f0',
        '--accent-bg': '#263a50',
        '--accent-border': '#3d5f85',
        '--ok': '#7dd8a0',
        '--ok-bg': '#24382c',
        '--warn': '#e8c87a',
        '--warn-bg': '#3a3222',
        '--warn-border': '#6e5a2e',
        '--err': '#f0a0a0',
        '--err-bg': '#402828',
        '--err-border': '#6e3a3a'
      }
    } else {
      // Light scheme (AE brightness slider at the bright end):
      // surfaces step DOWN from the background, text flips dark.
      vars = {
        '--bg-panel': shade(bg, 0),
        '--bg-deep': shade(bg, 14),
        '--surface': shade(bg, -8),
        '--surface-hover': shade(bg, -19),
        '--border': shade(bg, -40),
        '--border-subtle': shade(bg, -22),
        '--text': '#1e1e1e',
        '--text-dim': '#555555',
        '--text-faint': '#808080',
        '--accent': '#2f6cb3',
        '--accent-strong': '#1f5a9e',
        '--accent-bg': '#d4e4f5',
        '--accent-border': '#8ab0d8',
        '--ok': '#1e6e3c',
        '--ok-bg': '#d2ecd9',
        '--warn': '#7a5a10',
        '--warn-bg': '#f2e6c2',
        '--warn-border': '#c0a050',
        '--err': '#9e2f2f',
        '--err-bg': '#f5d8d8',
        '--err-border': '#d09090'
      }
    }
    return { isLight: isLight, vars: vars }
  }

  /**
   * Extract the {red, green, blue} panel background from a CEP AppSkinInfo
   * object. Returns null when the shape is unexpected (stay on CSS defaults).
   */
  function backgroundFromSkinInfo (skinInfo) {
    var c = skinInfo && skinInfo.panelBackgroundColor && skinInfo.panelBackgroundColor.color
    if (!c || typeof c.red !== 'number' || typeof c.green !== 'number' || typeof c.blue !== 'number') return null
    return { red: c.red, green: c.green, blue: c.blue }
  }

  return {
    derivePalette: derivePalette,
    backgroundFromSkinInfo: backgroundFromSkinInfo,
    // exported for tests
    _shade: shade,
    _luminance: luminance
  }
})
