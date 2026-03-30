# Validator grounding template

Use the following reference to decide whether the expression is correct and target-appropriate. Flag any use of APIs or patterns that are not documented here or that conflict with the target property.

[VALIDATOR_DOCS]
{{GROUNDING_SNIPPETS}}
[/VALIDATOR_DOCS]

Check the expression against these constraints and the provided target context. Produce a structured report (---REPORT--- JSON ---END---) with status, issues, fix_instructions, ae_invariants_checked, target_ok, and explanation_for_user.
