/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it, vi, afterEach } from "vitest";
import { logger } from "matrix-js-sdk/lib/logger";

import { Config, validateConfig } from "./Config";
import { MatrixRTCMode } from "./ConfigOptions";

describe("validateConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through a missing matrix_rtc_mode unchanged", () => {
    const result = validateConfig({});
    expect(result.matrix_rtc_mode).toBeUndefined();
  });

  it.each(Object.values(MatrixRTCMode))(
    "keeps a valid matrix_rtc_mode value (%s)",
    (mode) => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const result = validateConfig({ matrix_rtc_mode: mode });
      expect(result.matrix_rtc_mode).toBe(mode);
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  it("drops an invalid matrix_rtc_mode value and warns", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const result = validateConfig({
      // Intentionally bypass the type to simulate bad JSON.
      matrix_rtc_mode: "nonsense" as unknown as MatrixRTCMode,
    });
    expect(result.matrix_rtc_mode).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("nonsense");
  });

  it("does not touch unrelated fields when dropping an invalid mode", () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const result = validateConfig({
      matrix_rtc_mode: "nope" as unknown as MatrixRTCMode,
      ssla: "https://example.invalid/ssla",
    });
    expect(result.matrix_rtc_mode).toBeUndefined();
    expect(result.ssla).toBe("https://example.invalid/ssla");
  });
});

describe("Config.init livekitServiceUrl url param", () => {
  const resetConfig = (): void => {
    (Config as unknown as { internalInstance?: unknown }).internalInstance =
      undefined;
  };
  const widgetSearch =
    "?widgetId=call-embed&parentUrl=https%3A%2F%2Fexample.org";

  afterEach(() => {
    window.history.replaceState(null, "", "?");
    resetConfig();
    vi.unstubAllGlobals();
  });

  it("uses the livekitServiceUrl url param when the config file has none", async () => {
    window.history.replaceState(
      null,
      "",
      `${widgetSearch}&livekitServiceUrl=${encodeURIComponent(
        "https://lk.example.org",
      )}`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );

    await Config.init();

    expect(Config.get().livekit).toStrictEqual({
      livekit_service_url: "https://lk.example.org",
    });
  });

  it("prefers the livekitServiceUrl url param over the config file", async () => {
    window.history.replaceState(
      null,
      "",
      `${widgetSearch}&livekitServiceUrl=${encodeURIComponent(
        "https://lk.example.org",
      )}`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            livekit: { livekit_service_url: "https://config.example.org" },
          }),
          { status: 200 },
        ),
      ),
    );

    await Config.init();

    expect(Config.get().livekit).toStrictEqual({
      livekit_service_url: "https://lk.example.org",
    });
  });

  it("ignores the livekitServiceUrl url param outside widget mode", async () => {
    window.history.replaceState(
      null,
      "",
      `?livekitServiceUrl=${encodeURIComponent("https://lk.example.org")}`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );

    await Config.init();

    expect(Config.get().livekit).toBeUndefined();
  });
});
