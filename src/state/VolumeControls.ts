/*
Copyright 2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  combineLatest,
  distinctUntilChanged,
  map,
  merge,
  of,
  Subject,
  switchMap,
  withLatestFrom,
} from "rxjs";

import { type Behavior } from "./Behavior";
import { type ObservableScope } from "./ObservableScope";
import { accumulate } from "../utils/observable";

/**
 * The maximum playback volume, as a scalar multiplier of the stream's base
 * volume. Values above 1 boost the volume past 100%.
 */
export const MAX_PLAYBACK_VOLUME = 2;

/**
 * Controls for audio playback volume.
 */
export interface VolumeControls {
  playbackVolume$: Behavior<number>;
  playbackMuted$: Behavior<boolean>;
  togglePlaybackMuted: () => void;
  adjustPlaybackVolume: (value: number) => void;
  commitPlaybackVolume: () => void;
}

interface VolumeControlsInputs {
  pretendToBeDisconnected$: Behavior<boolean>;
  sink$: Behavior<(volume: number) => void>;
  initialVolume?: number;
  onVolumeCommitted?: (volume: number) => void;
  /**
   * Called with whether the volume is above 100% whenever it changes, so the
   * audio renderer can route the participant's audio through a WebAudio gain
   * node (required to amplify past the HTMLMediaElement's volume cap of 1).
   */
  onBoostedChange?: (boosted: boolean) => void;
}

/**
 * Creates a set of controls for audio playback volume and syncs this with the
 * audio playback module for the duration of the scope.
 */
export function createVolumeControls(
  scope: ObservableScope,
  {
    pretendToBeDisconnected$,
    sink$,
    initialVolume = 1,
    onVolumeCommitted,
    onBoostedChange,
  }: VolumeControlsInputs,
): VolumeControls {
  const clamp = (v: number): number =>
    Math.max(0, Math.min(MAX_PLAYBACK_VOLUME, v));
  const toggleMuted$ = new Subject<"toggle mute">();
  const adjustVolume$ = new Subject<number>();
  const commitVolume$ = new Subject<"commit">();

  const playbackVolume$ = scope.behavior<number>(
    merge(toggleMuted$, adjustVolume$, commitVolume$).pipe(
      accumulate(
        {
          volume: clamp(initialVolume),
          committedVolume: clamp(initialVolume),
        },
        (state, event) => {
          switch (event) {
            case "toggle mute":
              return {
                ...state,
                volume: state.volume === 0 ? state.committedVolume : 0,
              };
            case "commit":
              // Dragging the slider to zero should have the same effect as
              // muting: keep the original committed volume, as if it were never
              // dragged
              return {
                ...state,
                committedVolume:
                  state.volume === 0 ? state.committedVolume : state.volume,
              };
            default:
              // Clamp so nothing above the maximum can slip through (e.g. a
              // stale saved preference).
              return { ...state, volume: clamp(event) };
          }
        },
      ),
      map(({ volume }) => volume),
    ),
  );

  // Notify the caller of newly committed volumes, e.g. so they can be
  // persisted. Committing at zero keeps the previous committed volume (see
  // above), so it is not reported.
  if (onVolumeCommitted !== undefined) {
    commitVolume$
      .pipe(withLatestFrom(playbackVolume$), scope.bind())
      .subscribe(([, volume]) => {
        if (volume > 0) onVolumeCommitted(volume);
      });
  }

  // Sync the requested volume with the audio playback module
  combineLatest([
    sink$,
    // The playback volume, taking into account whether we're supposed to
    // pretend that the audio stream is disconnected (since we don't necessarily
    // want that to modify the UI state).
    pretendToBeDisconnected$.pipe(
      switchMap((disconnected) => (disconnected ? of(0) : playbackVolume$)),
    ),
  ])
    .pipe(scope.bind())
    .subscribe(([sink, volume]) => sink(volume));

  // Notify the audio renderer when this stream starts/stops needing a boost.
  if (onBoostedChange !== undefined) {
    playbackVolume$
      .pipe(
        map((volume) => volume > 1),
        distinctUntilChanged(),
        scope.bind(),
      )
      .subscribe(onBoostedChange);
  }

  return {
    playbackVolume$,
    playbackMuted$: scope.behavior<boolean>(
      playbackVolume$.pipe(map((volume) => volume === 0)),
    ),
    togglePlaybackMuted: () => toggleMuted$.next("toggle mute"),
    adjustPlaybackVolume: (value: number) => adjustVolume$.next(value),
    commitPlaybackVolume: () => commitVolume$.next("commit"),
  };
}
