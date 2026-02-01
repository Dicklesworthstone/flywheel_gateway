import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import {
  defineConfig,
  loadEnv,
  type Plugin,
  type PluginOption,
  type UserConfig,
} from "vite";

type CompilerStats = {
  compiled: number;
  diagnostics: number;
  errors: number;
  skipped: number;
  pipelineErrors: number;
  timing: number;
};

type CompilerLogEvent = {
  kind?: string;
  detail?: unknown;
};

const isCompilerLogEvent = (event: unknown): event is CompilerLogEvent =>
  typeof event === "object" && event !== null && "kind" in event;

const createCompilerLogger = (stats: CompilerStats) => ({
  logEvent(filename: string | null, event: unknown) {
    const normalized = isCompilerLogEvent(event)
      ? event
      : ({ kind: "Unknown" } as CompilerLogEvent);
    const kind = normalized.kind ?? "Unknown";

    if (kind === "CompileSuccess") stats.compiled += 1;
    if (kind === "CompileDiagnostic") stats.diagnostics += 1;
    if (kind === "CompileError") stats.errors += 1;
    if (kind === "CompileSkip") stats.skipped += 1;
    if (kind === "PipelineError") stats.pipelineErrors += 1;
    if (kind === "Timing") stats.timing += 1;

    if (kind === "CompileSkip") {
      const reason = filename?.includes("node_modules")
        ? "node_modules"
        : "unknown";
      console.debug("[Compiler] Skipped", {
        filename,
        reason,
        event: normalized,
      });
    }

    if (kind === "CompileDiagnostic") {
      const detail = normalized.detail;
      console.warn("[Compiler] Diagnostic", {
        filename,
        event: normalized,
        detail,
        detailText: detail ? String(detail) : undefined,
      });
    }

    if (kind === "CompileError" || kind === "PipelineError") {
      const detail = normalized.detail;
      console.error("[Compiler] Error", {
        filename,
        event: normalized,
        detail,
        detailText: detail ? String(detail) : undefined,
      });
    }
  },
});

const compilerStatsPlugin = (
  stats: CompilerStats,
  enabled: boolean,
): Plugin => ({
  name: "react-compiler-stats",
  apply: "build",
  closeBundle() {
    if (!enabled) return;
    console.info("[Compiler] Build summary", {
      compiled: stats.compiled,
      diagnostics: stats.diagnostics,
      errors: stats.errors,
      skipped: stats.skipped,
      pipelineErrors: stats.pipelineErrors,
      timing: stats.timing,
    });
  },
});

// Using type assertion due to vite plugin type incompatibility from duplicate vite versions in bun
export default defineConfig(({ mode }): UserConfig => {
  const env = loadEnv(mode, process.cwd(), "");
  const nodeEnv = env["NODE_ENV"] ?? process.env["NODE_ENV"] ?? mode;
  const isProd = nodeEnv === "production";
  const disableCompiler = env["VITE_DISABLE_COMPILER"] === "true";
  const compilerEnabled = !disableCompiler;
  const gatewayTarget = env["VITE_GATEWAY_TARGET"] ?? "http://127.0.0.1:3000";

  if (!isProd) {
    console.debug(`[Compiler] ${compilerEnabled ? "Enabled" : "Disabled"}`);
  }

  const compilerStats: CompilerStats = {
    compiled: 0,
    diagnostics: 0,
    errors: 0,
    skipped: 0,
    pipelineErrors: 0,
    timing: 0,
  };

  const reactCompilerBabelConfig = compilerEnabled
    ? {
        babel: {
          plugins: [
            [
              "babel-plugin-react-compiler",
              {
                target: "19",
                logger: createCompilerLogger(compilerStats),
                // Enable source map support for debugging
                // The compiler is still best-effort: keep it scoped to UI components
                // until it can reliably lower common hook/page patterns (try/finally, refs, etc).
                sources: (filename: string) => {
                  const normalized = filename.replaceAll("\\", "/");
                  if (!normalized.includes("/src/components/")) return false;

                  // The compiler currently treats cloneElement/ref patterns as invalid "ref access during render".
                  if (normalized.endsWith("/src/components/ui/Tooltip.tsx")) {
                    return false;
                  }

                  return true;
                },
              },
            ],
          ],
        },
      }
    : {};

  return {
    // Cast due to duplicate vite versions in node_modules causing Plugin type incompatibility
    plugins: [
      tailwindcss(),
      react(reactCompilerBabelConfig),
      compilerStatsPlugin(compilerStats, compilerEnabled),
    ] as PluginOption[],

    server: {
      port: 5173,
      proxy: {
        // The gateway mounts routes at the root (e.g. /agents, /notifications, /ws)
        // while the web app uses /api/* and /api/v1/* prefixes.
        "/api/v1": {
          target: gatewayTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/v1/, "") || "/",
        },
        "/api": {
          target: gatewayTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, "") || "/",
        },
        "/ws": {
          target: gatewayTarget,
          ws: true,
          changeOrigin: true,
        },
      },
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
              ? chunkInfo.facadeModuleId
                  .split("/")
                  .pop()
                  ?.replace(".tsx", "")
                  .replace(".ts", "")
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
      plugins: () => [react(reactCompilerBabelConfig)],
    },

    // Enable experimental features
    experimental: {
      // Render optimization
      renderBuiltUrl(
        _filename,
        { hostId: _hostId, hostType: _hostType, type: _type },
      ) {
        // Use relative paths for assets
        return { relative: true };
      },
    },

    // Define global constants
    define: {
      __DEV__: JSON.stringify(!isProd),
      __PERF_MONITORING__: JSON.stringify(nodeEnv === "development"),
    },

    // esbuild options
    esbuild: {
      // Drop console.log in production
      drop: isProd ? ["console", "debugger"] : [],
      // Minify identifiers
      minifyIdentifiers: true,
      // Minify syntax
      minifySyntax: true,
      // Minify whitespace
      minifyWhitespace: true,
    },
  };
});
