# Release checklist

Use this checklist before packaging or releasing the CEP extension.

---

## Pre-release validation

- [ ] **Repo structure**: Run `node scripts/validate-repo.js` from repo root; exit code 0.
- [ ] **Required files**: Run `node scripts/check-required-files.js`; exit code 0.
- [ ] **Config**: Ensure `config/example.config.js` is committed; `config/runtime-config.js` is **not** committed (in .gitignore). No real API keys in repo.
- [ ] **Docs**: Key docs present and up to date (configuration.md, secret-handling.md, manual-apply-policy.md, final-result-policy.md, pipeline-runtime-flow.md, qa-test-plan.md, troubleshooting.md). Install/packaging notes: root README and [archive/plans/deployment-notes.md](archive/plans/deployment-notes.md) if needed.

---

## Functional QA

- [ ] **Startup**: Panel launches with default config (example.config.js); status shows config message when apiKey empty.
- [ ] **Startup**: With valid runtime-config, panel loads and Send works when session + input present.
- [ ] **Sessions**: New, switch, rename, clear, clear all, persistence after reload (see docs/qa-test-plan.md).
- [ ] **Target**: Refresh (@), layer selection, property selection, getResolvedTarget() behavior.
- [ ] **Pipeline**: Happy path → one assistant message, Apply enabled, latestExtractedExpression set.
- [ ] **Pipeline**: Blocked path → system message, Apply disabled.
- [ ] **Pipeline**: Warned draft → warning prefix, Apply disabled.
- [ ] **Apply**: Manual Apply only; success and error paths (invalid target, unsupported property) show host message.
- [ ] **No auto-apply**: Expression not applied until user clicks Apply.
- [ ] **Final-only output**: No generator/validator/repair messages in chat.

---

## Deployment

- [ ] **manifest**: CSXS/manifest.xml version and host list correct for target AE version.
- [ ] **Host script**: host/index.jsx is included and invoked via CSInterface.evalScript for Apply and target refresh.
- [ ] **Paths**: All script paths in index.html are correct for the install location (relative to extension root).
- [ ] **Instructions**: README (and optionally [archive/plans/deployment-notes.md](archive/plans/deployment-notes.md)) describe how to install and configure (config, API key).

---

## Post-release

- [ ] **Changelog / notes**: Any known limitations or deferred items documented (e.g. in [archive/reports/stage-5-hardening-report.md](archive/reports/stage-5-hardening-report.md)).
- [ ] **Secrets**: Confirm no keys or tokens in packaged artifact; users supply config locally.

---

See **docs/qa-test-plan.md** for step-by-step test cases and **docs/archive/qa/manual-test-matrix.md** for a compact pass/fail matrix.
