# Validator report schema

The report must be a single JSON object after ---REPORT--- and before ---END---. Do not wrap the JSON in markdown code fences; the panel parses raw JSON between the markers.

Keys:

- **status** (string): One of "pass", "warn", "fail". Use "pass" when the expression is correct and target-appropriate; "warn" when it is mostly correct but has minor issues or assumptions; "fail" when it has errors or is not suitable for the target.
- **issues** (array of strings): List of specific issues, e.g. "Expression uses app which is not available in expressions", "Position must return [x, y], not a number".
- **fix_instructions** (string): Concise instructions for the repair pass or user on how to fix the issues. Be specific (e.g. "Replace app with thisComp; return [value, value] for Position").
- **ae_invariants_checked** (boolean): True if you verified no forbidden APIs and correct target type; false otherwise.
- **target_ok** (boolean): True if the expression is appropriate for the stated target property; false if it targets a different property or returns the wrong type.
- **explanation_for_user** (string): Short human-readable summary for the panel (e.g. "Expression is valid for Position on this layer" or "Expression uses document which is not supported in AE expressions").
