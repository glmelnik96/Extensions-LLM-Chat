# Expression language basics (Adobe)

Primary reference: Adobe After Effects Expression Language.

## Globals and environment

- Expressions run in the After Effects expression environment (no DOM, no browser/Node APIs, no arbitrary file I/O).
- Standard globals: `thisComp`, `thisLayer`, `thisProperty`, `parent`, `time`, `value`, `velocity`.
- Property groups: `transform`, `position`, `anchorPoint`, `scale`, `rotation`, `opacity`; `effect("Name")("Property")` for effects.
- No `app`, `$`, `File`, `Folder`, `system.callSystem` in expressions.

## Property targeting

- Expression is evaluated in the context of the property it is applied to. `value` is the current value of that property.
- Use `thisLayer`, `thisComp.layer(index)` or `thisComp.layer("Name")` to reference other layers. Match target property type (e.g. Position expects array, Slider expects number).

## Common patterns

- Linking: `thisComp.layer("Controller").effect("Slider")("Slider")` or `thisLayer.parent.property("Transform>Position")`.
- Time-based: `time`, `valueAtTime(time - delay)`, `key()` for keyframes.
- Looping: `loopOut()`, `loopIn()`, `loopOut("cycle")`, `loopOut("pingpong")`.

## JavaScript engine pitfalls (AE 26 / V8)

- Do **not** use `this()`; use **thisLayer** (e.g. thisLayer(5)(2) for layer index and property).
- Do **not** use deprecated snake_case (this_comp, to_world, etc.); use **camelCase** (thisComp, toWorld).
- **Source Text** character access: in the JavaScript engine use **text.sourceText.value[i]**, not text.sourceText[i].
- **Source Text baseline read**: On Text > Source Text, `value` may be a **string** (not a TextDocument). Do not use `value.text` alone — it can be undefined and cause TypeError. Use a defensive read: `(typeof value === 'string' ? value : value.text)` or documented layer text APIs.
- **if/else**: strict JavaScript syntax; use brackets and explicit else where required; expression cannot end in an if without else.
- The expression must **end in a value** (the property result); it cannot end in a function declaration only.

## Compatibility

- JavaScript expression engine (AE 26.0+): modern syntax. Legacy ExtendScript engine: different globals/APIs. This extension targets the JavaScript engine.
