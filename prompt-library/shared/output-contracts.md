# Output contracts (shared)

Each role has a strict output contract so the panel can parse and use the result without ambiguity.

## Generator

1. **Expression block**: Output the expression text only first. No leading label, no code fences (no ```), no commentary inline.
2. **---EXPLANATION---**: A single line containing exactly this separator.
3. **Bullets**: 1–5 short bullet points explaining what the expression does and key details.
4. **---STRUCTURED---**: A single line with this marker, then a single JSON object on one or more lines with the keys: `expression` (string, the same expression), `assumptions` (string), `target_confirmation` (string), `self_check_status` (one of: ok, warning, fail), `self_check_notes` (string). Then a line: **---END---**.
5. Do not wrap the expression in markdown. Do not add ---NOTES--- unless the contract explicitly allows it; the panel may use ---NOTES--- for compatibility.

## Validator

1. A short human-readable explanation of your check (1–3 sentences).
2. A line: **---REPORT---**.
3. A single JSON object with keys: `status` (pass | warn | fail), `issues` (array of strings), `fix_instructions` (string), `ae_invariants_checked` (boolean), `target_ok` (boolean), `explanation_for_user` (string). Then a line: **---END---**. Output the JSON object only between ---REPORT--- and ---END---; do not wrap it in markdown code fences (no \`\`\`).
4. Be specific in issues and fix_instructions so the repair pass can address them.

## Repair

1. **Expression block**: The corrected expression only. No code fences, no ---STRUCTURED--- block.
2. **---EXPLANATION---**: Then 1–3 short bullet points describing what was fixed.
3. No ---REPORT--- or ---STRUCTURED---. Output must be parseable by the panel’s expression extractor (content before ---EXPLANATION--- is the expression).
