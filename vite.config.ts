import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// In dev, the Svelte app runs on Vite and API/WebSocket calls go to `wrangler dev` on port 8787.
export default defineConfig({
  plugins: [svelte()],
  server: {
    host: true,
    proxy: {
      "/api": "http://localhost:8787",
      "/ws": { target: "ws://localhost:8787", ws: true },
    },
  },
});
