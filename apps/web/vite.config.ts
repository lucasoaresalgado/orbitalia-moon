import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter({ out: "build" }),
      // agent output is untrusted: scripts only from the app itself (scope §13)
      csp: {
        mode: "auto",
        directives: {
          "default-src": ["self"],
          "script-src": ["self"],
          "style-src": ["self", "unsafe-inline"],
          "img-src": ["self", "data:"],
          "font-src": ["self", "data:"],
          "connect-src": ["self"],
          "frame-ancestors": ["none"],
          "base-uri": ["self"],
          "form-action": ["self"],
        },
      },
    }),
  ],
  // workspace packages are TypeScript source: bundle them into the server build
  ssr: { noExternal: [/^@miniasys\//] },
  server: { host: "127.0.0.1", fs: { allow: ["../.."] } },
});
