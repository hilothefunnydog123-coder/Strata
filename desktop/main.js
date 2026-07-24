// Ward Console — Electron main process.
//
// Runs the Ward control plane as a native desktop application. Hospitals launch
// the app, sign in, and get the full console (registry, monitoring, validation,
// governance, agent oversight, ROI) in a dedicated window.
//
// Modes:
//   WARD_DEV=1     -> load the running Next dev server (http://localhost:3000)
//   default        -> boot the bundled Next standalone server and load it

const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const DEV = process.env.WARD_DEV === "1";
const PORT = Number(process.env.WARD_PORT || 4477);
const HOST = "127.0.0.1";

let serverProc = null;

function standaloneDir() {
  // When packaged, the standalone server is shipped as an extra resource.
  if (app.isPackaged) return path.join(process.resourcesPath, "app", "standalone");
  return path.join(__dirname, "..", ".next", "standalone");
}

function startServer() {
  const dir = standaloneDir();
  const serverJs = path.join(dir, "server.js");
  serverProc = spawn(process.execPath, [serverJs], {
    cwd: dir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: HOST,
    },
    stdio: "inherit",
  });
  serverProc.on("error", (e) => console.error("[ward] server error:", e));
}

function waitForServer(url, done, tries = 0) {
  const req = http.get(url, (res) => {
    res.resume();
    done();
  });
  req.on("error", () => {
    if (tries > 80) return done(new Error("Ward server did not start in time."));
    setTimeout(() => waitForServer(url, done, tries + 1), 500);
  });
}

function createWindow(startUrl) {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#080b10",
    title: "Ward",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.loadURL(startUrl);

  // Open external links (mailto:, https) in the system browser, keep app links internal.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://" + HOST) || url.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

function buildMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  const base = DEV ? "http://localhost:3000" : `http://${HOST}:${PORT}`;
  const boot = () => createWindow(base + "/login");

  if (DEV) {
    boot();
  } else {
    startServer();
    waitForServer(base + "/login", (err) => {
      if (err) console.error("[ward]", err.message);
      boot();
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });
});

function cleanup() {
  if (serverProc) {
    try {
      serverProc.kill();
    } catch {}
    serverProc = null;
  }
}

app.on("window-all-closed", () => {
  cleanup();
  if (process.platform !== "darwin") app.quit();
});
app.on("quit", cleanup);
app.on("before-quit", cleanup);
