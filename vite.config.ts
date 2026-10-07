import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { componentTagger } from "lovable-tagger";

// Stamped into the bundle so a cached/stale UI can be spotted against the
// commit the backend reports, instead of being diagnosed by hand.
function resolveBuildCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.trim();
  try {
    return execSync("git rev-parse HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const BUILD_COMMIT = resolveBuildCommit();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Electron production: relative paths (file://). Browser /app: absolute /app/ prefix.
  base: mode === "webapp" ? "/app/" : mode === "production" ? "./" : "/",
  server: {
    host: "::",
    port: 18080,
    strictPort: true,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  define: {
    __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // Match package dirs exactly — substring matches used to pull tiny shared
          // deps (clsx via recharts) into vendor-charts, forcing charts+xlsx into
          // the initial load. Keep heavy libs behind their own lazy chunks.
          // Tiny class utils are shared by recharts and the entry — without an
          // explicit home Rollup colocates them inside vendor-charts, which drags
          // the whole charts chunk into the initial load.
          if (
            /node_modules[\\/]clsx[\\/]/.test(id)
            || /node_modules[\\/]tailwind-merge[\\/]/.test(id)
            || /node_modules[\\/]class-variance-authority[\\/]/.test(id)
          ) {
            return "vendor-react";
          }
          if (/node_modules[\\/]recharts[\\/]/.test(id) || /node_modules[\\/]d3-[^\\/]+[\\/]/.test(id)) {
            return "vendor-charts";
          }
          if (/node_modules[\\/]xlsx[\\/]/.test(id)) return "vendor-xlsx";
          if (/node_modules[\\/]@radix-ui[\\/]/.test(id)) return "vendor-radix";
          if (
            /node_modules[\\/]react-dom[\\/]/.test(id)
            || /node_modules[\\/]react-router(-dom)?[\\/]/.test(id)
          ) {
            return "vendor-react";
          }
          if (/node_modules[\\/]date-fns[\\/]/.test(id)) return "vendor-datefns";
        },
      },
    },
  },
}));
