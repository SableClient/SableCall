/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createVolumeControls, MAX_PLAYBACK_VOLUME } from "./VolumeControls";
import { ObservableScope } from "./ObservableScope";
import { constant } from "./Behavior";

describe("createVolumeControls", () => {
  let scope: ObservableScope;

  beforeEach(() => {
    scope = new ObservableScope();
  });

  afterEach(() => scope.end());

  function create(options?: {
    initialVolume?: number;
    onVolumeCommitted?: (volume: number) => void;
    onBoostedChange?: (boosted: boolean) => void;
  }): {
    controls: ReturnType<typeof createVolumeControls>;
    sink: ReturnType<typeof vi.fn>;
  } {
    const sink = vi.fn();
    const controls = createVolumeControls(scope, {
      pretendToBeDisconnected$: constant(false),
      sink$: constant(sink),
      ...options,
    });
    return { controls, sink };
  }

  it("starts at the initial volume and applies it to the sink", () => {
    const { controls, sink } = create({ initialVolume: 0.4 });

    expect(controls.playbackVolume$.value).toBe(0.4);
    expect(sink).toHaveBeenCalledWith(0.4);
  });

  it("defaults to full volume without an initial volume", () => {
    const { controls } = create();

    expect(controls.playbackVolume$.value).toBe(1);
  });

  it("reports the volume on commit but not while adjusting", () => {
    const onVolumeCommitted = vi.fn();
    const { controls } = create({ onVolumeCommitted });

    controls.adjustPlaybackVolume(0.7);
    expect(onVolumeCommitted).not.toHaveBeenCalled();

    controls.commitPlaybackVolume();
    expect(onVolumeCommitted).toHaveBeenCalledTimes(1);
    expect(onVolumeCommitted).toHaveBeenCalledWith(0.7);
  });

  it("does not report mute toggles or commits at zero", () => {
    const onVolumeCommitted = vi.fn();
    const { controls } = create({ onVolumeCommitted });

    controls.togglePlaybackMuted();
    expect(onVolumeCommitted).not.toHaveBeenCalled();

    controls.adjustPlaybackVolume(0);
    controls.commitPlaybackVolume();
    expect(onVolumeCommitted).not.toHaveBeenCalled();
  });

  it("unmutes back to the initial volume", () => {
    const { controls } = create({ initialVolume: 0.6 });

    controls.togglePlaybackMuted();
    expect(controls.playbackVolume$.value).toBe(0);

    controls.togglePlaybackMuted();
    expect(controls.playbackVolume$.value).toBe(0.6);
  });

  it("supports volumes above 100%", () => {
    const { controls, sink } = create();

    controls.adjustPlaybackVolume(1.5);
    expect(controls.playbackVolume$.value).toBe(1.5);
    expect(sink).toHaveBeenLastCalledWith(1.5);
  });

  it("clamps volumes above the maximum", () => {
    const { controls, sink } = create();

    controls.adjustPlaybackVolume(2.5);
    expect(controls.playbackVolume$.value).toBe(MAX_PLAYBACK_VOLUME);
    expect(sink).toHaveBeenLastCalledWith(MAX_PLAYBACK_VOLUME);
  });

  it("clamps an out-of-range initial volume", () => {
    const { controls, sink } = create({ initialVolume: 5 });

    expect(controls.playbackVolume$.value).toBe(MAX_PLAYBACK_VOLUME);
    expect(sink).toHaveBeenCalledWith(MAX_PLAYBACK_VOLUME);
  });

  it("reports whether the volume is boosted above the base volume", () => {
    const onBoostedChange = vi.fn();
    const { controls } = create({ onBoostedChange });

    expect(onBoostedChange).toHaveBeenLastCalledWith(false);

    controls.adjustPlaybackVolume(1.01);
    expect(onBoostedChange).toHaveBeenLastCalledWith(true);

    controls.adjustPlaybackVolume(0.5);
    expect(onBoostedChange).toHaveBeenLastCalledWith(false);
  });
});
