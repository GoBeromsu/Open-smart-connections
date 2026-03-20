/**
 * @file adapter-registry.test.ts
 * @description Tests for EmbedAdapterRegistry and adapter self-registration
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Import the registry
import { embedAdapterRegistry } from '../src/domain/models/embed/registry';

// Import all adapters to trigger self-registration
import '../src/ui/models/embed/adapters/transformers';
import '../src/ui/models/embed/adapters/openai';
import '../src/ui/models/embed/adapters/ollama';
import '../src/ui/models/embed/adapters/gemini';
import '../src/ui/models/embed/adapters/lm_studio';
import '../src/ui/models/embed/adapters/upstage';
import '../src/ui/models/embed/adapters/open_router';

// Import model catalogs for verification
import { TRANSFORMERS_EMBED_MODELS } from '../src/ui/models/embed/adapters/transformers';
import { OPENAI_EMBED_MODELS } from '../src/ui/models/embed/adapters/openai';
import { GEMINI_EMBED_MODELS } from '../src/ui/models/embed/adapters/gemini';
import { UPSTAGE_EMBED_MODELS } from '../src/ui/models/embed/adapters/upstage';

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

  it('should have all 7 adapters registered', () => {
    const names = embedAdapterRegistry.getAdapterNames();
    for (const expected of EXPECTED_ADAPTERS) {
      expect(names).toContain(expected);
    }
    expect(names.length).toBeGreaterThanOrEqual(7);
  });

  it('should return undefined for unknown adapter', () => {
    expect(embedAdapterRegistry.get('nonexistent')).toBeUndefined();
  });

  describe.each(EXPECTED_ADAPTERS)('adapter: %s', (adapterName) => {
    it('should have a valid registration', () => {
      const reg = embedAdapterRegistry.get(adapterName);
      expect(reg).toBeDefined();
      expect(reg!.name).toBe(adapterName);
      expect(reg!.displayName).toBeTruthy();
      expect(reg!.AdapterClass).toBeDefined();
      expect(typeof reg!.defaultDims).toBe('number');
      expect(reg!.defaultDims).toBeGreaterThan(0);
    });

    it('should have signup URL or be a local adapter', () => {
      const reg = embedAdapterRegistry.get(adapterName)!;
      if (reg.requiresApiKey || reg.requiresHost) {
        expect(reg.signupUrl).toBeTruthy();
        expect(reg.signupUrl).toMatch(/^https?:\/\//);
      }
    });
  });

  describe('API adapters', () => {
    const API_ADAPTERS = ['openai', 'gemini', 'upstage', 'open_router'];

    it.each(API_ADAPTERS)('%s requires API key', (name) => {
      const reg = embedAdapterRegistry.get(name)!;
      expect(reg.requiresApiKey).toBe(true);
    });

    it.each(API_ADAPTERS)('%s has a signup URL', (name) => {
      const reg = embedAdapterRegistry.get(name)!;
      expect(reg.signupUrl).toMatch(/^https:\/\//);
    });
  });

  describe('Local adapters', () => {
    const LOCAL_ADAPTERS = ['ollama', 'lm_studio'];

    it.each(LOCAL_ADAPTERS)('%s requires host', (name) => {
      const reg = embedAdapterRegistry.get(name)!;
      expect(reg.requiresHost).toBe(true);
      expect(reg.defaultHost).toBeTruthy();
    });

    it.each(LOCAL_ADAPTERS)('%s has dynamic models', (name) => {
      const reg = embedAdapterRegistry.get(name)!;
      expect(reg.dynamicModels).toBe(true);
    });
  });

  describe('Transformers adapter', () => {
    it('should be local with no API key', () => {
      const reg = embedAdapterRegistry.get('transformers')!;
      expect(reg.requiresApiKey).toBe(false);
      expect(reg.requiresHost).toBe(false);
      expect(reg.requiresLoad).toBe(true);
    });

    it('should have a static model catalog', () => {
      const reg = embedAdapterRegistry.get('transformers')!;
      expect(Object.keys(reg.models).length).toBeGreaterThan(5);
    });
  });

  describe('createAdapter factory', () => {
    it('should create an OpenAI adapter', () => {
      const { adapter } = embedAdapterRegistry.createAdapter(
        'openai',
        'text-embedding-3-small',
        { api_key: 'test-key' },
      );
      expect(adapter).toBeDefined();
      expect(adapter.model_key).toBe('text-embedding-3-small');
      expect(adapter.dims).toBe(1536);
    });

    it('should create an Upstage adapter with legacy model key', () => {
      const { adapter } = embedAdapterRegistry.createAdapter(
        'upstage',
        'solar-embedding-1-large-passage',
        { api_key: 'test-key' },
      );
      expect(adapter).toBeDefined();
      expect(adapter.dims).toBe(4096);
    });

    it('should create a Gemini adapter', () => {
      const { adapter } = embedAdapterRegistry.createAdapter(
        'gemini',
        'gemini-embedding-001',
        { api_key: 'test-key' },
      );
      expect(adapter).toBeDefined();
      expect(adapter.dims).toBe(768);
    });

    it('should create dynamic-model adapters without model validation', () => {
      const { adapter } = embedAdapterRegistry.createAdapter(
        'ollama',
        'bge-m3',
        { host: 'http://localhost:11434', dims: 1024 },
      );
      expect(adapter).toBeDefined();
      expect(adapter.dims).toBe(1024);
    });

    it('should throw for unknown adapter type', () => {
      expect(() =>
        embedAdapterRegistry.createAdapter('nonexistent', 'model', {}),
      ).toThrow(/Unknown embed adapter/);
    });

    it('should throw for unknown static model', () => {
      expect(() =>
        embedAdapterRegistry.createAdapter('openai', 'fake-model', {}),
      ).toThrow(/Unknown OpenAI model/);
    });

    it('should flag transformers adapter as requiring load', () => {
      const { requiresLoad } = embedAdapterRegistry.createAdapter(
        'transformers',
        'TaylorAI/bge-micro-v2',
        {},
      );
      expect(requiresLoad).toBe(true);
    });
  });

  describe('model catalogs', () => {
    it('OpenAI models have signup URLs', () => {
      for (const model of Object.values(OPENAI_EMBED_MODELS)) {
        expect(model.signup_url).toMatch(/openai\.com/);
      }
    });

    it('Gemini models have signup URLs', () => {
      for (const model of Object.values(GEMINI_EMBED_MODELS)) {
        expect(model.signup_url).toMatch(/google\.com/);
      }
    });

    it('Upstage models have consistent dims', () => {
      for (const model of Object.values(UPSTAGE_EMBED_MODELS)) {
        expect(model.dims).toBe(4096);
      }
    });

    it('Transformers models are all local (no endpoint required)', () => {
      for (const model of Object.values(TRANSFORMERS_EMBED_MODELS)) {
        // Transformers models don't need an endpoint
        expect(model.dims).toBeGreaterThan(0);
      }
    });
  });

  describe('getModelPickerOptions', () => {
    it('should return options for OpenAI', () => {
      const opts = embedAdapterRegistry.getModelPickerOptions('openai');
      expect(opts.length).toBeGreaterThan(0);
      expect(opts[0].value).toBeTruthy();
      expect(opts[0].name).toContain('d)');
    });

    it('should return empty for dynamic-model adapters', () => {
      const opts = embedAdapterRegistry.getModelPickerOptions('ollama');
      expect(opts).toEqual([]);
    });

    it('should return empty for unknown adapter', () => {
      const opts = embedAdapterRegistry.getModelPickerOptions('nonexistent');
      expect(opts).toEqual([]);
    });
  });

  describe('getAll', () => {
    it('should return all registrations', () => {
      const all = embedAdapterRegistry.getAll();
      expect(all.length).toBeGreaterThanOrEqual(7);
      expect(all.every(r => r.name && r.displayName)).toBe(true);
    });
  });
});
