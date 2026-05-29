const { contextBridge } = require("electron");

function backendOrigin() {
  const prefix = "--mlbb-backend-origin=";
  const argument = process.argv.find((entry) => entry.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : "";
}

contextBridge.exposeInMainWorld("mlbbDesktop", {
  isDesktop: true,
  platform: process.platform,
  apiBase: backendOrigin(),
});
