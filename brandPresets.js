;(function () {
  'use strict'

  var BRAND_COLORS = {
    green: [0.149, 0.816, 0.486],
    dark: [0.133, 0.133, 0.133],
    lightGreen: [0.812, 0.961, 0],
    nearWhite: [0.969, 0.969, 0.969],
    white: [1, 1, 1],
    black: [0, 0, 0]
  }

  var BRAND_FONTS = {
    displaySemibold: 'SBSansDisplay-Semibold',
    displayRegular: 'SBSansDisplay-Regular',
    textRegular: 'SBSansText-Regular'
  }

  var BRAND_PRESET_LABELS = {
    logo_reveal: 'Logo Reveal',
    lower_third: 'Lower Third',
    text_card: 'Text Card'
  }

  var BRAND_PRESET_DEFAULTS = {
    logo_reveal: {
      duration: 2.2,
      with_subline: false,
      subline_text: '',
      with_background: false
    },
    lower_third: {
      name_text: 'Speaker Name',
      title_text: 'Job Title',
      display_duration: 5
    },
    text_card: {
      line1: 'Line 1',
      line2: 'Line 2',
      display_duration: 7
    }
  }

  var BRAND_KEYWORDS = {
    logo_reveal: ['логошот', 'logoshot', 'logo reveal', 'brand logo', 'лого ревил', 'cloud.ru logo'],
    lower_third: ['lower third', 'нижняя плашка', 'подпись спикера', 'титры спикера', 'name plate'],
    text_card: ['text card', 'текстовая плашка', 'плашка', 'smm плашка', 'карточка']
  }

  if (typeof window !== 'undefined') {
    window.BRAND_PRESETS_CONFIG = {
      colors: BRAND_COLORS,
      fonts: BRAND_FONTS,
      labels: BRAND_PRESET_LABELS,
      defaults: BRAND_PRESET_DEFAULTS,
      keywords: BRAND_KEYWORDS
    }
  }
})()
