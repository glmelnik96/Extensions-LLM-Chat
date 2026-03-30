# Common expression patterns (docsforadobe mirror)

Secondary reference: docsforadobe After Effects Expression Reference.

## Linking and driving

- Drive one property from another: `comp.layer("A").transform.position` (same comp). Add offset if needed: `comp.layer("A").transform.position + [10, 0]`.
- Slider control: `effect("Slider Control")("Slider")` or the actual effect name. Use for reusable parameters.

## Looping

- `loopOut("cycle", 0)` — cycle keyframes. `loopOut("pingpong", 0)` — bounce. First argument is type, second is keyframe offset.
- Custom cycle: `valueAtTime(time % duration)` with a defined duration variable.

## Easing

- `linear(t, tMin, tMax, value1, value2)`, `ease(t, tMin, tMax, value1, value2)`, `easeIn`, `easeOut`, `easeInOut` — use for remapping time or a slider to a value range.

## Validation notes

- Validator should ensure only documented globals and methods are used. Flag unknown APIs. Repair should replace with documented equivalents where possible.
