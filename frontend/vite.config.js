import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const devPort = Number(process.env.VITE_PORT || 3000);
const backendTarget = process.env.VITE_BACKEND_URL || "/api"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: devPort,
    proxy: {
      "/login": backendTarget,
      "/logout": backendTarget,
      "/api": backendTarget,
    },
  },
});
