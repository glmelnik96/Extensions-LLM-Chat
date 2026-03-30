# Targeting rules (shared)

- When the user has selected a **target** (composition, layer, property), all output must be valid for that exact property. For example, if the target is "Transform > Position" on "Layer 2", the expression must return a value appropriate for Position (array [x, y] or [x, y, z] in 3D). If the target is "Text > Source Text", the expression must be valid for that property and layer type.
- Do not generate expressions intended for a different property (e.g. a Position expression when the target is Source Text). The validator must flag **target_ok: false** if the expression does not match the target.
- Property paths used by the panel include: Transform>Position, Transform>Scale, Transform>Rotation, Transform>Opacity, Text>Source Text. Use these path names when referring to the target in instructions or reports.
- The panel passes target context as: comp name, layer name, layer index, property path, property display name. Use this to confirm the expression fits the target.
