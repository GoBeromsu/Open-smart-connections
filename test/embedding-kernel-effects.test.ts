/**
 * @file embedding-kernel-effects.test.ts
 * @description Kernel effect helper tests
 */

import { describe, expect, it } from 'vitest';
import {
  buildKernelModel,
} from '../src/domain/embedding/kernel';

describe('kernel effects', () => {
  it('normalizes kernel model fingerprint', () => {
    const model = buildKernelModel('OpenAI', ' Text-Embedding-3-Small ', ' HTTP://LOCALHOST ', 1536);
    expect(model.adapter).toBe('openai');
    expect(model.modelKey).toBe('text-embedding-3-small');
    expect(model.host).toBe('http://localhost');
    expect(model.fingerprint).toBe('openai|text-embedding-3-small|http://localhost');
  });
});
