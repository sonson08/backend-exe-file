import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Warden - Your data. Your control.",
  description: "Your data. Your control.",
  version: "0.1.0",
  action: {
    default_title: "Warden - Your data. Your control.",
    default_icon: {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
    },
  },
  icons: {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  side_panel: {
    default_path: "index.html",
  },
  permissions: ["sidePanel", "storage", "alarms", "scripting"],
  host_permissions: [
    "http://127.0.0.1:11434/*",
    "http://localhost:11434/*",
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
  ],
});
