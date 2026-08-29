import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { recorderPlugin } from "./scripts/vite-recorder-plugin.js";

// The MediaPipe wasm fileset is served from ONE url, /mediapipe/wasm, in both
// dev and build. The plugin installs a dev middleware as well as copying at
// build time, so there is no import.meta.env.DEV branch and therefore no way
// for the two to drift. Repo A shipped a dead build precisely because it
// referenced /node_modules/... , which only the dev server ever resolved.
export default defineConfig({
  base: "/",
  server: { port: 5300, host: true },
  preview: { port: 4173, host: true },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: "node_modules/@mediapipe/tasks-vision/wasm/*", dest: "mediapipe/wasm" },
      ],
    }),
    // Writes the debug panel's captures into ./recordings (dev and preview).
    recorderPlugin({ dir: "recordings" }),
  ],
  build: { target: "es2022" },
});
