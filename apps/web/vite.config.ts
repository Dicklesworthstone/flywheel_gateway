import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
  },

  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },

  build: {
    // Target modern browsers for smaller bundles
    target: "esnext",

    // Generate source maps for production debugging (but don't ship)
    sourcemap: true,

    // Optimize chunk sizes
    chunkSizeWarningLimit: 500,

    rollupOptions: {
      output: {
        // Manual chunk splitting for optimal caching
        manualChunks: {
          // Core React - rarely changes, cache well
          "vendor-react": ["react", "react-dom"],

          // Router - separate chunk for route-based splitting
          "vendor-router": ["@tanstack/react-router"],

          // Query - data fetching layer
          "vendor-query": ["@tanstack/react-query"],

          // UI libraries
          "vendor-ui": ["framer-motion", "lucide-react"],

          // State management
          "vendor-state": ["zustand"],
        },

        // Consistent chunk naming for caching
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId
            ? chunkInfo.facadeModuleId.split("/").pop()?.replace(".tsx", "").replace(".ts", "")
            : "chunk";
          return `assets/${facadeModuleId}-[hash].js`;
        },

        // Asset file naming
        assetFileNames: (assetInfo) => {
          const ext = assetInfo.name?.split(".").pop() || "asset";
          if (ext === "css") {
            return "assets/styles-[hash].css";
          }
          return `assets/${ext}/[name]-[hash].[ext]`;
        },

        // Entry naming
        entryFileNames: "assets/[name]-[hash].js",
      },
    },

    // Minification settings
    minify: "esbuild",
    cssMinify: true,

    // Asset inlining threshold (4KB)
    assetsInlineLimit: 4096,

    // Report compressed sizes
    reportCompressedSize: true,
  },

  // Optimize dependencies
  optimizeDeps: {
    // Pre-bundle these for faster dev startup
    include: [
      "react",
      "react-dom",
      "@tanstack/react-router",
      "@tanstack/react-query",
      "zustand",
      "framer-motion",
      "lucide-react",
    ],
    // Exclude from pre-bundling (handled by other means)
    exclude: [],
  },

  // CSS optimization
  css: {
    devSourcemap: true,
  },

  // Worker configuration for web workers
  worker: {
    format: "es",
    plugins: () => [react()],
  },

  // Enable experimental features
  experimental: {
    // Render optimization
    renderBuiltUrl(filename, { hostId, hostType, type }) {
      // Use relative paths for assets
      return { relative: true };
    },
  },

  // Define global constants
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== "production"),
    __PERF_MONITORING__: JSON.stringify(process.env.NODE_ENV === "development"),
  },

  // esbuild options
  esbuild: {
    // Drop console.log in production
    drop: process.env.NODE_ENV === "production" ? ["console", "debugger"] : [],
    // Minify identifiers
    minifyIdentifiers: true,
    // Minify syntax
    minifySyntax: true,
    // Minify whitespace
    minifyWhitespace: true,
  },
});
