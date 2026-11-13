import { networkInterfaces } from "node:os";

import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const VIRTUAL_ADAPTER =
  /vethernet|wsl|vmware|virtualbox|vbox|docker|hyper-v|loopback|tap|tun|vpn|hamachi|zerotier|tailscale/i;
const PRIVATE_IPV4 = /^(192\.168|10|172\.(1[6-9]|2\d|3[01]))\./;

/** The address a phone on the same network can reach, skipping virtual adapters. */
function detectLanIp(): string | null {
  const addresses = Object.entries(networkInterfaces())
    .filter(([name]) => !VIRTUAL_ADAPTER.test(name))
    .flatMap(([, entries]) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .filter((address) => PRIVATE_IPV4.test(address));
  return addresses[0] ?? null;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // A phone cannot reach the backend's localhost, so every API call goes
  // through this server. 127.0.0.1 because Node may resolve localhost to ::1.
  const backend = env.BACKEND_URL || "http://127.0.0.1:8000";
  const proxy = {
    "/api": { target: backend, changeOrigin: true },
  };

  return {
    // The kiosk's screen wake lock, the camera and the microphone only work over HTTPS: `--mode https` on a LAN.
    plugins: [react(), tailwindcss(), ...(mode === "https" ? [basicSsl()] : [])],
    define: { __LAN_IP__: JSON.stringify(detectLanIp()) },
    server: { host: true, port: 5173, strictPort: true, proxy },
    preview: { host: true, port: 4173, strictPort: true, proxy },
    test: { include: ["src/**/*.test.ts"] },
  };
});
