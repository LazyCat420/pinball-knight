import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find projects.json by traversing parent dirs
let defaultHost = '10.0.0.16';
try {
  let curr = __dirname;
  for (let i = 0; i < 5; i++) {
    const p1 = path.join(curr, 'vault-service', 'projects.json');
    if (fs.existsSync(p1)) {
      const data = JSON.parse(fs.readFileSync(p1, 'utf8'));
      if (data.defaultHost) defaultHost = data.defaultHost;
      break;
    }
    const p2 = path.join(curr, 'projects.json');
    if (fs.existsSync(p2)) {
      const data = JSON.parse(fs.readFileSync(p2, 'utf8'));
      if (data.defaultHost) defaultHost = data.defaultHost;
      break;
    }
    curr = path.dirname(curr);
  }
} catch (e) {
  // Fallback
}

// The backend (braindeadbot-service) base URL, baked into the client bundle.
//
// NEXT_PUBLIC_* is inlined at BUILD time, not read at runtime, so this must be
// resolved here — a runtime `environment:` entry in docker-compose is too late
// and does nothing. Docker passes it in as a build ARG (see Dockerfile); when
// it is absent we fall back to the same `defaultHost` resolved above rather
// than a second hardcoded copy of the LAN address.
//
// The old fallback was `http://localhost:5175`, which shipped to production and
// told every visitor's browser to call *their own* machine. Every leaderboard
// read and write silently degraded to localStorage.
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || `http://${defaultHost}:5175`;

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: false,

  // Inlines the value into the client bundle at build time.
  env: {
    NEXT_PUBLIC_BACKEND_URL: backendUrl,
  },

  allowedDevOrigins: ["braindeadbot.com", `http://${defaultHost}:5174`, defaultHost, `http://${defaultHost}`],
  // Disable SSR for the entire app — this is a client-only 3D experience
  // All pages use "use client" and dynamic import with ssr: false

  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: true,
  },
  // No `eslint` block: Next 16 removed `eslint.ignoreDuringBuilds` because it
  // no longer runs ESLint during `next build` at all. Leaving it in produced an
  // "Invalid next.config.js options detected" warning on every dev boot — which
  // is what the dev overlay's issue badge was reporting.

  // Proxy API requests to tts-service
  async rewrites() {
    return [
      {
        source: '/api/v1/tts/:path*',
        destination: `http://${defaultHost}:3032/api/v1/tts/:path*`,
      },
    ];
  },

  // Shader files import as their raw text: `import SRC from "./x.wgsl"`.
  //
  // TWO WRONG ANSWERS WERE MEASURED HERE, both of which look right:
  //
  //  - The rules this replaces named `raw-loader`, which is NOT a dependency
  //    of this project and never has been. Nothing had ever imported a .glsl,
  //    so the config had never once been exercised.
  //  - Turbopack's built-in `type: "raw"`, which the Next 16 typings describe
  //    as "return raw file contents as a string", resolves the import to
  //    `undefined`. Nothing fails: `next build` succeeds, the chunk ships, and
  //    the material reaches the GPU as `wgslFn(void 0)` and draws nothing.
  //    (`type: "text"` is in the typings but not in the runtime's list at all.)
  //
  // So: our own four-line loader, ./scripts/wgsl-loader.cjs. The import is
  // asserted end-to-end in src/shaders/wgsl-contract.test.ts, because a shader
  // that arrives as `undefined` is invisible to every other kind of check.
  //
  // See src/types/wgsl.d.ts for the other three places that have to agree
  // (TypeScript, vitest, the esbuild-driven scripts).
  turbopack: {
    rules: {
      "*.wgsl": { loaders: ["./scripts/wgsl-loader.cjs"], as: "*.js" },
      "*.glsl": { loaders: ["./scripts/wgsl-loader.cjs"], as: "*.js" },
      "*.vert": { loaders: ["./scripts/wgsl-loader.cjs"], as: "*.js" },
      "*.frag": { loaders: ["./scripts/wgsl-loader.cjs"], as: "*.js" },
    },
  },

  // Cache headers — fingerprinted assets get long-lived cache, HTML stays fresh
  async headers() {
    const isDev = process.env.NODE_ENV === "development";

    return [
      // Next.js static assets (fingerprinted — safe to cache forever)
      // Only apply this in production so it doesn't break HMR in development
      ...(isDev
        ? []
        : [
            {
              source: "/_next/static/(.*)",
              headers: [
                {
                  key: "Cache-Control",
                  value: "public, max-age=31536000, immutable",
                },
              ],
            },
          ]),
      // Public static assets (images, fonts, etc.)
      {
        source: "/(.*\\.(?:png|jpg|jpeg|gif|svg|ico|woff2|woff|ttf|mp3|wav|ogg|webp|avif))",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      // HTML pages — no cache (always fresh)
      {
        source: "/((?!_next/static|.*\\.(?:png|jpg|jpeg|gif|svg|ico|woff2|woff|ttf)).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },

  // Block /admin route in production (Cloudflare)
  async redirects() {
    if (process.env.NODE_ENV !== "development") {
      return [
        {
          source: "/admin/:path*",
          destination: "/",
          permanent: false,
        },
        {
          source: "/admin",
          destination: "/",
          permanent: false,
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
