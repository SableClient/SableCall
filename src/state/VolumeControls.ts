/*
Copyright 2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  combineLatest,
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
 * Controls for audio playback volume.
 */
export interface VolumeControls {
  /**
   * The volume to which the audio is set, as a scalar multiplier.
   */
  playbackVolume$: Behavior<number>;
  /**
   * Whether playback of this audio is disabled.
   */
  playbackMuted$: Behavior<boolean>;
  togglePlaybackMuted: () => void;
  adjustPlaybackVolume: (value: number) => void;
  commitPlaybackVolume: () => void;
}

interface VolumeControlsInputs {
  pretendToBeDisconnected$: Behavior<boolean>;
  /**
   * The callback to run to notify the module performing audio playback of the
   * requested volume.
   */
  sink$: Behavior<(volume: number) => void>;
  /**
   * The volume to start at, e.g. restored from a saved preference. Defaults
   * to 1.
   */
  initialVolume?: number;
  /**
   * Called with the newly committed volume whenever the user finishes
   * adjusting it (i.e. on commit, not while dragging). Not called for mute
   * toggles or when the slider is released at zero, since those keep the
   * previous committed volume.
   */
  onVolumeCommitted?: (volume: number) => void;
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
  }: VolumeControlsInputs,
): VolumeControls {
  const toggleMuted$ = new Subject<"toggle mute">();
  const adjustVolume$ = new Subject<number>();
  const commitVolume$ = new Subject<"commit">();

  const playbackVolume$ = scope.behavior<number>(
    merge(toggleMuted$, adjustVolume$, commitVolume$).pipe(
      accumulate(
        { volume: initialVolume, committedVolume: initialVolume },
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
              // Volume adjustment
              return { ...state, volume: event };
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
