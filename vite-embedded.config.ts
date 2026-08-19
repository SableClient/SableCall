/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { defineConfig, mergeConfig } from "vite";
import generateFile from "vite-plugin-generate-file";
import { viteStaticCopy } from "vite-plugin-static-copy";

import fullConfig from "./vite.config";

const base = "./";

// Config for embedded deployments (possibly hosted under a non-root path)
export default defineConfig((env) =>
  mergeConfig(
    fullConfig({ ...env, packageType: "embedded" }),
    defineConfig({
      base, // Use relative URLs to allow the app to be hosted under any path
      publicDir: false, // Don't serve the public directory which only contains the favicon
      plugins: [
        generateFile([
          {
            type: "json",
            output: "./config.json",
            data: {
              matrix_rtc_session: {
                wait_for_key_rotation_ms: 5000,
                delayed_leave_event_restart_ms: 4000,
                delayed_leave_event_delay_ms: 18000,
              },
            },
          },
        ]),
        // The embedded build disables publicDir, so the DeepFilterNet WASM
        // binary and ONNX model (downloaded by `pnpm setup:assets`) would
        // otherwise be omitted from the build output. Copy them explicitly so
        // they are served from /assets/deepfilternet3/ at runtime.
        viteStaticCopy({
          targets: [
            {
              src: "public/assets/deepfilternet3/**/*",
              dest: "assets/deepfilternet3",
              // Strip the `public/assets/deepfilternet3` prefix (3 segments)
              // so files land at dist/assets/deepfilternet3/v3/...
              rename: { stripBase: 3 },
            },
          ],
        }),
      ],
    }),
  ),
);
