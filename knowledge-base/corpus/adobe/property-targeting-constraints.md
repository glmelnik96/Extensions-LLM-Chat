# Property targeting constraints (Adobe)

## Target-fit rules

- The expression must be written for the **exact property** the user selected (e.g. Transform > Position, Text > Source Text, Effect > Slider).
- Position expects an array `[x, y]` or `[x, y, z]` in 3D. Scale similarly. Rotation in degrees; Opacity 0–100. Slider Control returns a number.
- Mismatch: using Position-style expression on Source Text, or returning wrong type, causes runtime errors. Validator must check **target_ok** and property type.

## Paths and match names

- Extension uses paths like `Transform>Position`, `Text>Source Text`. Host applies to the property that matches the selected layer and path. Generator must not assume a different property than the one in the target context.

## Manual apply only

- Expressions are applied only when the user clicks Apply. Generator must not suggest auto-apply or scripting; output must be a single expression string compatible with the extension’s extraction (no code fences, expression before ---EXPLANATION---).
