// Minimal, secure preload. Exposes a tiny read-only surface so the web app can
// detect it is running inside the Ward desktop shell. No Node APIs are leaked.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("ward", {
  desktop: true,
  platform: process.platform,
  version: "1.0.0",
});
