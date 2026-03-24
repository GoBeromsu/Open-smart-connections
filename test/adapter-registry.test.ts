/**
 * @file adapter-registry.test.ts
 * @description Focused tests for registry-backed adapter creation.
 */

import { describe, expect, it } from 'vitest';
import { embedAdapterRegistry } from '../src/domain/embed-model';
import { TRANSFORMERS_EMBED_MODELS } from '../src/ui/embed-adapters/transformers';
import { OPENAI_EMBED_MODELS } from '../src/ui/embed-adapters/openai';
import '../src/ui/embed-adapters/ollama';
import { GEMINI_EMBED_MODELS } from '../src/ui/embed-adapters/gemini';
import '../src/ui/embed-adapters/lm-studio';
import { UPSTAGE_EMBED_MODELS } from '../src/ui/embed-adapters/upstage';
import '../src/ui/embed-adapters/open-router';

describe('EmbedAdapterRegistry', () => {
  const EXPECTED_ADAPTERS = [
    'transformers',
    'openai',
    'ollama',
    'gemini',
    'lm_studio',
    'upstage',
    'open_router',
  ];

  it('registers the supported adapters', () => {
    expect(embedAdapterRegistry.getAdapterNames().sort()).toEqual(EXPECTED_ADAPTERS.sort());
  });

  it('returns undefined for unknown adapters', () => {
    expect(embedAdapterRegistry.get('nonexistent')).toBeUndefined();
  });

  it('creates static-model adapters with registry-defined dimensions', () => {
    const cases = [
      { adapterType: 'openai', modelKey: 'text-embedding-3-small', settings: { api_key: 'test-key' }, dims: 1536 },
      { adapterType: 'upstage', modelKey: 'embedding-passage', settings: { api_key: 'test-key' }, dims: 4096 },
      { adapterType: 'gemini', modelKey: 'gemini-embedding-001', settings: { api_key: 'test-key' }, dims: 768 },
    ];

    for (const testCase of cases) {
      const { adapter } = embedAdapterRegistry.createAdapter(
        testCase.adapterType,
        testCase.modelKey,
        testCase.settings,
      );
      expect(adapter.model_key).toBe(testCase.modelKey);
      expect(adapter.dims).toBe(testCase.dims);
    }
  });

  it('creates dynamic-model adapters using caller-provided dimensions', () => {
    const { adapter } = embedAdapterRegistry.createAdapter(
      'ollama',
      'bge-m3',
      { host: 'http://localhost:11434', dims: 1024 },
    );

    expect(adapter.model_key).toBe('bge-m3');
    expect(adapter.dims).toBe(1024);
  });

  it('exposes registration metadata needed by factory and settings flows', () => {
    const hostAdapters = ['ollama', 'lm_studio'];
    const apiAdapters = ['openai', 'gemini', 'upstage', 'open_router'];

    for (const name of hostAdapters) {
      const reg = embedAdapterRegistry.get(name);
      expect(reg?.requiresHost).toBe(true);
      expect(reg?.defaultHost).toBeTruthy();
      expect(reg?.dynamicModels).toBe(true);
    }

    for (const name of apiAdapters) {
      const reg = embedAdapterRegistry.get(name);
      expect(reg?.requiresApiKey).toBe(true);
      expect(reg?.signupUrl).toMatch(/^https?:\/\//);
    }
  });

  it('throws for unknown adapter types', () => {
    expect(() => embedAdapterRegistry.createAdapter('nonexistent', 'model', {})).toThrow(
      /Unknown embed adapter/,
    );
  });

  it('throws for unknown static models', () => {
    expect(() => embedAdapterRegistry.createAdapter('openai', 'fake-model', {})).toThrow(
      /Unknown OpenAI model/,
    );
  });

  it('reports when an adapter requires an explicit load step', () => {
    const { requiresLoad } = embedAdapterRegistry.createAdapter(
      'transformers',
      'TaylorAI/bge-micro-v2',
      {},
    );

    expect(requiresLoad).toBe(true);
  });

  it('returns labeled picker options for static-model adapters', () => {
    const options = embedAdapterRegistry.getModelPickerOptions('openai');

    expect(options.some((option) => option.value === 'text-embedding-3-small')).toBe(true);
    expect(options.every((option) => /\(\d+d\)$/.test(option.name))).toBe(true);
  });

  it('returns no picker options for dynamic or unknown adapters', () => {
    expect(embedAdapterRegistry.getModelPickerOptions('ollama')).toEqual([]);
    expect(embedAdapterRegistry.getModelPickerOptions('nonexistent')).toEqual([]);
  });

  // ── AC6: model catalog validation ──────────────────────────────────────────

  it('all static model entries have positive dims, max_tokens, and batch_size', () => {
    const staticCatalogs: Record<string, typeof OPENAI_EMBED_MODELS> = {
      openai: OPENAI_EMBED_MODELS,
      upstage: UPSTAGE_EMBED_MODELS,
      gemini: GEMINI_EMBED_MODELS,
      transformers: TRANSFORMERS_EMBED_MODELS,
    };

    for (const [adapterName, catalog] of Object.entries(staticCatalogs)) {
      for (const [modelKey, info] of Object.entries(catalog)) {
        expect(info.dims, `${adapterName}/${modelKey} dims`).toBeGreaterThan(0);
        expect(info.max_tokens, `${adapterName}/${modelKey} max_tokens`).toBeGreaterThan(0);
        expect(info.batch_size, `${adapterName}/${modelKey} batch_size`).toBeGreaterThan(0);
      }
    }
  });

  it('static model catalog spans dimension range 256–4096', () => {
    const allModels = [
      ...Object.values(OPENAI_EMBED_MODELS),
      ...Object.values(UPSTAGE_EMBED_MODELS),
      ...Object.values(GEMINI_EMBED_MODELS),
      ...Object.values(TRANSFORMERS_EMBED_MODELS),
    ];

    const dims = allModels
      .map((m) => m.dims)
      .filter((d): d is number => typeof d === 'number' && d > 0);

    // Must cover both extremes of the OOM-risk spectrum
    expect(Math.min(...dims)).toBeLessThanOrEqual(256);
    expect(Math.max(...dims)).toBeGreaterThanOrEqual(4096);

    // Key checkpoints: 256d (min), 384d (local default), 4096d (Upstage Solar / OOM trigger)
    for (const expected of [256, 384, 4096]) {
      expect(dims, `No static model found with ${expected} dimensions`).toContain(expected);
    }
  });
});
