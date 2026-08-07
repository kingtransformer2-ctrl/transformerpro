import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import viteCompression from "vite-plugin-compression";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "./" : "/",

  // ─── Dev Server ───────────────────────────────────────────────────────────
  server: {
    host: "0.0.0.0",       // Accept LAN / container connections
    port: 8080,
    strictPort: true,       // Crash instead of silently switching ports
    hmr: {
      clientPort: 8080,     // Keep HMR on the same port (important behind proxies)
    },
    proxy: {
      // Proxyrequests to avoid __cf_bm cookie rejections in dev
      "/-proxy": {
        target: "https://xxkyvelohybvcuidkuvs..co",
        changeOrigin: true,
        ws: true,           // Proxy WebSocket connections (Realtime)
        secure: true,
        rewrite: (path) => path.replace(/^\/-proxy/, ""),
        onProxyRes: (proxyRes) => {
          // Strip cookies that the browser rejects on a different domain
          delete proxyRes.headers["set-cookie"];
          // Fix NS_ERROR_CORRUPTED_CONTENT — remove compressed encoding header
          delete proxyRes.headers["content-encoding"];
        },
      },
    },
  },

  // ─── Plugins ──────────────────────────────────────────────────────────────
 plugins: [
  react(),

  viteCompression({
    algorithm: "brotliCompress",
    ext: ".br",
  }),

  viteCompression({
    algorithm: "gzip",
    ext: ".gz",
  }),

  ...(mode === "development" ? [componentTagger()] : []),

  VitePWA({
    registerType: "autoUpdate",
    includeAssets: ["favicon.ico", "apple-touch-icon.png", "masked-icon.svg"],
    manifest: {
      name: "Hotel POS",
      short_name: "POS",
      description: "Hotel Point of Sale System",
      theme_color: "#ffffff",
      background_color: "#ffffff",
      display: "standalone",
      icons: [
        {
          src: "pwa-192x192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "pwa-512x512.png",
          sizes: "512x512",
          type: "image/png",
        },
      ],
    },
    workbox: {
      navigateFallbackDenylist: [/^\/-proxy/, /^\/rest\//],

      runtimeCaching: [
        {
          urlPattern: ({ url }) =>
            url.origin === "https://xxkyvelohybvcuidkuvs..co" &&
            url.pathname.includes("/storage"),
          handler: "CacheFirst",
          options: {
            cacheName: "-images",
            expiration: {
              maxEntries: 100,
              maxAgeSeconds: 60 * 60 * 24 * 7,
            },
          },
        },
        {
          urlPattern: ({ url, request }) =>
            url.origin.includes(".co") &&
            request.method !== "GET",
          handler: "NetworkOnly",
        },
      ],
    },
  }),
],

  // ─── Path Aliases ─────────────────────────────────────────────────────────
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // ─── Dependency Pre-bundling ───────────────────────────────────────────────
  // Pre-bundle heavy deps so the browser gets one file instead of hundreds
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-router-dom",
      "@tanstack/react-query",
      "axios",
      "date-fns",
      "lucide-react",
    ],
  },

  // ─── Production Build ─────────────────────────────────────────────────────
  build: {
    target: "es2020",       // Modern JS — no legacy polyfills needed
    minify: "esbuild",      // Fastest minifier
    sourcemap: mode === "development", // Source maps in dev only
    chunkSizeWarningLimit: 1000,       // Suppress warnings under 1MB

    rollupOptions: {
      output: {
        // Split vendors into cacheable chunks so users don't re-download
        // everything when only one library changes
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          // Core React runtime
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router-dom/")
          ) {
            return "vendor-react";
          }

          // Data fetching & backend
          if (
            id.includes("/@tanstack/") ||
            id.includes("/@/") ||
            id.includes("/date-fns/")
          ) {
            return "vendor-data";
          }

          // UI components & icons
          if (
            id.includes("/@radix-ui/") ||
            id.includes("/lucide-react/") ||
            id.includes("/recharts/")
          ) {
            return "vendor-ui";
          }

          // Heavy print/export utilities — loaded on demand
          if (
            id.includes("/jspdf/") ||
            id.includes("/jspdf-autotable/") ||
            id.includes("/qrcode/") ||
            id.includes("/xlsx/")
          ) {
            return "vendor-print";
          }
        },
      },
    },
  },
}));
