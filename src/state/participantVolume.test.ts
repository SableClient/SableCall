/*
Copyright 2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import {
  boostedParticipants$,
  setParticipantBoosted,
} from "./participantVolume";

describe("participantVolume", () => {
  it("tracks which participants are boosted", () => {
    setParticipantBoosted("@alice:example.org:AAAA", false);
    setParticipantBoosted("@alice:example.org:AAAA", true);
    expect(boostedParticipants$.value).toEqual(
      new Set(["@alice:example.org:AAAA"]),
    );

    setParticipantBoosted("@bob:example.org:BBBB", true);
    expect(boostedParticipants$.value).toEqual(
      new Set(["@alice:example.org:AAAA", "@bob:example.org:BBBB"]),
    );

    setParticipantBoosted("@alice:example.org:AAAA", false);
    expect(boostedParticipants$.value).toEqual(
      new Set(["@bob:example.org:BBBB"]),
    );

    setParticipantBoosted("@bob:example.org:BBBB", false);
    expect(boostedParticipants$.value).toEqual(new Set());
  });

  it("does not emit when nothing changes", () => {
    const values: Set<string>[] = [];
    const sub = boostedParticipants$.subscribe((v) => values.push(v));
    setParticipantBoosted("@alice:example.org:AAAA", false);
    expect(values.length).toBe(1);
    sub.unsubscribe();
  });
});
