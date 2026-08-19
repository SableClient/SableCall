/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeepFilterNoiseFilterProcessor } from "deepfilternet3-noise-filter";

import {
  DeepFilterNetProcessor,
  DEEPFILTERNET_PROCESSOR_NAME,
  supportsDeepFilterNetProcessor,
} from "./DeepFilterNetProcessor";

type DeepFilterNoiseFilterProcessorOptions = Record<string, unknown>;

type DeepFilterNoiseFilterProcessorContext = {
  setEnabled?: unknown;
  setSuppressionLevel?: unknown;
  destroy?: unknown;
  init?: unknown;
  restart?: unknown;
  processedTrack?: MediaStreamTrack;
};

type NoiseFilterProcessorMock = ReturnType<typeof vi.fn> & {
  mockSetEnabled: ReturnType<typeof vi.fn>;
  mockSetSuppressionLevel: ReturnType<typeof vi.fn>;
  mockDestroy: ReturnType<typeof vi.fn>;
  mockInit: ReturnType<typeof vi.fn>;
  mockRestart: ReturnType<typeof vi.fn>;
};

vi.mock("deepfilternet3-noise-filter", () => {
  const mockSetEnabled = vi.fn().mockResolvedValue(true);
  const mockSetSuppressionLevel = vi.fn();
  const mockDestroy = vi.fn().mockResolvedValue(undefined);
  const mockInit = vi.fn().mockResolvedValue(undefined);
  const mockRestart = vi.fn().mockResolvedValue(undefined);

  const mockDeepFilterNoiseFilterProcessor = vi
    .fn()
    .mockImplementation(function DeepFilterNoiseFilterProcessor(
      this: DeepFilterNoiseFilterProcessorContext,
      options: DeepFilterNoiseFilterProcessorOptions,
    ): void {
      Object.assign(this, options);
      this.setEnabled = mockSetEnabled;
      this.setSuppressionLevel = mockSetSuppressionLevel;
      this.destroy = mockDestroy;
      this.init = mockInit;
      this.restart = mockRestart;
      this.processedTrack = {} as MediaStreamTrack;
    });

  Object.assign(mockDeepFilterNoiseFilterProcessor, {
    mockSetEnabled,
    mockSetSuppressionLevel,
    mockDestroy,
    mockInit,
    mockRestart,
  });

  return {
    __esModule: true,
    DeepFilterNoiseFilterProcessor: mockDeepFilterNoiseFilterProcessor,
  };
});

const mockDeepFilterNoiseFilterProcessor =
  DeepFilterNoiseFilterProcessor as unknown as NoiseFilterProcessorMock;

const mockTrack = { kind: "audio" } as MediaStreamTrack;

describe("DeepFilterNetProcessor", () => {
  beforeEach((): void => {
    mockDeepFilterNoiseFilterProcessor.mockSetEnabled.mockClear();
    mockDeepFilterNoiseFilterProcessor.mockSetSuppressionLevel.mockClear();
    mockDeepFilterNoiseFilterProcessor.mockDestroy.mockClear();
    mockDeepFilterNoiseFilterProcessor.mockInit.mockClear();
    mockDeepFilterNoiseFilterProcessor.mockRestart.mockClear();
    mockDeepFilterNoiseFilterProcessor.mockClear();
  });

  it("has the expected processor name", (): void => {
    const processor = new DeepFilterNetProcessor();
    expect(processor.name).toBe(DEEPFILTERNET_PROCESSOR_NAME);
  });

  it("initializes the underlying processor with the expected configuration", async (): Promise<void> => {
    const processor = new DeepFilterNetProcessor(0.5, false);

    await processor.init({ track: mockTrack } as never);

    expect(mockDeepFilterNoiseFilterProcessor).toHaveBeenCalledTimes(1);
    expect(mockDeepFilterNoiseFilterProcessor).toHaveBeenCalledWith(
      expect.objectContaining({
        sampleRate: 48000,
        noiseReductionLevel: 50,
        enabled: false,
        assetConfig: expect.objectContaining({
          cdnUrl: expect.any(String),
        }),
      }),
    );
    expect(mockDeepFilterNoiseFilterProcessor.mockInit).toHaveBeenCalledWith({
      track: mockTrack,
    });
    expect(processor.processedTrack).toBeDefined();
  });

  it("clamps the noise reduction level to the 0-1 range", async (): Promise<void> => {
    const processor = new DeepFilterNetProcessor(1.5, true);
    await processor.init({ track: mockTrack } as never);

    expect(mockDeepFilterNoiseFilterProcessor).toHaveBeenCalledWith(
      expect.objectContaining({ noiseReductionLevel: 100 }),
    );
  });

  it("forwards suppression level changes and clamps out-of-range values", async (): Promise<void> => {
    const processor = new DeepFilterNetProcessor(0.2, true);
    await processor.init({ track: mockTrack } as never);

    processor.setSuppressionLevel(1.5);
    processor.setSuppressionLevel(-0.2);

    expect(
      mockDeepFilterNoiseFilterProcessor.mockSetSuppressionLevel,
    ).toHaveBeenNthCalledWith(1, 100);
    expect(
      mockDeepFilterNoiseFilterProcessor.mockSetSuppressionLevel,
    ).toHaveBeenNthCalledWith(2, 0);
  });

  it("forwards enabled state changes to the underlying processor", async (): Promise<void> => {
    const processor = new DeepFilterNetProcessor(0.4, true);
    await processor.init({ track: mockTrack } as never);

    await processor.setEnabled(false);
    await processor.setEnabled(true);

    expect(
      mockDeepFilterNoiseFilterProcessor.mockSetEnabled,
    ).toHaveBeenNthCalledWith(1, false);
    expect(
      mockDeepFilterNoiseFilterProcessor.mockSetEnabled,
    ).toHaveBeenNthCalledWith(2, true);
  });

  it("destroys the processor and resets internal state", async (): Promise<void> => {
    const processor = new DeepFilterNetProcessor(0.6, true);
    await processor.init({ track: mockTrack } as never);

    await processor.destroy();

    expect(
      mockDeepFilterNoiseFilterProcessor.mockDestroy,
    ).toHaveBeenCalledTimes(1);
    expect(processor.processedTrack).toBeUndefined();
  });

  it("reports support based on the runtime APIs", (): void => {
    // In the jsdom test environment AudioContext/WebAssembly may be present.
    expect(typeof supportsDeepFilterNetProcessor()).toBe("boolean");
  });
});
