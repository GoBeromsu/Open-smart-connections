# Open Connections 3.9.29 Refactor Carry-Forward Ledger

This branch starts from tag `3.9.29` on purpose. The items below are intentionally
not part of the trusted baseline and must be reintroduced deliberately after the
modular refactor foundation is stable.

## Deferred Bundles

### Large-vault freeze prevention (`3.9.30`)
- Reintroduce chunked yielding for large O(n) loops.
- Reintroduce reduced discovery chunk sizing.
- Reintroduce file-watcher guards that avoid unnecessary work.
- Port the related verification back into this branch's test suite.

Primary files:
- `src/ui/collection-loader.ts`
- `src/ui/file-watcher.ts`
- `src/ui/ConnectionsView.ts`
- `src/utils/index.ts` or successor utility modules
- `src/domain/entities/node-sqlite-data-adapter.ts`

Primary tests:
- `test/domain/chunked-processing.test.ts`
- `test/ui/collection-loader-yield.test.ts`
- `test/ui/file-watcher-source-guard.test.ts`
- `test/ui/block-connections-yield.test.ts`

### `should_embed`
- Reapply as a domain/entity change after the refactor foundation is green.
- Implement the planned complexity-safe design instead of a naive repeated full scan.

Primary files:
- `src/domain/entities/EmbeddingBlock.ts`
- supporting entity or collection helpers as needed

Primary tests:
- `test/should-embed.test.ts`

### `TokenizerProvider`
- Reapply as a full bundle after `should_embed` is stable.
- Reintroduce provider, model type additions, adapter integration, and tests together.

Primary files:
- `src/domain/tokenizer-provider.ts`
- `src/types/models.ts`
- `src/ui/embed-adapters/api-base.ts`
- provider-specific adapter files

Primary tests:
- `test/tokenizer-provider.test.ts`
- `test/upstage-adapter.test.ts`

## Scope Notes
- `src/shared/` is excluded from this first pass and will be handled upstream in `obsidian-boiler-template`.
- This ledger must remain accurate until every deferred bundle is either implemented on this branch or explicitly superseded.
