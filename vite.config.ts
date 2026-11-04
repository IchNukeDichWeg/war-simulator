import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Content Security Policy for the built page only. The dev server injects inline scripts for
 *  React refresh, which script-src 'self' would block, so a meta tag in index.html broke
 *  `npm run dev`. Hosts: GIBS satellite tiles and the AWS terrain tiles (src/map/controller.ts);
 *  blob: for MapLibre's workers; data: for the inline favicon and MapLibre's CSS icons.
 *  style-src needs no 'unsafe-inline': React and MapLibre set styles through the CSSOM
 *  (element.style), which CSP allows; only style="" in markup is blocked, and neither the app
 *  nor the built bundles write any. Checked on the built page in headless Chrome: a preset run,
 *  Monte Carlo, every map layer, Nations, Editor and the limits page gave no violation. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: https://gibs.earthdata.nasa.gov https://s3.amazonaws.com",
  "connect-src 'self' data: blob: https://gibs.earthdata.nasa.gov https://s3.amazonaws.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig({
  plugins: [react(), cspMeta()],
  base: './',
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'maplibre', test: /node_modules[\\/]maplibre-gl[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 120000 },
});
