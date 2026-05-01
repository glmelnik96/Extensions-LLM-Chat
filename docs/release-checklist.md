# Release Checklist

Pre-release validation for the AE Motion Agent CEP extension.

> **MVP cut:** 2026-05-01. Cleanup на chat-only + 10 улучшений. Подтверждено T1-T10 manual-тестами. Далее — патчи качества/скорости.

---

## Structure

- [ ] Required files exist: `index.html`, `main.js`, `styles.css`, `host/index.jsx`, `CSXS/manifest.xml`
- [ ] Agent modules: `agentSystemPrompt.js`, `agentToolLoop.js`, `chatProvider.js`, `hostBridge.js`, `toolRegistry.js`
- [ ] Config: `config/example.config.js` committed, `secrets.local.js` and `runtime-config.js` in `.gitignore`
- [ ] No real API keys in any tracked file

---

## Functional QA

- [ ] Panel launches, status shows **Ready** (or config message if no key)
- [ ] Agent cycle: happy path — tool calls + final text
- [ ] Tool errors shown in cards, panel remains responsive
- [ ] Undo reverts all mutating actions
- [ ] Stop cancels running agent
- [ ] Session persistence after reload
- [ ] Quick actions: buttons trigger correct prompts
- [ ] Export: saves JSON to Desktop
- [ ] Report: generates LLM-analyzed report to Desktop
- [ ] Streaming: text appears incrementally during generation

See [qa-test-plan.md](qa-test-plan.md) for full smoke list.

---

## Deployment

- [ ] `CSXS/manifest.xml` version and host list correct for target AE version
- [ ] `--enable-nodejs` and `--mixed-context` parameters in manifest
- [ ] All script paths in `index.html` are correct (relative to extension root)
- [ ] `lib/CSInterface.js` installation documented in README

---

## Post-release

- [ ] Known limitations documented in [capabilities-and-roadmap.md](capabilities-and-roadmap.md)
- [ ] No keys or tokens in packaged artifact
