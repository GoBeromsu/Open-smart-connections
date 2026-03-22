/**
 * @file adapter-registry.test.ts
 * @description Focused tests for registry-backed adapter creation.
 */

import { describe, expect, it } from 'vitest';
import { embedAdapterRegistry } from '../src/domain/embed-model';
import '../src/ui/embed-adapters/transformers';
import '../src/ui/embed-adapters/openai';
import '../src/ui/embed-adapters/ollama';
import '../src/ui/embed-adapters/gemini';
import '../src/ui/embed-adapters/lm-studio';
import '../src/ui/embed-adapters/upstage';
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
});
