import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

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
          if (id.includes("recharts")) return "vendor-charts";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("react-dom") || id.includes("react-router")) return "vendor-react";
          if (id.includes("date-fns") || id.includes("xlsx")) return "vendor-utils";
        },
      },
    },
  },
}));
