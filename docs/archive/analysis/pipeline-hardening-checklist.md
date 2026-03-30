# Pipeline hardening – manual test checklist

Use this checklist after contract/parsing hardening to confirm behavior is unchanged and fewer false failures occur.

---

## 1. Successful generation

- Set API key; select a layer and property (e.g. Position).
- Send: e.g. "wiggle 5 10 on position".
- **Expected:** Status: Preparing → Generating → Validating → Applying checks → Validating → Finalizing → "Completed successfully." One **assistant** message with expression + ---EXPLANATION--- + bullets. Apply button **enabled**. Expression has no visible code fences in the chat.

---

## 2. Blocked rules path

- Send a prompt that leads to output with leftover markers in the expression (e.g. if the model puts ---EXPLANATION--- inside the expression block).
- **Expected:** One **system** message (e.g. "Rules check failed: …"). Apply **disabled**. No expression stored.
- Optional: Send a prompt that produces an expression with only **leading/trailing** code fences (e.g. \`\`\` … \`\`\`). **Expected:** Rules pass; sanitized expression (no fences) is used; result is acceptable or warned_draft as per validation.

---

## 3. Warned draft

- Use a prompt that yields validation **warn** (e.g. edge-case expression).
- **Expected:** One **assistant** message with "[Warning: not fully validated]" (or equivalent). Apply **disabled**. Status "Completed with warnings."

---

## 4. Repair path

- Use a prompt that triggers validation **fail** and repair (e.g. small fixable error like wrong type).
- **Expected:** Status shows "Repairing expression…"; after repair and re-validation, either acceptable (Apply enabled) or warned_draft/blocked. No intermediate generator/validator/repair messages in chat.

---

## 5. Missing config

- Ensure apiKey is empty (e.g. use example.config.js); send a message.
- **Expected:** Status "Set API key in config. See config/README.md"; no request sent; no crash.

---

## 6. Malformed response

- If testable (e.g. mock or broken endpoint), trigger empty or invalid JSON from API.
- **Expected:** Fallback to Qwen if configured; or one **system** message "Invalid response from cloud model…" (or similar). No crash. No verbose stack in chat.

---

## 7. Final-only output

- Run pipeline (any of the above) and watch the chat transcript.
- **Expected:** Only **one** new message per send (one assistant or one system). No generator/validator/repair intermediate messages in the transcript.

---

## 8. Apply enabled only for acceptable result

- After a **successful** run (acceptable): Apply button **enabled**.
- After **warned_draft** or **blocked**: Apply button **disabled**.
- **Expected:** Apply is enabled only when the final disposition is acceptable and latestExtractedExpression is set.

---

## Validation scripts

- `node scripts/validate-repo.js` → Repository structure OK
- `node scripts/check-required-files.js` → All required files present
