/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

/**
 * Range and default of the microphone cutoff volume, in dBFS. Microphone
 * input whose level stays below the cutoff is muted by a noise gate in the
 * audio worklet.
 */
export const MIC_CUTOFF_MIN_DB = -60;
export const MIC_CUTOFF_MAX_DB = -10;
export const MIC_CUTOFF_DEFAULT_DB = -40;

/**
 * The gate closes only once the level falls this far below the cutoff, so it
 * doesn't flutter when the level hovers around the threshold.
 */
export const GATE_HYSTERESIS_DB = 6;
/**
 * Number of 10ms frames the gate stays open after the level last exceeded
 * the cutoff, so it doesn't clip the ends of words.
 */
export const GATE_HOLD_FRAMES = 30;
/**
 * Gain smoothing time constants for opening and closing the gate. Opening is
 * fast to avoid clipping the start of speech; closing is slower to avoid
 * audible pumping.
 */
export const GATE_OPEN_MS = 5;
export const GATE_CLOSE_MS = 40;

/**
 * How many 10ms frames to aggregate before the worklet reports the measured
 * input level (peak frame RMS within the window) to the main thread, for the
 * live meter shown next to the cutoff slider.
 */
export const LEVEL_REPORT_FRAMES = 5;

export interface MicrophoneGateConfig {
  enabled: boolean;
  /** Level in dBFS below which microphone input is muted. */
  thresholdDb: number;
}
