/*
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, test } from "vitest";

import { createLayoutModeSwitch } from "./LayoutSwitch";
import { testScope, withTestScheduler } from "../../utils/test";

function testLayoutSwitch({
  windowMode = "n",
  userSelection = "",
  expectedGridMode,
}: {
  windowMode?: string;
  userSelection?: string;
  expectedGridMode: string;
}): void {
  withTestScheduler(({ behavior, schedule, expectObservable }) => {
    const { gridMode$, setGridMode } = createLayoutModeSwitch(
      testScope(),
      behavior(windowMode, { n: "normal", N: "narrow", f: "flat" }),
    );
    schedule(userSelection, {
      g: () => setGridMode("grid"),
      s: () => setGridMode("spotlight"),
    });
    expectObservable(gridMode$).toBe(expectedGridMode, {
      g: "grid",
      s: "spotlight",
    });
  });
}

describe("default mode", () => {
  test("uses grid layout by default", () =>
    testLayoutSwitch({
      expectedGridMode: "g",
    }));

  test("uses spotlight mode when window mode is flat", () =>
    testLayoutSwitch({
      windowMode: "      f",
      expectedGridMode: "s",
    }));
});

test("allows switching modes manually", () =>
  testLayoutSwitch({
    userSelection: "   --sgs",
    expectedGridMode: "g-sgs",
  }));

test("auto-switches to spotlight when in flat window mode", () =>
  testLayoutSwitch({
    // First normal, then narrow, then flat.
    windowMode: "      nNf",
    expectedGridMode: "g-s",
  }));

test("allows switching modes manually when in flat window mode", () =>
  testLayoutSwitch({
    // Window becomes flat, then user switches to grid and back.
    // Finally the window returns to a normal shape.
    windowMode: "      nf--n",
    userSelection: "   --gs",
    expectedGridMode: "gsgsg",
  }));

test("returns to grid mode when the window returns to a normal shape", () =>
  testLayoutSwitch({
    // Window starts flat (spotlight), then returns to a normal shape.
    windowMode: "f n",
    expectedGridMode: "sg",
  }));
