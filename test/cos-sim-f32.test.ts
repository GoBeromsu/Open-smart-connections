import { describe, it, expect } from 'vitest';
import { cos_sim, cos_sim_f32 } from '../src/utils';

describe('cos_sim_f32', () => {
  it('should match cos_sim for identical vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cos_sim_f32(a, b)).toBeCloseTo(cos_sim([1, 0, 0], [1, 0, 0]), 5);
  });

  it('should match cos_sim for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cos_sim_f32(a, b)).toBeCloseTo(cos_sim([1, 0, 0], [0, 1, 0]), 5);
  });

  it('should match cos_sim for opposite vectors', () => {
    const a = new Float32Array([-1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cos_sim_f32(a, b)).toBeCloseTo(cos_sim([-1, 0, 0], [1, 0, 0]), 5);
  });

  it('should match cos_sim for partial overlap', () => {
    const arr1 = [0.5, 0.3, 0.8, 0.1];
    const arr2 = [0.2, 0.9, 0.1, 0.6];
    const a = new Float32Array(arr1);
    const b = new Float32Array(arr2);
    expect(cos_sim_f32(a, b)).toBeCloseTo(cos_sim(arr1, arr2), 4);
  });

  it('should return 0 for zero vectors', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cos_sim_f32(a, b)).toBe(0);
  });

  it('should throw for different lengths', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(() => cos_sim_f32(a, b)).toThrow('Vectors must have the same length');
  });

  it('should handle 384-dim vectors (MiniLM-L6 size)', () => {
    const a = new Float32Array(384);
    const b = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      a[i] = Math.random() * 2 - 1;
      b[i] = Math.random() * 2 - 1;
    }
    const numA = Array.from(a);
    const numB = Array.from(b);
    expect(cos_sim_f32(a, b)).toBeCloseTo(cos_sim(numA, numB), 3);
  });
});
