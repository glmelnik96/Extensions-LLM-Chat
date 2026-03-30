# Patching policy

- **Do not rewrite unnecessarily**: If the validator reported "missing semicolon" or "use thisComp instead of app", make only that change. Do not refactor the whole expression.
- **Preserve structure**: Keep the same logic flow and variable names unless they are part of the issue (e.g. wrong type returned).
- **One issue at a time**: If there are multiple issues, fix all of them in one pass but with minimal edits. Do not add new logic or features.
- **Target unchanged**: The repaired expression must still be for the same target property (e.g. Transform > Position). Do not change the layer or property the expression is written for.
- **Output contract**: Repaired expression only (no code fences), then ---EXPLANATION---, then 1–3 bullets. No JSON block. The panel’s extractor takes the text before ---EXPLANATION--- as the expression.
