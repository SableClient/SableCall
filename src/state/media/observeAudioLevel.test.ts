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

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { BehaviorSubject, of } from "rxjs";
import type { LocalAudioTrack } from "livekit-client";

import {
  observeSpeakingFromLevel$,
  observeTrackAudioLevel$,
  type AudioAnalyserFactory,
} from "./observeAudioLevel";

function mockAudioTrack(): LocalAudioTrack {
  return {
    kind: "audio",
    mediaStreamTrack: {} as MediaStreamTrack,
    isMuted: false,
  } as unknown as LocalAudioTrack;
}

describe("observeTrackAudioLevel$", () => {
  let analyserFactory: ReturnType<typeof vi.fn<AudioAnalyserFactory>>;
  let cleanup: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    cleanup = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    analyserFactory = vi.fn<AudioAnalyserFactory>(() => ({
      calculateVolume: () => 0,
      cleanup,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("emits 0 when there is no track", () => {
    const levels: number[] = [];
    observeTrackAudioLevel$(of(undefined), analyserFactory).subscribe((level) =>
      levels.push(level),
    );
    expect(levels).toEqual([0]);
    expect(analyserFactory).not.toHaveBeenCalled();
  });

  test("emits the calculated volume for an audio track", async () => {
    analyserFactory = vi.fn<AudioAnalyserFactory>(() => ({
      calculateVolume: () => 0.7,
      cleanup,
    }));

    const levels: number[] = [];
    observeTrackAudioLevel$(of(mockAudioTrack()), analyserFactory).subscribe(
      (level) => levels.push(level),
    );
    // Initial emission (startWith(0))
    expect(levels).toEqual([0]);
    expect(analyserFactory).toHaveBeenCalled();

    // Advance the interval timer
    await vi.advanceTimersByTimeAsync(200);
    expect(levels).toEqual([0, 0.7]);
  });

  test("cleans up the analyser when unsubscribed", () => {
    const sub = observeTrackAudioLevel$(
      of(mockAudioTrack()),
      analyserFactory,
    ).subscribe();
    sub.unsubscribe();

    expect(cleanup).toHaveBeenCalled();
  });
});

describe("observeSpeakingFromLevel$", () => {
  let levels: BehaviorSubject<number>;
  let speaking: boolean[];
  let sub: ReturnType<typeof subscribeToSpeaking>;

  function subscribeToSpeaking(
    options?: Parameters<typeof observeSpeakingFromLevel$>[1],
  ) {
    speaking = [];
    const s = observeSpeakingFromLevel$(levels, options).subscribe((v) =>
      speaking.push(v),
    );
    return s;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    levels = new BehaviorSubject(0.01); // below threshold
  });

  afterEach(() => {
    sub?.unsubscribe();
    vi.useRealTimers();
  });

  test("starts as not speaking and stays silent when level is low", () => {
    sub = subscribeToSpeaking({ confirmMs: 300, dropOffMs: 1000 });
    expect(speaking).toEqual([false]);
    levels.next(0.01);
    expect(speaking).toEqual([false]);
  });

  test("brief blip above threshold does not trigger speaking", async () => {
    sub = subscribeToSpeaking({ confirmMs: 300, dropOffMs: 1000 });
    levels.next(0.2); // blip above threshold
    await vi.advanceTimersByTimeAsync(100); // blip lasts 100ms < confirmMs
    levels.next(0.01); // back below threshold
    await vi.advanceTimersByTimeAsync(1000); // more than confirmMs
    expect(speaking).toEqual([false]);
  });

  test("sustained voice becomes speaking after confirm period", async () => {
    sub = subscribeToSpeaking({ confirmMs: 300, dropOffMs: 1000 });
    levels.next(0.2); // above threshold
    await vi.advanceTimersByTimeAsync(200);
    expect(speaking).toEqual([false]); // not yet confirmed
    await vi.advanceTimersByTimeAsync(100); // total 300ms
    expect(speaking).toEqual([false, true]); // confirmed speaking
  });

  test("stops speaking after drop-off once level falls below hold threshold", async () => {
    sub = subscribeToSpeaking({ confirmMs: 300, dropOffMs: 1000 });
    levels.next(0.2);
    await vi.advanceTimersByTimeAsync(300);
    expect(speaking).toEqual([false, true]); // confirmed speaking
    levels.next(0.01); // below hold threshold
    await vi.advanceTimersByTimeAsync(500);
    expect(speaking).toEqual([false, true]); // still speaking during drop-off
    await vi.advanceTimersByTimeAsync(500); // total 1000ms drop-off
    expect(speaking).toEqual([false, true, false]); // stopped speaking
  });

  test("holds speaking through brief dips (hysteresis)", async () => {
    sub = subscribeToSpeaking({ confirmMs: 300, dropOffMs: 1000 });
    levels.next(0.2);
    await vi.advanceTimersByTimeAsync(300);
    expect(speaking).toEqual([false, true]); // confirmed speaking
    levels.next(0.01); // brief dip below hold threshold
    await vi.advanceTimersByTimeAsync(100); // shorter than drop-off
    levels.next(0.2); // resume speaking
    await vi.advanceTimersByTimeAsync(1000);
    expect(speaking).toEqual([false, true]); // never stopped speaking
  });

  test("hysteresis: requires higher level to start than to keep speaking", async () => {
    sub = subscribeToSpeaking({
      threshold: 0.05,
      holdThreshold: 0.02,
      confirmMs: 300,
      dropOffMs: 1000,
    });
    // 0.03 is above hold but below threshold: should NOT start speaking
    levels.next(0.03);
    await vi.advanceTimersByTimeAsync(1000);
    expect(speaking).toEqual([false]);
    // 0.1 is above threshold: starts speaking after confirm
    levels.next(0.1);
    await vi.advanceTimersByTimeAsync(300);
    expect(speaking).toEqual([false, true]);
    // 0.03 is below threshold but above hold: keeps speaking
    levels.next(0.03);
    await vi.advanceTimersByTimeAsync(500);
    expect(speaking).toEqual([false, true]);
  });
});
