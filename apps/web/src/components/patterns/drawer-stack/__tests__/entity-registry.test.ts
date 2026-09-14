import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureEntityRendererLoader, loadEntityRenderers } from '../entity-registry';

describe('drawer entity registry loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps renderer modules lazy and deduplicates concurrent loads', async () => {
    const loader = vi.fn().mockResolvedValue(undefined);

    configureEntityRendererLoader(loader);
    const first = loadEntityRenderers();
    const second = loadEntityRenderers();

    expect(first).toBe(second);
    await first;
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('retries a failed generation without clearing a newer loader generation', async () => {
    let rejectOld!: (reason: unknown) => void;
    const oldLoader = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOld = reject;
        })
    );
    const newLoader = vi.fn().mockResolvedValue(undefined);

    configureEntityRendererLoader(oldLoader);
    const oldGeneration = loadEntityRenderers();
    await Promise.resolve();
    configureEntityRendererLoader(newLoader);
    const newGeneration = loadEntityRenderers();

    rejectOld(new Error('old generation failed'));
    await expect(oldGeneration).rejects.toThrow('old generation failed');
    await newGeneration;
    await loadEntityRenderers();

    expect(oldLoader).toHaveBeenCalledTimes(1);
    expect(newLoader).toHaveBeenCalledTimes(1);
  });
});
