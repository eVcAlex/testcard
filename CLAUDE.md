## Agent skills

### Issue tracker

Issues are tracked as GitHub Issues on `eVcAlex/testcard`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Model routing

Main session runs on Sonnet with an Opus advisor. Consult the advisor before locking a plan, after the same error twice, and before calling a task done. Delegate repo mapping to `search`, call-site lookups to `grep`, and API reference lookups to `docs` (Haiku, read-only).
