<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/types

## Purpose

Pure type definitions for open-connections. Defines all domain models, settings shapes, Obsidian type shims, and custom workspace event augmentations. No `obsidian` imports — only type-level declarations and module augmentation.

## Key Files

| File | Description |
|------|-------------|
| `entities.ts` | EmbeddingEntity, EmbeddingSource, EmbeddingBlock, EntityCollection (type definitions only) |
| `models.ts` | EmbedModel, EmbedAdapterRegistry, provider-specific models (Transformers, OpenAI, Gemini, etc.) |
| `settings.ts` | PluginSettings shape, EmbedAdapterSettings, provider configurations |
| `obsidian-shims.ts` | Minimal Obsidian type interfaces (FileRef, NoteMetadata) used by domain/utils code without full obsidian import |
| `obsidian-augments.d.ts` | Module augmentation for custom workspace events (open-connections:embed-progress, etc.) — eliminates as-any casts |

## Subdirectories

None — flat file structure.

## For AI Agents

### Working In This Directory

- **NO `obsidian` imports** — enforced by ESLint `no-restricted-imports`
- Only type definitions, interfaces, and declaration modules
- `obsidian-shims.ts` defines minimal interfaces that satisfy structural typing — domain code uses these instead of real Obsidian types
- `obsidian-augments.d.ts` uses `declare module 'obsidian'` to augment the Obsidian workspace interface with custom events
- No runtime code — pure types only

### Key Pattern: Module Augmentation

```typescript
// obsidian-augments.d.ts uses declare module to add custom events
declare module 'obsidian' {
  interface Workspace {
    on(name: 'open-connections:embed-progress', callback: (payload: unknown) => void, ctx?: unknown): EventRef;
    trigger(name: 'open-connections:embed-progress', payload: unknown): void;
  }
}

// Now ui/ code can use these without as-any casts
plugin.app.workspace.trigger('open-connections:embed-progress', payload);
```

### Key Pattern: Obsidian Type Shims

```typescript
// obsidian-shims.ts defines minimal interfaces
export interface FileRef {
  path: string;
}

export interface NoteMetadata {
  frontmatter?: Record<string, unknown>;
  headings?: HeadingRef[];
}

// domain/ code uses these interfaces
// main.ts (composition root) passes real TFile objects which satisfy FileRef structurally
```

## Dependencies

None — pure type layer with no external dependencies except Obsidian type stubs (declaration only)
