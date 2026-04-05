# Provider Triage Runbook

This runbook is for the smoke-matrix and issue-hygiene lane of provider triage.
It is intentionally documentation-first: do not widen the supported provider set from this file.
Use it after the registration-contract owner declares which providers are intentionally supported for the current pass.

## Supported-provider boundary

Before filling the matrix, copy the current boundary decision from code review / leader guidance.
Use one of these values per provider:

- `supported-now` — expected to work in the current release candidate
- `deferred` — intentionally not part of the current supported set
- `blocked` — intended to be supported, but a known bug still prevents release

## Smoke matrix template

| Provider | Boundary | Registration expected? | Test-vault model key | Static/unit evidence | Runtime command | Runtime result | Issue link | Evidence/artifact | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| transformers |  |  | TaylorAI/bge-micro-v2 |  | `pnpm run verify:test-vault` | pass / blocked / fail |  |  |  |
| openai |  |  | text-embedding-3-small |  | `bash scripts/check-provider-runtime.sh openai text-embedding-3-small 1536` | pass / blocked / fail |  |  |  |
| ollama |  |  | bge-m3 |  | `bash scripts/check-provider-runtime.sh ollama bge-m3` | pass / blocked / fail |  |  |  |
| gemini |  |  | gemini-embedding-001 |  | `bash scripts/check-provider-runtime.sh gemini gemini-embedding-001 768` | pass / blocked / fail | #62 |  |  |
| lm_studio |  |  | text-embedding-nomic-embed-text-v1.5 |  | `bash scripts/check-provider-runtime.sh lm_studio text-embedding-nomic-embed-text-v1.5` | pass / blocked / fail |  |  |  |
| upstage |  |  | embedding-passage |  | `bash scripts/check-provider-runtime.sh upstage embedding-passage 4096` + `bash scripts/check-upstage.sh` | pass / blocked / fail | #53 |  |  |
| open_router |  |  | text-embedding-3-small |  | `bash scripts/check-provider-runtime.sh open_router text-embedding-3-small 1536` | pass / blocked / fail | #63? only if scope expands later |  |  |

## Result-recording rules

- `Runtime result = pass` only if the provider loads in the Test vault, `embed_ready` is true, and dev errors / error-level console output stay empty for the bounded probe.
- `blocked` means the provider is intended to work, but verification is blocked by missing credentials, an unresolved shared-file change, or a confirmed defect.
- `fail` means the probe ran and produced a reproducible defect.
- For providers outside the current boundary, keep `Boundary=deferred` and leave `Runtime result` blank or `not-run`.

## Recommended command order

1. `pnpm run verify:test-vault`
2. `bash scripts/check-provider-runtime.sh <adapter> <model_key> [dims]`
3. For Upstage only: `bash scripts/check-upstage.sh`
4. Save the resulting log path from `artifacts/` in the matrix.

## Issue-hygiene comment drafts

### Issue #62 — Gemini close comment (only after fix + retest)

```md
Fixed on latest triage branch and retested in the Test vault.

What changed:
- Gemini model selection/validation now uses a supported model path instead of failing during adapter initialization.

Verification:
- Unit/static checks: <list commands>
- Test vault: `bash scripts/check-provider-runtime.sh gemini gemini-embedding-001 768`
- Result: <pass summary + artifact/log path>

If you update to the build containing this fix and still hit a Gemini validation error, please reply with your exact model key and the error text.
```

### Issue #53 — Upstage update or close comment

```md
Rechecked Upstage on latest code in the Test vault.

Verification:
- Bounded runtime smoke: `bash scripts/check-provider-runtime.sh upstage embedding-passage 4096`
- Longer embedding probe: `bash scripts/check-upstage.sh`
- Result: <pass/fail summary + artifact/log path>

Outcome:
- <close if freeze is no longer reproducible, or keep open with the residual blocker>
```

### Generic blocked-status update

```md
Status update from provider triage:

- Reproduced / attempted on latest code: <yes/no>
- Current blocker: <missing credential / shared registration change pending / runtime defect>
- Next planned step: <specific next action>
- Evidence gathered: <command + artifact/log path>
```

## Notes

- `scripts/check-adapter-registry.sh` is now only a compatibility alias for the current Upstage runtime smoke probe; do not use it as evidence for the full supported-provider boundary.
- Do not close external issues until the smoke matrix row is complete and links to concrete runtime evidence.
