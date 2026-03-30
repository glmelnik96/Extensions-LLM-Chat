# Source Text and sourceRectAtTime (Adobe)

## Source Text (text layers)

- Property path: Text > Source Text. Access in expressions via the text animator or `sourceText` where available.
- **Reading the current text**: On Source Text, `value` is often a **string** in the JavaScript expression engine (not an object with `.text`). Using `value.text` can yield `undefined` and cause TypeError (e.g. reading `.length` on undefined). Use a defensive read: `var full = (typeof value === 'string' ? value : (value && value.text != null ? value.text : ''));` or equivalent. When returning, you may still assign to a TextDocument (e.g. `doc.text = ...; doc;`) where the API expects it.
- Text animators: `text.animator("Animator Name").property("Selector").property("Property")`; `textIndex`, `textTotal` for character/word/line scope.
- **Restriction**: Not all text properties are expression-accessible; Source Text itself may be read-only in some versions. Prefer documented expression APIs for text.

## sourceRectAtTime(t, includeExtents)

- **t**: time in seconds (often `time`).
- **includeExtents**: optional boolean; when true, includes extents for the layer.
- Returns a rectangle object with `left`, `top`, `width`, `height`, `right`, `bottom` (and others when includeExtents). Used for text bounding box, alignment, and layout.
- Common use: `thisLayer.sourceRectAtTime(time)` or `thisLayer.sourceRectAtTime(time, true)` for per-character or layer bounds.
- **Property suitability**: Typically used on text layers for character/word position or size. Validator should flag use on non-text layers if docs say so.

## Property suitability

- Source Text expressions: ensure target is a text layer and the property is expression-capable. Validator should check target_ok for Text > Source Text.
