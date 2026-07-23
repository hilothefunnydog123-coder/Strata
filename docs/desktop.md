# Strata Desktop

**The native, offline evidence-intelligence workstation.**

A downloadable app for the places that need evidence at the point of decision but can't send
data to the cloud — a doctor between appointments, a pharmacist at the counter, a
medical-affairs analyst on a locked-down hospital laptop. It runs the whole Strata engine
**on the machine**: type a medical claim, get a graded, sourced verdict — no browser, no
account, no data leaving the device.

## Why it's safe to run on-prem

Strata reads only **public medical literature** (PubMed, Europe PMC, ClinicalTrials.gov,
OpenAlex, Crossref). It does **not** connect to an EHR, a pharmacy system, or any patient
database, and it needs **no patient data** to work. The optional local *cohort* feature
aggregates a population profile on the device and never transmits it. That boundary is the
product: it is why Strata can sit inside a hospital's walls without touching PHI.

> Not a medical device. Decision support only. Every verdict links to its primary sources for
> independent review. See [Trust](/trust) and [Security](/security).

## Run it

**From the download** (see Releases): double-click `Strata` (macOS/Linux) or `Strata.exe`
(Windows). The control panel opens, the local server starts automatically, and you can verify
a claim on the **Verify** tab immediately.

**From source** (any machine with Python 3.9+ and Tk):

```bash
pip install strata-evidence
strata desktop          # or:  strata-desktop
```

On Linux, Tk ships separately: `sudo apt-get install -y python3-tk` (or your distro's
equivalent). On a headless server there's no display — run the web app instead:
`strata serve` and open `http://127.0.0.1:8600`.

## What's in the window

- **Home** — the local server's status and URL, a port field, Start/Stop, and one-click
  buttons to open the **Console** (Evidence Health), **Verify**, the **Evidence Graph**, and
  the **API docs** in your browser.
- **Verify** — type a claim (or pick an example); Strata streams the evidence pipeline and
  shows the status, certainty, supporting/contradicting counts, the *why-this-grade* summary,
  the key limitation, and the top citations — all in the app.
- **Settings** — issue a working local **API key**, paste an optional AI key (Groq/Gemini free
  tiers; it only ever sees public abstracts), and open the data folder.
- **About** — version and the honest disclaimer.

## Build the binaries yourself

PyInstaller produces a self-contained executable per OS (it builds for the OS it runs on):

```bash
pip install pyinstaller
python packaging/build.py            # -> dist/Strata  (or dist\Strata.exe)
# or directly:
pyinstaller packaging/strata_desktop.spec
```

The whole `strata` package is bundled (the app imports several submodules lazily), and the
build excludes heavy scientific libraries — it's a pure standard-library app, so the binary
stays small.

## Downloadable releases (CI)

`.github/workflows/desktop.yml` builds Windows, macOS, and Linux binaries on every version
tag (`vX.Y.Z`) and attaches them to the GitHub Release — that is the download link. It runs
the headless engine tests before packaging, so a release binary only ships if the engine is
green. Trigger a build without a tag from the Actions tab ("Build Strata Desktop" →
*Run workflow*); artifacts are attached to that run.

## Deployment notes for regulated settings

- **No PHI path.** Nothing in the desktop app requires or transmits patient data. Literature
  calls use a claim's keywords only.
- **Air-gapped / restricted networks.** Live literature search needs outbound HTTPS to the
  public sources. On a fully isolated network those calls fail *soft* (the app says so and
  never fabricates); the seeded demo evidence base still works offline for evaluation.
- **Data at rest.** Bibliographic metadata, grades, receipts, and monitored-claim history are
  stored under `~/.strata` (override with `STRATA_HOME`). No patient records are ever written.
- **Honest compliance posture.** Strata is not a medical device and holds no FDA/SOC 2/HIPAA
  certification today; it is architected to avoid PHI entirely. See [Trust](/trust).
