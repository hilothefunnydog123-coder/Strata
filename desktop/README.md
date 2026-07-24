# Ward Console — Desktop App

The full Ward control plane packaged as a native desktop application (Electron).
Hospitals launch the app, sign in with their organization account, and get the entire
console in a dedicated window: registry, monitoring, validation, governance, agent
oversight, incidents, ROI, and settings.

The desktop app is intentionally isolated in this folder with its own `package.json` so
the web app's install and CI stay lightweight. Electron is only pulled in here.

## Run in development

In one terminal, start the web app from the repo root:

```bash
npm install
npm run dev            # serves the console on http://localhost:3000
```

In a second terminal, launch the desktop shell:

```bash
cd desktop
npm install            # installs Electron (first run downloads the runtime)
npm run dev            # opens the Ward desktop window on the dev server
```

The window boots to the sign-in screen. Use a demo account (password `ward-demo`):

- `elena.marsh@northstarhealth.org` — AI Governance Lead
- `alan.whitmore@northstarhealth.org` — Executive
- `james.okonkwo@northstarhealth.org` — Compliance Officer

## Run the production shell (bundled server)

Build the standalone server from the repo root, copy the static assets next to it, then
launch the desktop app without the dev server:

```bash
# from repo root
npm run build
cp -r .next/static .next/standalone/.next/static

# then
cd desktop
npm install
npm start              # boots the bundled Next server and loads it
```

`main.js` spawns the Next standalone server on `127.0.0.1:4477` using Electron's bundled
Node runtime and loads it once it is ready.

## Package installers

```bash
# from repo root, produce the standalone build first
npm run build
cp -r .next/static .next/standalone/.next/static

cd desktop
npm install
npm run build          # electron-builder -> desktop/dist/
```

`electron-builder` bundles `.next/standalone` (server + traced dependencies) and
`.next/static` as app resources. Build targets: `.dmg` (macOS), `NSIS` (Windows),
`AppImage` (Linux). Cross-platform installers must be built on, or configured for, the
target OS.

## Notes

- Authentication is a demo flow backed by `localStorage`. In production this authenticates
  against the enterprise identity provider (Okta / Entra) over SSO + SCIM.
- External links (mailto, https) open in the system browser; app navigation stays in-window.
