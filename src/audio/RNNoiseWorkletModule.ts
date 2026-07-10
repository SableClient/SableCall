/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import createRNNWasmModuleSync from "@jitsi/rnnoise-wasm/dist/rnnoise-sync.js";

import type { RNNoiseSuppressionPreset } from "./rnnoiseTypes";
import {
  GATE_CLOSE_MS,
  GATE_HOLD_FRAMES,
  GATE_HYSTERESIS_DB,
  GATE_OPEN_MS,
  LEVEL_REPORT_FRAMES,
  MIC_CUTOFF_DEFAULT_DB,
} from "./microphoneGate";

declare abstract class AudioWorkletProcessor {
  protected constructor(options?: AudioWorkletNodeOptions);
  public readonly port: MessagePort;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (
    options?: AudioWorkletNodeOptions,
  ) => AudioWorkletProcessor,
): void;

const FRAME_SIZE = 480;
const RING_SIZE = FRAME_SIZE * 3;
const SAMPLE_RATE = 48000;
const RNNOISE_WORKLET_NAME = "rnnoise-processor";
const DEFAULT_PRESET: RNNoiseSuppressionPreset = "conservative";

type PresetConfig = {
  maxAttenuationDb: number;
  openThreshold: number;
  closeThreshold: number;
  holdFrames: number;
  attenuateMs: number;
  releaseMs: number;
};

type RNNoiseModule = {
  HEAPF32: Float32Array;
  [key: string]: unknown;
};

type WorkletMessage =
  | { type: "destroy" }
  | { type: "preset"; preset: RNNoiseSuppressionPreset }
  | { type: "denoise"; enabled: boolean }
  | { type: "gate"; enabled: boolean; thresholdDb: number };

const PRESETS: Record<RNNoiseSuppressionPreset, PresetConfig> = {
  conservative: {
    maxAttenuationDb: 4,
    openThreshold: 0.92,
    closeThreshold: 0.6,
    holdFrames: 12,
    attenuateMs: 120,
    releaseMs: 25,
  },
  balanced: {
    maxAttenuationDb: 8,
    openThreshold: 0.9,
    closeThreshold: 0.55,
    holdFrames: 10,
    attenuateMs: 90,
    releaseMs: 22,
  },
  strong: {
    maxAttenuationDb: 16,
    openThreshold: 0.9,
    closeThreshold: 0.55,
    holdFrames: 8,
    attenuateMs: 55,
    releaseMs: 18,
  },
};

function isPreset(preset: unknown): preset is RNNoiseSuppressionPreset {
  return typeof preset === "string" && preset in PRESETS;
}

class RNNoiseWorkletProcessor extends AudioWorkletProcessor {
  private ready = false;
  private destroyed = false;
  private readonly inBuf = new Float32Array(RING_SIZE);
  private readonly outBuf = new Float32Array(RING_SIZE);
  private readonly frameBuf = new Float32Array(FRAME_SIZE);
  private inW = 0;
  private inR = 0;
  private outW = 0;
  private outR = 0;
  private currentGain = 1;
  private targetGain = 1;
  private holdFrames = 0;
  private denoiseEnabled = true;
  private gateEnabled = false;
  private gateOpenThresholdDb = MIC_CUTOFF_DEFAULT_DB;
  private gateCloseThresholdDb = MIC_CUTOFF_DEFAULT_DB - GATE_HYSTERESIS_DB;
  private gateHoldFrames = 0;
  private gateCurrentGain = 1;
  private gateTargetGain = 1;
  private gateOpenStep = 1;
  private gateCloseStep = 1;
  private levelReportCounter = 0;
  private levelReportMaxRms = 0;
  private maxAttenuationDb = PRESETS[DEFAULT_PRESET].maxAttenuationDb;
  private openThreshold = PRESETS[DEFAULT_PRESET].openThreshold;
  private closeThreshold = PRESETS[DEFAULT_PRESET].closeThreshold;
  private holdFramesConfig = PRESETS[DEFAULT_PRESET].holdFrames;
  private attenuateStep = 1;
  private releaseStep = 1;
  private module?: RNNoiseModule;
  private pcmBuf?: number;
  private state: number | null = null;
  private heapF32?: Float32Array;

  public constructor() {
    super();

    this.setPreset(DEFAULT_PRESET);
    this.gateOpenStep = this.smoothingStepFromMs(GATE_OPEN_MS);
    this.gateCloseStep = this.smoothingStepFromMs(GATE_CLOSE_MS);
    this.initRNNoise();

    this.port.onmessage = (event: MessageEvent<WorkletMessage>): void => {
      if (event.data.type === "destroy") {
        this.cleanup();
      } else if (event.data.type === "preset" && isPreset(event.data.preset)) {
        this.setPreset(event.data.preset);
      } else if (event.data.type === "denoise") {
        this.setDenoiseEnabled(event.data.enabled === true);
      } else if (event.data.type === "gate") {
        this.setGateConfig(event.data.enabled, event.data.thresholdDb);
      }
    };
  }

  private smoothingStepFromMs(ms: number): number {
    if (ms <= 0) return 1;
    const tau = ms / 1000;
    return 1 - Math.exp(-1 / (SAMPLE_RATE * tau));
  }

  private setPreset(preset: RNNoiseSuppressionPreset): void {
    if (!isPreset(preset)) return;

    const config = PRESETS[preset];
    this.maxAttenuationDb = config.maxAttenuationDb;
    this.openThreshold = config.openThreshold;
    this.closeThreshold = config.closeThreshold;
    this.holdFramesConfig = config.holdFrames;
    this.attenuateStep = this.smoothingStepFromMs(config.attenuateMs);
    this.releaseStep = this.smoothingStepFromMs(config.releaseMs);
  }

  private setDenoiseEnabled(enabled: boolean): void {
    this.denoiseEnabled = enabled;
    if (!enabled) {
      // Release any RNNoise attenuation so the stage becomes transparent.
      this.targetGain = 1;
      this.holdFrames = 0;
    }
  }

  private setGateConfig(enabled: unknown, thresholdDb: unknown): void {
    this.gateEnabled = enabled === true;
    if (typeof thresholdDb === "number" && Number.isFinite(thresholdDb)) {
      this.gateOpenThresholdDb = thresholdDb;
      this.gateCloseThresholdDb = thresholdDb - GATE_HYSTERESIS_DB;
    }
    if (!this.gateEnabled) {
      this.gateTargetGain = 1;
      this.gateCurrentGain = 1;
      this.gateHoldFrames = 0;
    }
  }

  private reportLevel(frameRms: number): void {
    if (frameRms > this.levelReportMaxRms) {
      this.levelReportMaxRms = frameRms;
    }
    this.levelReportCounter += 1;
    if (this.levelReportCounter < LEVEL_REPORT_FRAMES) return;

    const rmsDb =
      this.levelReportMaxRms > 0
        ? 20 * Math.log10(this.levelReportMaxRms)
        : -200;
    this.port.postMessage({ type: "level", rmsDb });
    this.levelReportCounter = 0;
    this.levelReportMaxRms = 0;
  }

  private updateGateGain(frameRms: number): void {
    if (!this.gateEnabled) {
      this.gateTargetGain = 1;
      return;
    }

    const rmsDb = frameRms > 0 ? 20 * Math.log10(frameRms) : -200;
    if (rmsDb >= this.gateOpenThresholdDb) {
      this.gateHoldFrames = GATE_HOLD_FRAMES;
      this.gateTargetGain = 1;
    } else if (this.gateHoldFrames > 0) {
      this.gateHoldFrames -= 1;
    } else if (rmsDb < this.gateCloseThresholdDb) {
      this.gateTargetGain = 0;
    }
    // Between the close and open thresholds the gate keeps its previous
    // state (hysteresis).
  }

  private updateTargetGain(vadProbability: number): void {
    if (vadProbability >= this.openThreshold) {
      this.holdFrames = this.holdFramesConfig;
      this.targetGain = 1;
      return;
    }

    if (this.holdFrames > 0) {
      this.holdFrames -= 1;
      this.targetGain = 1;
      return;
    }

    const thresholdRange = this.openThreshold - this.closeThreshold;
    const attenuationProgress =
      thresholdRange > 0
        ? Math.max(
            0,
            Math.min(1, (this.openThreshold - vadProbability) / thresholdRange),
          )
        : 1;

    const attenuationDb = attenuationProgress * this.maxAttenuationDb;
    this.targetGain = Math.pow(10, -attenuationDb / 20);
  }

  private ringAvailable(w: number, r: number): number {
    let available = w - r;
    if (available < 0) available += RING_SIZE;
    return available;
  }

  private initRNNoise(): void {
    try {
      const module = createRNNWasmModuleSync() as unknown as RNNoiseModule;
      const malloc = module["_malloc"] as (size: number) => number;
      const rnnoiseInit = module["_rnnoise_init"] as () => void;
      const rnnoiseCreate = module["_rnnoise_create"] as () => number;
      const pcmBuf = malloc(FRAME_SIZE * 4);
      rnnoiseInit();
      const state = rnnoiseCreate();

      this.module = module;
      this.pcmBuf = pcmBuf;
      this.state = state;
      this.heapF32 = module.HEAPF32;
      this.ready = true;
    } catch (error) {
      this.port.postMessage({ type: "error", message: String(error) });
    }
  }

  private cleanup(): void {
    if (this.module && this.state !== null && this.pcmBuf !== undefined) {
      const rnnoiseDestroy = this.module["_rnnoise_destroy"] as (
        state: number,
      ) => void;
      const free = this.module["_free"] as (ptr: number) => void;
      rnnoiseDestroy(this.state);
      free(this.pcmBuf);
      this.state = null;
    }
    this.destroyed = true;
  }

  private processFrame(): void {
    const { module, state, pcmBuf, heapF32 } = this;
    const useDenoise =
      this.denoiseEnabled &&
      this.ready &&
      module !== undefined &&
      state !== null &&
      pcmBuf !== undefined &&
      heapF32 !== undefined;

    let sumSquares = 0;

    if (useDenoise) {
      const heapIdx = pcmBuf >> 2;

      for (let i = 0; i < FRAME_SIZE; i++) {
        heapF32[heapIdx + i] = this.inBuf[(this.inR + i) % RING_SIZE] * 32768;
      }

      const rnnoiseProcessFrame = module["_rnnoise_process_frame"] as (
        state: number,
        input: number,
        output: number,
      ) => number;
      const vadProbability = rnnoiseProcessFrame(state, pcmBuf, pcmBuf);
      this.updateTargetGain(vadProbability);

      for (let i = 0; i < FRAME_SIZE; i++) {
        const sample = heapF32[heapIdx + i] / 32768;
        this.frameBuf[i] = sample;
        sumSquares += sample * sample;
      }
    } else {
      for (let i = 0; i < FRAME_SIZE; i++) {
        const sample = this.inBuf[(this.inR + i) % RING_SIZE];
        this.frameBuf[i] = sample;
        sumSquares += sample * sample;
      }
    }
    this.inR = (this.inR + FRAME_SIZE) % RING_SIZE;

    const frameRms = Math.sqrt(sumSquares / FRAME_SIZE);
    this.updateGateGain(frameRms);
    this.reportLevel(frameRms);

    for (let i = 0; i < FRAME_SIZE; i++) {
      const smoothingStep =
        this.targetGain < this.currentGain
          ? this.attenuateStep
          : this.releaseStep;
      this.currentGain += (this.targetGain - this.currentGain) * smoothingStep;
      const gateStep =
        this.gateTargetGain < this.gateCurrentGain
          ? this.gateCloseStep
          : this.gateOpenStep;
      this.gateCurrentGain +=
        (this.gateTargetGain - this.gateCurrentGain) * gateStep;
      this.outBuf[(this.outW + i) % RING_SIZE] =
        this.frameBuf[i] * this.currentGain * this.gateCurrentGain;
    }
    this.outW = (this.outW + FRAME_SIZE) % RING_SIZE;
  }

  private mixInputChannels(
    inputChannels: Float32Array[],
    sampleIndex: number,
    channelCount: number,
  ): number {
    let mixed = 0;
    for (let i = 0; i < channelCount; i++) {
      const channel = inputChannels[i];
      mixed += channel ? (channel[sampleIndex] ?? 0) : 0;
    }
    return mixed / channelCount;
  }

  public process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.destroyed) return false;

    const inputChannels = inputs[0];
    const output = outputs[0]?.[0];

    if (!inputChannels?.length || !output) return true;

    const blockSize = output.length;
    const channelCount = inputChannels.length;

    const framePathActive =
      (this.denoiseEnabled && this.ready) || this.gateEnabled;
    if (!framePathActive) {
      for (let i = 0; i < blockSize; i++) {
        output[i] = this.mixInputChannels(inputChannels, i, channelCount);
      }
      return true;
    }

    for (let i = 0; i < blockSize; i++) {
      this.inBuf[this.inW] = this.mixInputChannels(
        inputChannels,
        i,
        channelCount,
      );
      this.inW = (this.inW + 1) % RING_SIZE;
    }

    while (this.ringAvailable(this.inW, this.inR) >= FRAME_SIZE) {
      this.processFrame();
    }

    const outAvailable = this.ringAvailable(this.outW, this.outR);
    const toRead = Math.min(blockSize, outAvailable);

    for (let i = 0; i < toRead; i++) {
      output[i] = this.outBuf[this.outR];
      this.outR = (this.outR + 1) % RING_SIZE;
    }
    for (let i = toRead; i < blockSize; i++) {
      output[i] = 0;
    }

    return true;
  }
}

registerProcessor(RNNOISE_WORKLET_NAME, RNNoiseWorkletProcessor);
