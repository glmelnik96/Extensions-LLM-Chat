# wiggle, valueAtTime, posterizeTime (Adobe)

## wiggle(freq, amp)

- **freq**: frequency in Hz (how often per second).
- **amp**: amplitude (same units as the property: degrees for rotation, pixels for position, 0–100 for opacity, etc.).
- Returns a value that varies over time. Apply to Position, Rotation, Opacity, Scale, etc.
- Example: `wiggle(2, 20)` on Position adds 2 Hz oscillation with 20 px amplitude (each axis can vary; for X-only see “wiggle by axis” patterns in docs).

## valueAtTime(t)

- **t**: time in seconds. Can be `time`, `time - 0.5`, or an expression that evaluates to a number.
- Returns the value of the property at time **t**. Used for delays, trails, and time offsets.
- Example: `thisComp.layer("Driver").transform.position.valueAtTime(time - 0.2)` — delayed link by 0.2 s.

## posterizeTime(fps)

- **fps**: frames per second (e.g. 12 for stepped animation).
- Causes the expression to be evaluated at a lower temporal rate; property appears to “step” in time.
- Example: `posterizeTime(12); wiggle(2, 30)` — wiggle sampled at 12 fps.

## Time-related helpers

- `time`: current composition time in seconds.
- `inPoint` / `outPoint`: layer in/out in comp time.
- Keyframes: `key(n)`, `nearestKey(time)`, `numKeys` (on the property). Use for keyframe-driven logic.
