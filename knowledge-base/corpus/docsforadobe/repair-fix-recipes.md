# Repair-oriented fix recipes (docsforadobe)

Narrow, issue-targeted guidance for the repair pass. Do not rewrite the whole expression unless necessary.

## Missing semicolons / syntax

- Add semicolons where the engine requires them. Preserve structure; fix only the reported syntax error.

## Wrong property type

- Position: must return `[x, y]` or `[x, y, z]`. If the expression returns a number, wrap: `[value, value]` or use the correct property.
- Slider: must return a number. If returning array, take `[0]` or use the correct component.

## Forbidden identifiers

- Replace `app`, `$`, `document`, `window`, `require` with expression-safe equivalents. Remove or replace with `thisComp`/`thisLayer`/`effect()` as appropriate.

## JavaScript engine–specific fixes

- **this()**: Replace with **thisLayer** (e.g. thisLayer(5)(2) for layer and property).
- **Snake_case**: Replace deprecated names with camelCase (this_comp → thisComp, to_world → toWorld).
- **Source Text character access**: Use **text.sourceText.value[i]** in the JavaScript engine, not text.sourceText[i].
- **Source Text baseline read**: On Source Text, `value` may be a string; `value.text` can be undefined and cause TypeError. Fix by reading baseline text as `(typeof value === 'string' ? value : value.text)` or similar defensive pattern.
- **if/else**: Use brackets and explicit else; expression must end in a returned value, not only a function declaration.

## Target mismatch

- If the expression references a different layer or property than the target, adjust to the target context: use `thisLayer`, `thisComp.layer(index)` or the user’s layer name, and the exact property path (Transform>Position, etc.) from the target.

## Wiggle / valueAtTime / posterizeTime

- Ensure first argument is numeric (e.g. `wiggle(2, 20)`). For valueAtTime use `time` or a number. For posterizeTime use a number for fps. Do not pass strings.
