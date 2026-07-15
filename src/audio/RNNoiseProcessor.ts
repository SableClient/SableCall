/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/lib/logger";
import { BehaviorSubject } from "rxjs";

import type {
  AudioProcessorOptions,
  Track,
  TrackProcessor,
} from "livekit-client";
import type { RNNoiseSuppressionPreset } from "./rnnoiseTypes";
import type { Behavior } from "../state/Behavior";
import {
  GATE_CLOSE_MS,
  GATE_HOLD_FRAMES,
  GATE_HYSTERESIS_DB,
  GATE_OPEN_MS,
  LEVEL_REPORT_FRAMES,
  MIC_CUTOFF_DEFAULT_DB,
  type MicrophoneGateConfig,
} from "./microphoneGate";
import rnnoiseWorkletModuleUrl from "./RNNoiseWorkletModule.ts?worker&url";

/**
 * The number of samples per frame expected by RNNoise (at 48kHz = 10ms).
 */
const RNNOISE_SAMPLE_LENGTH = 480;
const RNNOISE_REQUIRED_SAMPLE_RATE = 48000;
const RNNOISE_WORKLET_NAME = "rnnoise-processor";
const DEFAULT_RNNOISE_PRESET: RNNoiseSuppressionPreset = "conservative";
// Stores the addModule() promise per AudioContext: pending while in-flight,
// settled (resolved) once complete, absent on failure (cleared for retry).
const workletRegistrations = new WeakMap<AudioContext, Promise<void>>();
const warnedUnsupportedSampleRates = new Set<number>();

const _microphoneInputLevelDb$ = new BehaviorSubject<number | null>(null);
/**
 * The current microphone input level in dBFS, measured by the active
 * microphone audio worklet (peak frame RMS per ~50ms window), or null while
 * no processor is running. Used by the settings UI to render a live level
 * meter next to the microphone cutoff slider.
 */
export const microphoneInputLevelDb$: Behavior<number | null> =
  _microphoneInputLevelDb$;

type RNNoiseSupportGlobal = typeof globalThis & {
  AudioWorklet?: {
    prototype?: {
      addModule?: unknown;
    };
  };
};

function createUnsupportedSampleRateError(sampleRate: number): Error {
  return new Error(
    `RNNoise requires an AudioContext sample rate of ${RNNOISE_REQUIRED_SAMPLE_RATE}Hz (received ${sampleRate}Hz).`,
  );
}

function warnUnsupportedSampleRate(sampleRate: number): void {
  if (warnedUnsupportedSampleRates.has(sampleRate)) {
    return;
  }

  warnedUnsupportedSampleRates.add(sampleRate);
  logger.warn(
    `Skipping RNNoise because AudioContext sample rate is ${sampleRate}Hz (expected ${RNNOISE_REQUIRED_SAMPLE_RATE}Hz).`,
  );
}

/**
 * Whether the current runtime supports the required APIs for RNNoise.
 */
export function supportsRNNoiseProcessor(): boolean {
  const workletPrototype = (globalThis as RNNoiseSupportGlobal).AudioWorklet
    ?.prototype;

  return (
    typeof AudioWorkletNode !== "undefined" &&
    typeof MediaStreamAudioDestinationNode !== "undefined" &&
    typeof MediaStreamAudioSourceNode !== "undefined" &&
    typeof workletPrototype?.addModule === "function"
  );
}

/**
 * Generates the AudioWorklet processor code as a string, for use in tests.
 *
 * WARNING: This function is the **test harness** version of the worklet.
 * The authoritative runtime implementation lives in `RNNoiseWorkletModule.ts`,
 * which Vite compiles and loads as a separate script via the `?url` import.
 * If the processor logic changes in `RNNoiseWorkletModule.ts` — frame size,
 * ring buffer, preset constants, downmix algorithm, etc. — the generated
 * code here **must be updated to match** or tests will diverge from runtime
 * behaviour.
 *
 * The worklet loads the RNNoise WASM module synchronously (base64-inlined)
 * and processes audio in 480-sample frames. A ring buffer bridges the
 * 128-sample AudioWorklet blocks to the 480-sample RNNoise frames.
 */
function createWorkletCode(rnnoiseModuleCode: string): string {
  // Patch the rnnoise-sync.js for AudioWorklet scope:
  // 1. Replace import.meta.url — not available in classic worklet scripts
  // 2. Remove the ES module export statement
  const patched = rnnoiseModuleCode
    .replace(/import\.meta\.url/g, '""')
    .replace(/export\s+default\s+createRNNWasmModuleSync;?\s*$/m, "");

  return `
${patched}

const FRAME_SIZE = ${RNNOISE_SAMPLE_LENGTH};
const RING_SIZE = FRAME_SIZE * 3; // Enough headroom for buffering
const SAMPLE_RATE = ${RNNOISE_REQUIRED_SAMPLE_RATE};
const DEFAULT_PRESET = "${DEFAULT_RNNOISE_PRESET}";
const GATE_HYSTERESIS_DB = ${GATE_HYSTERESIS_DB};
const GATE_HOLD_FRAMES = ${GATE_HOLD_FRAMES};
const GATE_OPEN_MS = ${GATE_OPEN_MS};
const GATE_CLOSE_MS = ${GATE_CLOSE_MS};
const MIC_CUTOFF_DEFAULT_DB = ${MIC_CUTOFF_DEFAULT_DB};
const LEVEL_REPORT_FRAMES = ${LEVEL_REPORT_FRAMES};
const PRESETS = {
  conservative: {
    maxAttenuationDb: 4,
    openThreshold: 0.92,
    closeThreshold: 0.60,
    holdFrames: 12,
    attenuateMs: 120,
    releaseMs: 25,
  },
  balanced: {
    maxAttenuationDb: 8,
    openThreshold: 0.90,
    closeThreshold: 0.55,
    holdFrames: 10,
    attenuateMs: 90,
    releaseMs: 22,
  },
  strong: {
    maxAttenuationDb: 16,
    openThreshold: 0.90,
    closeThreshold: 0.55,
    holdFrames: 8,
    attenuateMs: 55,
    releaseMs: 18,
  },
};

class RNNoiseWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ready = false;
    this._destroyed = false;

    // Ring buffers
    this._inBuf = new Float32Array(RING_SIZE);
    this._outBuf = new Float32Array(RING_SIZE);
    this._frameBuf = new Float32Array(FRAME_SIZE);
    this._inW = 0;  // input write position
    this._inR = 0;  // input read position
    this._outW = 0; // output write position
    this._outR = 0; // output read position
    this._currentGain = 1;
    this._targetGain = 1;
    this._holdFrames = 0;
    this._denoiseEnabled = true;
    this._gateEnabled = false;
    this._gateOpenThresholdDb = MIC_CUTOFF_DEFAULT_DB;
    this._gateCloseThresholdDb = MIC_CUTOFF_DEFAULT_DB - GATE_HYSTERESIS_DB;
    this._gateHoldFrames = 0;
    this._gateCurrentGain = 1;
    this._gateTargetGain = 1;
    this._levelReportCounter = 0;
    this._levelReportMaxRms = 0;

    this._setPreset(DEFAULT_PRESET);
    this._gateOpenStep = this._smoothingStepFromMs(GATE_OPEN_MS);
    this._gateCloseStep = this._smoothingStepFromMs(GATE_CLOSE_MS);

    this._initRNNoise();

    this.port.onmessage = (event) => {
      if (event.data.type === 'destroy') {
        this._cleanup();
      } else if (event.data.type === 'preset') {
        this._setPreset(event.data.preset);
      } else if (event.data.type === 'denoise') {
        this._setDenoiseEnabled(event.data.enabled === true);
      } else if (event.data.type === 'gate') {
        this._setGateConfig(event.data.enabled, event.data.thresholdDb);
      }
    };
  }

  _smoothingStepFromMs(ms) {
    if (ms <= 0) return 1;
    const tau = ms / 1000;
    return 1 - Math.exp(-1 / (SAMPLE_RATE * tau));
  }

  _setPreset(preset) {
    if (!(preset in PRESETS)) return;
    this._preset = preset;
    const config = PRESETS[preset];
    this._maxAttenuationDb = config.maxAttenuationDb;
    this._openThreshold = config.openThreshold;
    this._closeThreshold = config.closeThreshold;
    this._holdFramesConfig = config.holdFrames;
    this._attenuateStep = this._smoothingStepFromMs(config.attenuateMs);
    this._releaseStep = this._smoothingStepFromMs(config.releaseMs);
  }

  _setDenoiseEnabled(enabled) {
    this._denoiseEnabled = enabled;
    if (!enabled) {
      // Release any RNNoise attenuation so the stage becomes transparent.
      this._targetGain = 1;
      this._holdFrames = 0;
    }
  }

  _setGateConfig(enabled, thresholdDb) {
    this._gateEnabled = enabled === true;
    if (typeof thresholdDb === 'number' && Number.isFinite(thresholdDb)) {
      this._gateOpenThresholdDb = thresholdDb;
      this._gateCloseThresholdDb = thresholdDb - GATE_HYSTERESIS_DB;
    }
    if (!this._gateEnabled) {
      this._gateTargetGain = 1;
      this._gateCurrentGain = 1;
      this._gateHoldFrames = 0;
    }
  }

  _reportLevel(frameRms) {
    if (frameRms > this._levelReportMaxRms) {
      this._levelReportMaxRms = frameRms;
    }
    this._levelReportCounter += 1;
    if (this._levelReportCounter < LEVEL_REPORT_FRAMES) return;

    const rmsDb = this._levelReportMaxRms > 0
      ? 20 * Math.log10(this._levelReportMaxRms)
      : -200;
    this.port.postMessage({ type: 'level', rmsDb });
    this._levelReportCounter = 0;
    this._levelReportMaxRms = 0;
  }

  _updateGateGain(frameRms) {
    if (!this._gateEnabled) {
      this._gateTargetGain = 1;
      return;
    }

    const rmsDb = frameRms > 0 ? 20 * Math.log10(frameRms) : -200;
    if (rmsDb >= this._gateOpenThresholdDb) {
      this._gateHoldFrames = GATE_HOLD_FRAMES;
      this._gateTargetGain = 1;
    } else if (this._gateHoldFrames > 0) {
      this._gateHoldFrames -= 1;
    } else if (rmsDb < this._gateCloseThresholdDb) {
      this._gateTargetGain = 0;
    }
    // Between the close and open thresholds the gate keeps its previous
    // state (hysteresis).
  }

  _updateTargetGain(vadProbability) {
    if (vadProbability >= this._openThreshold) {
      this._holdFrames = this._holdFramesConfig;
      this._targetGain = 1;
      return;
    }

    if (this._holdFrames > 0) {
      this._holdFrames -= 1;
      this._targetGain = 1;
      return;
    }

    const thresholdRange = this._openThreshold - this._closeThreshold;
    const attenuationProgress = thresholdRange > 0
      ? Math.max(
          0,
          Math.min(1, (this._openThreshold - vadProbability) / thresholdRange),
        )
      : 1;

    const attenuationDb = attenuationProgress * this._maxAttenuationDb;
    this._targetGain = Math.pow(10, -attenuationDb / 20);
  }

  _ringAvailable(w, r) {
    let avail = w - r;
    if (avail < 0) avail += RING_SIZE;
    return avail;
  }

  _initRNNoise() {
    try {
      const module = createRNNWasmModuleSync();

      // Allocate a buffer in WASM memory for one frame of float32 samples
      const pcmBuf = module._malloc(FRAME_SIZE * 4);
      module._rnnoise_init();
      const state = module._rnnoise_create();

      this._module = module;
      this._pcmBuf = pcmBuf;
      this._state = state;
      this._heapF32 = module.HEAPF32;

      this._ready = true;
    } catch (e) {
      // If RNNoise fails to initialize, audio will pass through unprocessed
      this.port.postMessage({ type: 'error', message: String(e) });
    }
  }

  _cleanup() {
    if (this._module && this._state) {
      this._module._rnnoise_destroy(this._state);
      this._module._free(this._pcmBuf);
      this._state = null;
    }
    this._destroyed = true;
  }

  _processFrame() {
    const useDenoise = this._denoiseEnabled && this._ready;
    let sumSquares = 0;

    if (useDenoise) {
      const heapIdx = this._pcmBuf >> 2; // byte offset → float32 index

      // Copy from input ring buffer to WASM heap, scaling to int16 range
      for (let i = 0; i < FRAME_SIZE; i++) {
        this._heapF32[heapIdx + i] =
          this._inBuf[(this._inR + i) % RING_SIZE] * 32768.0;
      }

      // Run RNNoise denoising (in-place)
      const vadProbability = this._module._rnnoise_process_frame(
        this._state, this._pcmBuf, this._pcmBuf
      );
      this._updateTargetGain(vadProbability);

      for (let i = 0; i < FRAME_SIZE; i++) {
        const sample = this._heapF32[heapIdx + i] / 32768.0;
        this._frameBuf[i] = sample;
        sumSquares += sample * sample;
      }
    } else {
      for (let i = 0; i < FRAME_SIZE; i++) {
        const sample = this._inBuf[(this._inR + i) % RING_SIZE];
        this._frameBuf[i] = sample;
        sumSquares += sample * sample;
      }
    }
    this._inR = (this._inR + FRAME_SIZE) % RING_SIZE;

    const frameRms = Math.sqrt(sumSquares / FRAME_SIZE);
    this._updateGateGain(frameRms);
    this._reportLevel(frameRms);

    // Copy to the output ring buffer, applying the smoothed RNNoise
    // attenuation and the noise-gate gain.
    for (let i = 0; i < FRAME_SIZE; i++) {
      const smoothingStep = this._targetGain < this._currentGain
        ? this._attenuateStep
        : this._releaseStep;
      this._currentGain +=
        (this._targetGain - this._currentGain) * smoothingStep;
      const gateStep = this._gateTargetGain < this._gateCurrentGain
        ? this._gateCloseStep
        : this._gateOpenStep;
      this._gateCurrentGain +=
        (this._gateTargetGain - this._gateCurrentGain) * gateStep;
      this._outBuf[(this._outW + i) % RING_SIZE] =
        this._frameBuf[i] * this._currentGain * this._gateCurrentGain;
    }
    this._outW = (this._outW + FRAME_SIZE) % RING_SIZE;
  }

  _mixInputChannels(inputChannels, sampleIndex, channelCount) {
    // RNNoise is mono-only; average all channels for deterministic downmixing.
    let mixed = 0;
    for (let i = 0; i < channelCount; i++) {
      const channel = inputChannels[i];
      mixed += channel ? (channel[sampleIndex] ?? 0) : 0;
    }
    return mixed / channelCount;
  }

  process(inputs, outputs) {
    if (this._destroyed) return false;

    const inputChannels = inputs[0];
    const output = outputs[0]?.[0];

    if (!inputChannels?.length || !output) return true;

    const blockSize = output.length;
    const channelCount = inputChannels.length;

    const framePathActive =
      (this._denoiseEnabled && this._ready) || this._gateEnabled;
    if (!framePathActive) {
      // Pass through when no processing stage is active (e.g. RNNoise not
      // ready yet), with deterministic mono downmix.
      for (let i = 0; i < blockSize; i++) {
        output[i] = this._mixInputChannels(inputChannels, i, channelCount);
      }
      return true;
    }

    // Write input samples to the input ring buffer
    for (let i = 0; i < blockSize; i++) {
      this._inBuf[this._inW] = this._mixInputChannels(
        inputChannels,
        i,
        channelCount,
      );
      this._inW = (this._inW + 1) % RING_SIZE;
    }

    // Process complete frames
    while (this._ringAvailable(this._inW, this._inR) >= FRAME_SIZE) {
      this._processFrame();
    }

    // Read from output ring buffer
    const outAvail = this._ringAvailable(this._outW, this._outR);
    const toRead = Math.min(blockSize, outAvail);

    for (let i = 0; i < toRead; i++) {
      output[i] = this._outBuf[this._outR];
      this._outR = (this._outR + 1) % RING_SIZE;
    }
    // Fill remaining with silence (only during initial buffering)
    for (let i = toRead; i < blockSize; i++) {
      output[i] = 0;
    }

    return true;
  }
}

registerProcessor('${RNNOISE_WORKLET_NAME}', RNNoiseWorkletProcessor);
`;
}

export function createRNNoiseWorkletCodeForTesting(
  rnnoiseModuleCode: string,
): string {
  return createWorkletCode(rnnoiseModuleCode);
}

/**
 * A LiveKit TrackProcessor that applies RNNoise-based noise suppression
 * and/or a level-based noise gate (microphone cutoff volume) to a local
 * audio track via an AudioWorklet.
 *
 * The RNNoise WASM binary is lazy-loaded only when the processor is
 * initialized, keeping the main bundle small.
 */
export class RNNoiseProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  public name = "rnnoise-noise-suppression";
  public processedTrack?: MediaStreamTrack;

  private sourceNode?: MediaStreamAudioSourceNode;
  private workletNode?: AudioWorkletNode;
  private destinationNode?: MediaStreamAudioDestinationNode;
  private destroyed = false;
  private preset: RNNoiseSuppressionPreset;
  private denoiseEnabled: boolean;
  private gate: MicrophoneGateConfig;
  private lastAudioContext?: AudioContext;

  public constructor(
    preset: RNNoiseSuppressionPreset = DEFAULT_RNNOISE_PRESET,
    denoiseEnabled = true,
    gate: MicrophoneGateConfig = {
      enabled: false,
      thresholdDb: MIC_CUTOFF_DEFAULT_DB,
    },
  ) {
    this.preset = preset;
    this.denoiseEnabled = denoiseEnabled;
    this.gate = { ...gate };
  }

  private async ensureWorkletRegistered(
    audioContext: AudioContext,
  ): Promise<void> {
    const existing = workletRegistrations.get(audioContext);
    if (existing) return existing;

    const pending = audioContext.audioWorklet.addModule(
      rnnoiseWorkletModuleUrl,
    );
    workletRegistrations.set(audioContext, pending);
    // On failure, remove the entry so the next call can retry.
    pending.catch(() => {
      workletRegistrations.delete(audioContext);
    });
    return pending;
  }

  public async init(opts: AudioProcessorOptions): Promise<void> {
    // If already initialized, tear down previous nodes before re-initializing
    // so callers don't need to explicitly call destroy() first.
    if (this.workletNode !== undefined) {
      await this.destroy();
    }
    this.destroyed = false;
    const { audioContext, track } = opts;

    // RNNoise is trained for 48kHz audio; the gate works at any rate.
    if (
      this.denoiseEnabled &&
      audioContext.sampleRate !== RNNOISE_REQUIRED_SAMPLE_RATE
    ) {
      warnUnsupportedSampleRate(audioContext.sampleRate);
      throw createUnsupportedSampleRateError(audioContext.sampleRate);
    }

    await this.ensureWorkletRegistered(audioContext);

    // A concurrent destroy() may have run while we awaited worklet registration.
    if (this.destroyed) return;

    // Build the audio processing graph:
    // MediaStreamSource → AudioWorkletNode (RNNoise) → MediaStreamDestination
    const sourceNode = audioContext.createMediaStreamSource(
      new MediaStream([track]),
    );
    const workletNode = new AudioWorkletNode(
      audioContext,
      RNNOISE_WORKLET_NAME,
      {
        channelCount: 1,
        channelCountMode: "explicit",
      },
    );
    const destinationNode = audioContext.createMediaStreamDestination();

    sourceNode.connect(workletNode);
    workletNode.connect(destinationNode);

    this.sourceNode = sourceNode;
    this.workletNode = workletNode;
    this.destinationNode = destinationNode;
    this.workletNode.port.onmessage = (event: MessageEvent): void => {
      const data = event.data as {
        type?: string;
        rmsDb?: number;
        message?: string;
      };
      if (data.type === "level" && typeof data.rmsDb === "number") {
        _microphoneInputLevelDb$.next(data.rmsDb);
      } else if (data.type === "error") {
        logger.warn("Microphone audio worklet error", data.message);
      }
    };
    this.workletNode.port.postMessage({ type: "preset", preset: this.preset });
    this.workletNode.port.postMessage({
      type: "denoise",
      enabled: this.denoiseEnabled,
    });
    this.workletNode.port.postMessage({
      type: "gate",
      enabled: this.gate.enabled,
      thresholdDb: this.gate.thresholdDb,
    });
    this.processedTrack = destinationNode.stream.getAudioTracks()[0];
    this.lastAudioContext = audioContext;
  }

  public async restart(opts: AudioProcessorOptions): Promise<void> {
    const audioContext = opts.audioContext ?? this.lastAudioContext;
    if (!audioContext) {
      throw new Error(
        "RNNoise restart requires an AudioContext when no previous context has been initialized.",
      );
    }

    await this.destroy();
    await this.init({ ...opts, audioContext });
  }

  public async destroy(): Promise<void> {
    if (this.destroyed) {
      await Promise.resolve();
      return;
    }
    this.destroyed = true;

    // Signal the worklet to clean up WASM resources
    this.workletNode?.port.postMessage({ type: "destroy" });

    // Disconnect the audio graph
    this.sourceNode?.disconnect();
    this.workletNode?.disconnect();
    this.destinationNode?.disconnect();

    try {
      this.processedTrack?.stop();
    } catch (e) {
      logger.warn("Failed to stop RNNoise processed track during destroy", e);
    }

    this.sourceNode = undefined;
    this.workletNode = undefined;
    this.destinationNode = undefined;
    this.processedTrack = undefined;
    _microphoneInputLevelDb$.next(null);
    await Promise.resolve();
  }

  public setPreset(preset: RNNoiseSuppressionPreset): void {
    this.preset = preset;
    this.workletNode?.port.postMessage({
      type: "preset",
      preset: this.preset,
    });
  }

  /**
   * Toggles the RNNoise denoising stage without tearing down the worklet.
   * Throws when enabling denoising on an AudioContext whose sample rate
   * RNNoise does not support.
   */
  public setDenoiseEnabled(enabled: boolean): void {
    if (
      enabled &&
      !this.denoiseEnabled &&
      this.lastAudioContext !== undefined &&
      this.lastAudioContext.sampleRate !== RNNOISE_REQUIRED_SAMPLE_RATE
    ) {
      warnUnsupportedSampleRate(this.lastAudioContext.sampleRate);
      throw createUnsupportedSampleRateError(this.lastAudioContext.sampleRate);
    }
    this.denoiseEnabled = enabled;
    this.workletNode?.port.postMessage({ type: "denoise", enabled });
  }

  /**
   * Updates the level-based noise gate (microphone cutoff volume).
   */
  public setGateConfig(gate: MicrophoneGateConfig): void {
    this.gate = { ...gate };
    this.workletNode?.port.postMessage({
      type: "gate",
      enabled: gate.enabled,
      thresholdDb: gate.thresholdDb,
    });
  }
}
