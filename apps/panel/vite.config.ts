import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "next/link": path.resolve(__dirname, "./src/shims/next-link.tsx"),
      "next/navigation": path.resolve(__dirname, "./src/shims/next-navigation.ts"),
      "next/font/local": path.resolve(__dirname, "./src/shims/next-font.ts"),
    },
  },
  define: {
    "process.env.NEXT_PUBLIC_ADMIN_API_BASE": JSON.stringify("/admin/v1"),
    "process.env.NEXT_PUBLIC_UI_PATH": JSON.stringify(""),
    "process.env.NEXT_PUBLIC_API_MOCKS": JSON.stringify(""),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/admin": "http://127.0.0.1:8787",
      "/v1": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
    },
  },
});
