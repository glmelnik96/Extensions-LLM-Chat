# Release checklist

Use this checklist before packaging or releasing the CEP extension.

---

## Pre-release validation

- [ ] **Repo structure**: Run `node scripts/validate-repo.js` from repo root; exit code 0.
- [ ] **Required files**: Run `node scripts/check-required-files.js`; exit code 0.
- [ ] **Config**: Ensure `config/example.config.js` is committed; `config/runtime-config.js` is **not** committed (in .gitignore). No real API keys in repo.
- [ ] **Docs**: Key active docs present (configuration.md, secret-handling.md, qa-test-plan.md, troubleshooting.md, capabilities-and-roadmap.md). Redirect stubs (manual-apply-policy, final-result-policy, pipeline-runtime-flow, etc.) must exist at `docs/*.md`. Deep legacy: [legacy-archive-on-user-request-only/planning/plan-deployment-install-packaging.md](legacy-archive-on-user-request-only/planning/plan-deployment-install-packaging.md).

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
- [ ] **Instructions**: README (and optionally [legacy-archive-on-user-request-only/planning/plan-deployment-install-packaging.md](legacy-archive-on-user-request-only/planning/plan-deployment-install-packaging.md)) describe how to install and configure (config, API key).

---

## Post-release

- [ ] **Changelog / notes**: Known limitations in [capabilities-and-roadmap.md](capabilities-and-roadmap.md); historical hardening context in [legacy-archive-on-user-request-only/implementation-reports/report-stage-05-hardening-diagnostics-release-prep.md](legacy-archive-on-user-request-only/implementation-reports/report-stage-05-hardening-diagnostics-release-prep.md).
- [ ] **Secrets**: Confirm no keys or tokens in packaged artifact; users supply config locally.

---

See **docs/qa-test-plan.md** for the short agent smoke list; extended matrices and Copilot-era plans live under **docs/legacy-archive-on-user-request-only/qa-testing/** (open when needed).
