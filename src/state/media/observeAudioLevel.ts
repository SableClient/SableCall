/*
SableCall
Copyright (C) 2026 TomOdellSheetMusic

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
import {
  createAudioAnalyser,
  type AudioAnalyserOptions,
  type LocalAudioTrack,
  type RemoteAudioTrack,
  type Track,
} from "livekit-client";
import {
  distinctUntilChanged,
  finalize,
  interval,
  map,
  of,
  scan,
  startWith,
  switchMap,
  timer,
  type Observable,
} from "rxjs";

// Constants for audio level detection and debounce
export const AUDIO_LEVEL_SAMPLE_INTERVAL_MS = 100;
export const VOICE_ACTIVITY_THRESHOLD = 0.05;
export const VOICE_ACTIVITY_HOLD_THRESHOLD = 0.02;
export const VOICE_ACTIVITY_CONFIRM_MS = 50;
export const VOICE_ACTIVITY_DROP_OFF_MS = 50;

export type AudioAnalyserFactory = (
  track: LocalAudioTrack | RemoteAudioTrack,
  options?: AudioAnalyserOptions,
) => { calculateVolume: () => number; cleanup: () => Promise<void> };

function isAudioTrack(
  track: Track,
): track is LocalAudioTrack | RemoteAudioTrack {
  return track.kind === "audio" && typeof track.mediaStreamTrack === "object";
}

// Raw audio level (0-1) of a participant's microphone track, sampled continuously.
export function observeTrackAudioLevel$(
  track$: Observable<Track | undefined>,
  analyserFactory: AudioAnalyserFactory = createAudioAnalyser,
): Observable<number> {
  return track$.pipe(
    switchMap((track) => {
      if (!track || !isAudioTrack(track)) return of(0);
      const { calculateVolume, cleanup } = analyserFactory(track, {
        cloneTrack: true,
        smoothingTimeConstant: 0.1,
      });
      return interval(AUDIO_LEVEL_SAMPLE_INTERVAL_MS).pipe(
        map(() => calculateVolume()),
        startWith(0),
        distinctUntilChanged(),
        finalize(() => void cleanup()),
      );
    }),
  );
}

export interface SpeakingOptions {
  threshold?: number;
  holdThreshold?: number;
  confirmMs?: number;
  dropOffMs?: number;
}

// Debounced speaking detection
export function observeSpeakingFromLevel$(
  level$: Observable<number>,
  {
    threshold = VOICE_ACTIVITY_THRESHOLD,
    holdThreshold = VOICE_ACTIVITY_HOLD_THRESHOLD,
    confirmMs = VOICE_ACTIVITY_CONFIRM_MS,
    dropOffMs = VOICE_ACTIVITY_DROP_OFF_MS,
  }: SpeakingOptions = {},
): Observable<boolean> {
  return level$.pipe(
    scan(
      (speaking, level) =>
        speaking ? level > holdThreshold : level > threshold,
      false,
    ),
    distinctUntilChanged(),
    switchMap((speaking, index) =>
      index === 0
        ? of(speaking)
        : timer(speaking ? confirmMs : dropOffMs).pipe(map(() => speaking)),
    ),
    distinctUntilChanged(),
  );
}
