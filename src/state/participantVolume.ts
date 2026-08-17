/*
Copyright 2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { BehaviorSubject } from "rxjs";

/**
 * Identities of remote participants whose playback volume is currently boosted
 * above 100%. Module-level so the audio renderer can react to it without
 * threading state through the view model tree.
 */
export const boostedParticipants$ = new BehaviorSubject<Set<string>>(new Set());

/**
 * Mark a participant's volume as boosted (above 100%) or not.
 */
export function setParticipantBoosted(
  identity: string,
  boosted: boolean,
): void {
  if (boostedParticipants$.value.has(identity) === boosted) return;
  const next = new Set(boostedParticipants$.value);
  if (boosted) next.add(identity);
  else next.delete(identity);
  boostedParticipants$.next(next);
}
