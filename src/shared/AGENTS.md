<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/shared

## Purpose

Boiler-template synced files — deterministic code every plugin needs. These files are synchronized from `obsidian-boiler-template` and **must not be edited directly** in this repository. If changes are needed, they must be made in the boiler template first, then propagated.

## Key Files

| File | Description |
|------|-------------|
| `plugin-logger.ts` | Leveled logging (debug, info, warn, error) with console output and optional notice display |
| `plugin-notices.ts` | Typed notice system with catalogs, muting, and action buttons |
| `settings-migration.ts` | Settings version/migration framework — handles evolving plugin settings |
| `debounce-controller.ts` | Rate-limit event handlers with configurable delay and trailing calls |
| `styles.base.css` | Base CSS for plugin notices and UI components |

## Subdirectories

None — flat file structure.

## For AI Agents

### Working In This Directory

- **DO NOT EDIT these files directly** — they are synced from `obsidian-boiler-template`
- Any improvements or bug fixes must be made in the boiler template first, then propagated via the sync engine
- These are deterministic, reusable patterns that every plugin needs — consistency across the ecosystem depends on no local divergence
- All files include a sync header comment at the top indicating their origin

### Testing

All shared code is tested in the boiler template. Changes are validated there before propagation.

## Dependencies

- `obsidian` — Obsidian Plugin API
- No internal plugin dependencies
