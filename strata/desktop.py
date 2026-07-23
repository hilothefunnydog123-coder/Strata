"""Strata Desktop — the native, downloadable evidence-intelligence workstation.

A doctor between appointments, a pharmacist at the counter, or a medical-affairs analyst on a
locked-down hospital laptop opens one app, types a claim, and gets a graded, sourced verdict —
no browser, no account, and **nothing leaving the machine**. That last property is the whole
point: Strata reads only *public* literature, so it runs entirely on-prem and never touches a
patient record. The desktop app is that engine wrapped in a native control panel.

Two layers, deliberately separated so the logic is testable without a display:

* :class:`ServerController` — starts/stops the local Strata server on a background thread,
  auto-selecting a free port, and calls its own API. No GUI, unit-tested headless.
* :class:`StrataDesktop` — a Tkinter (standard-library) control panel over that controller:
  a Home tab (server status + one-click Console / Verify / Evidence Graph), an inline **Verify**
  tab (claim in, graded receipt out), **Settings** (issue an API key, optional AI, require-key,
  data folder), and an honest **About**.

Zero third-party runtime dependencies. Packaged into a single-file executable with PyInstaller
(see ``packaging/`` and ``docs/desktop.md``). Not a medical device; decision support only.
"""
from __future__ import annotations

import json
import os
import socket
import threading
import urllib.error
import urllib.request
import webbrowser

APP_NAME = "Strata Desktop"

# brand palette (kept close to the web surfaces)
BG = "#0b1220"
BG2 = "#0e1626"
PANEL = "#101b2e"
LINE = "#22304a"
INK = "#eaf2f0"
DIM = "#9fb0ae"
GREEN = "#38e6a6"
AMBER = "#ffc24b"
RED = "#ff5d73"
BLUE = "#5cc8ff"

_STATUS_COLOR = {"Supported": GREEN, "Mixed": AMBER, "Contradicted": RED,
                 "Insufficient": DIM, "Unsupported": DIM}


# ============================================================ headless server control
class ServerController:
    """Run the local Strata server on a thread and talk to it. No display required."""

    def __init__(self, host: str = "127.0.0.1"):
        self.host = host
        self.port: int | None = None
        self._httpd = None
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self._httpd is not None

    @property
    def url(self) -> str | None:
        return f"http://{self.host}:{self.port}" if self.port else None

    def start(self, port: int = 8600, *, seed: bool = True) -> str:
        """Boot the server, auto-selecting the first free port at or above ``port``."""
        if self.running:
            return self.url  # type: ignore[return-value]
        from http.server import ThreadingHTTPServer

        from . import demo, server
        if seed:
            try:
                demo.ensure_seeded()
            except Exception:
                pass
        last_err: Exception | None = None
        for p in range(port, port + 25):
            try:
                self._httpd = ThreadingHTTPServer((self.host, p), server._handler())
                self.port = p
                break
            except OSError as exc:
                last_err = exc
                continue
        if self._httpd is None:
            raise last_err or OSError("no free port found")
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return self.url  # type: ignore[return-value]

    def stop(self) -> None:
        if self._httpd is not None:
            try:
                self._httpd.shutdown()
                self._httpd.server_close()
            finally:
                self._httpd = None
                self.port = None

    def api(self, path: str, method: str = "GET", body: dict | None = None, timeout: int = 90) -> dict:
        """Call the local server. Returns parsed JSON, or {'error': ...} — never raises."""
        if not self.url:
            return {"error": "server not running"}
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data,
                                     headers={"Content-Type": "application/json"}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:   # localhost: bypasses any proxy
                return json.loads(r.read())
        except urllib.error.HTTPError as exc:
            try:
                return json.loads(exc.read())
            except Exception:
                return {"error": f"HTTP {exc.code}"}
        except Exception as exc:
            return {"error": str(exc)}

    def health(self) -> dict:
        return self.api("/v1/health")

    def data_dir(self) -> str:
        from . import store
        return str(store.home())


def _port_is_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) != 0


# ============================================================ the Tkinter control panel
class StrataDesktop:
    """The native window. Imported lazily so headless use of ServerController stays clean."""

    def __init__(self, *, port: int = 8600):
        import tkinter as tk
        from tkinter import ttk

        from . import __version__
        self.tk, self.ttk = tk, ttk
        self.version = __version__
        self.ctl = ServerController()
        self.default_port = port

        self.root = tk.Tk()
        self.root.title(f"{APP_NAME} · Evidence Intelligence")
        self.root.geometry("780x600")
        self.root.minsize(680, 540)
        self.root.configure(bg=BG)
        self._init_style()
        self._build_header()
        self._build_tabs()
        self._build_footer()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        self._autostart()

    # ---- styling ----
    def _init_style(self):
        st = self.ttk.Style()
        try:
            st.theme_use("clam")
        except Exception:
            pass
        st.configure(".", background=BG, foreground=INK, fieldbackground=BG2,
                     bordercolor=LINE, font=("Segoe UI", 10))
        st.configure("TFrame", background=BG)
        st.configure("Card.TFrame", background=PANEL)
        st.configure("TLabel", background=BG, foreground=INK)
        st.configure("Card.TLabel", background=PANEL, foreground=INK)
        st.configure("Dim.TLabel", background=BG, foreground=DIM)
        st.configure("CardDim.TLabel", background=PANEL, foreground=DIM)
        st.configure("H.TLabel", background=BG, foreground=INK, font=("Segoe UI", 15, "bold"))
        st.configure("Mono.TLabel", background=PANEL, foreground=GREEN, font=("Consolas", 11))
        st.configure("TNotebook", background=BG, borderwidth=0)
        st.configure("TNotebook.Tab", background=BG2, foreground=DIM, padding=(16, 8),
                     font=("Segoe UI", 10, "bold"))
        st.map("TNotebook.Tab", background=[("selected", PANEL)], foreground=[("selected", GREEN)])
        st.configure("Accent.TButton", background=GREEN, foreground="#03140d",
                     font=("Segoe UI", 10, "bold"), borderwidth=0, padding=(14, 8))
        st.map("Accent.TButton", background=[("active", "#2bd196")])
        st.configure("Ghost.TButton", background=BG2, foreground=INK, borderwidth=1,
                     padding=(12, 7))
        st.map("Ghost.TButton", background=[("active", PANEL)])
        st.configure("TEntry", fieldbackground=BG2, foreground=INK, insertcolor=INK,
                     bordercolor=LINE)
        st.configure("TCheckbutton", background=PANEL, foreground=INK)

    # ---- header ----
    def _build_header(self):
        tk = self.tk
        head = self.ttk.Frame(self.root)
        head.pack(fill="x", padx=16, pady=(14, 8))
        c = tk.Canvas(head, width=34, height=34, bg=BG, highlightthickness=0)
        c.create_rectangle(4, 8, 18, 12, fill=GREEN, outline="")
        c.create_rectangle(4, 15, 24, 19, fill=AMBER, outline="")
        c.create_rectangle(4, 22, 30, 26, fill=RED, outline="")
        c.pack(side="left")
        self.ttk.Label(head, text="Strata", style="H.TLabel").pack(side="left", padx=(8, 6))
        self.ttk.Label(head, text=f"Desktop · v{self.version}", style="Dim.TLabel").pack(side="left")
        self.status_dot = tk.Canvas(head, width=12, height=12, bg=BG, highlightthickness=0)
        self.status_dot.pack(side="right")
        self._dot = self.status_dot.create_oval(2, 2, 10, 10, fill=DIM, outline="")
        self.status_lbl = self.ttk.Label(head, text="starting…", style="Dim.TLabel")
        self.status_lbl.pack(side="right", padx=(0, 8))

    # ---- tabs ----
    def _build_tabs(self):
        nb = self.ttk.Notebook(self.root)
        nb.pack(fill="both", expand=True, padx=16, pady=6)
        self._tab_home(nb)
        self._tab_verify(nb)
        self._tab_settings(nb)
        self._tab_about(nb)

    def _card(self, parent, pad=16):
        f = self.ttk.Frame(parent, style="Card.TFrame")
        f.pack(fill="x", pady=8)
        inner = self.ttk.Frame(f, style="Card.TFrame")
        inner.pack(fill="x", padx=pad, pady=pad)
        return inner

    def _tab_home(self, nb):
        tk = self.tk
        tab = self.ttk.Frame(nb)
        nb.add(tab, text="  Home  ")
        srv = self._card(tab)
        self.ttk.Label(srv, text="LOCAL SERVER", style="CardDim.TLabel",
                       font=("Consolas", 9)).pack(anchor="w")
        self.url_lbl = self.ttk.Label(srv, text="—", style="Mono.TLabel")
        self.url_lbl.pack(anchor="w", pady=(4, 10))
        row = self.ttk.Frame(srv, style="Card.TFrame")
        row.pack(fill="x")
        self.ttk.Label(row, text="Port", style="CardDim.TLabel").pack(side="left")
        self.port_var = tk.StringVar(value=str(self.default_port))
        self.ttk.Entry(row, textvariable=self.port_var, width=7).pack(side="left", padx=(8, 12))
        self.toggle_btn = self.ttk.Button(row, text="Stop", style="Ghost.TButton",
                                          command=self._toggle_server)
        self.toggle_btn.pack(side="left")
        self.sources_lbl = self.ttk.Label(srv, text="", style="CardDim.TLabel",
                                          font=("Consolas", 9))
        self.sources_lbl.pack(anchor="w", pady=(10, 0))

        act = self._card(tab)
        self.ttk.Label(act, text="OPEN", style="CardDim.TLabel",
                       font=("Consolas", 9)).pack(anchor="w", pady=(0, 8))
        grid = self.ttk.Frame(act, style="Card.TFrame")
        grid.pack(fill="x")
        for i, (label, path) in enumerate([("Console", "/console"), ("Verify", "/app"),
                                           ("Evidence Graph", "/graph"), ("API Docs", "/docs")]):
            b = self.ttk.Button(grid, text=label, style="Ghost.TButton",
                                command=lambda p=path: self._open(p))
            b.grid(row=0, column=i, padx=(0, 8), sticky="ew")
            grid.columnconfigure(i, weight=1)

        blurb = self.ttk.Label(
            tab, style="Dim.TLabel", wraplength=680, justify="left",
            text=("Everything runs on this machine. Strata reads only public medical literature — "
                  "it never connects to a patient record — so it is safe to run on-prem in a "
                  "hospital, pharmacy, or clinic. Verify a claim below or open the Console."))
        blurb.pack(anchor="w", pady=(6, 0))

    def _tab_verify(self, nb):
        tk = self.tk
        tab = self.ttk.Frame(nb)
        nb.add(tab, text="  Verify  ")
        top = self.ttk.Frame(tab)
        top.pack(fill="x", pady=(10, 6))
        self.claim_var = tk.StringVar()
        e = self.ttk.Entry(top, textvariable=self.claim_var, font=("Segoe UI", 11))
        e.pack(side="left", fill="x", expand=True, ipady=5)
        e.bind("<Return>", lambda _e: self._verify())
        self.ttk.Button(top, text="Verify", style="Accent.TButton",
                        command=self._verify).pack(side="left", padx=(8, 0))
        hint = self.ttk.Frame(tab)
        hint.pack(fill="x")
        for ex in ("Metformin reduces cardiovascular mortality in type 2 diabetes",
                   "SGLT2 inhibitors reduce heart-failure hospitalization"):
            self.ttk.Button(hint, text=ex[:38] + "…", style="Ghost.TButton",
                            command=lambda x=ex: (self.claim_var.set(x), self._verify())
                            ).pack(side="left", padx=(0, 6), pady=6)
        self.result = tk.Text(tab, bg=BG2, fg=INK, relief="flat", wrap="word",
                              font=("Segoe UI", 10), padx=14, pady=12, height=18,
                              insertbackground=INK, highlightthickness=1,
                              highlightbackground=LINE)
        self.result.pack(fill="both", expand=True, pady=(6, 0))
        self.result.configure(state="disabled")
        self._text_tags()
        self._set_result([("Type a medical claim above. Strata traces it to the research, "
                           "grades the evidence, and shows what supports and contradicts it.\n", "dim")])

    def _tab_settings(self, nb):
        tk = self.tk
        tab = self.ttk.Frame(nb)
        nb.add(tab, text="  Settings  ")
        key = self._card(tab)
        self.ttk.Label(key, text="API KEY", style="CardDim.TLabel",
                       font=("Consolas", 9)).pack(anchor="w")
        self.ttk.Label(key, style="CardDim.TLabel", wraplength=640, justify="left",
                       text="Issue a working key to call the local API from your own scripts.").pack(anchor="w", pady=(2, 8))
        self.key_lbl = self.ttk.Label(key, text="—", style="Mono.TLabel", wraplength=640)
        self.key_lbl.pack(anchor="w")
        krow = self.ttk.Frame(key, style="Card.TFrame")
        krow.pack(anchor="w", pady=(8, 0))
        self.ttk.Button(krow, text="Generate key", style="Ghost.TButton",
                        command=self._gen_key).pack(side="left")
        self.ttk.Button(krow, text="Copy", style="Ghost.TButton",
                        command=self._copy_key).pack(side="left", padx=(8, 0))

        ai = self._card(tab)
        self.ttk.Label(ai, text="OPTIONAL AI", style="CardDim.TLabel",
                       font=("Consolas", 9)).pack(anchor="w")
        self.ttk.Label(ai, style="CardDim.TLabel", wraplength=640, justify="left",
                       text=("Paste an OpenAI-compatible key (Groq, Gemini free tiers) to sharpen "
                             "borderline calls. It only ever sees public abstracts, and Strata works "
                             "fully without it. Applies to new verifications.")).pack(anchor="w", pady=(2, 8))
        self.ai_var = tk.StringVar(value=os.environ.get("STRATA_LLM_KEY", ""))
        arow = self.ttk.Frame(ai, style="Card.TFrame")
        arow.pack(anchor="w", fill="x")
        self.ttk.Entry(arow, textvariable=self.ai_var, show="•", width=44).pack(side="left", fill="x", expand=True)
        self.ttk.Button(arow, text="Save", style="Ghost.TButton",
                        command=self._save_ai).pack(side="left", padx=(8, 0))

        data = self._card(tab)
        self.ttk.Label(data, text="DATA", style="CardDim.TLabel",
                       font=("Consolas", 9)).pack(anchor="w")
        self.ttk.Label(data, text=self.ctl.data_dir(), style="CardDim.TLabel",
                       font=("Consolas", 9), wraplength=640).pack(anchor="w", pady=(4, 8))
        self.ttk.Button(data, text="Open data folder", style="Ghost.TButton",
                        command=self._open_data).pack(anchor="w")

    def _tab_about(self, nb):
        tab = self.ttk.Frame(nb)
        nb.add(tab, text="  About  ")
        box = self._card(tab)
        self.ttk.Label(box, text="Strata Desktop", style="Card.TLabel",
                       font=("Segoe UI", 14, "bold")).pack(anchor="w")
        self.ttk.Label(box, text=f"Version {self.version}", style="CardDim.TLabel").pack(anchor="w", pady=(2, 10))
        self.ttk.Label(box, style="CardDim.TLabel", wraplength=640, justify="left",
                       text=("Continuous evidence intelligence for medical AI and healthcare. Strata "
                             "appraises published literature for decision support. It is NOT a medical "
                             "device, handles NO patient data, and does not diagnose, treat, advise, or "
                             "determine truth. Every verdict links to its primary sources for independent "
                             "review. Evidence assessments are transparent heuristics.")).pack(anchor="w")
        lrow = self.ttk.Frame(box, style="Card.TFrame")
        lrow.pack(anchor="w", pady=(12, 0))
        self.ttk.Button(lrow, text="Trust & security", style="Ghost.TButton",
                        command=lambda: self._open("/trust")).pack(side="left")
        self.ttk.Button(lrow, text="How it works", style="Ghost.TButton",
                        command=lambda: self._open("/why")).pack(side="left", padx=(8, 0))

    def _build_footer(self):
        self.ttk.Label(self.root, style="Dim.TLabel", font=("Segoe UI", 8),
                       text="Runs locally · no patient data · not a medical device"
                       ).pack(pady=(0, 8))

    # ---- server control ----
    def _autostart(self):
        try:
            port = int(self.port_var.get())
        except (ValueError, AttributeError):
            port = self.default_port
        threading.Thread(target=self._do_start, args=(port,), daemon=True).start()

    def _do_start(self, port):
        try:
            self.ctl.start(port)
            self.root.after(0, self._on_started)
        except Exception as exc:
            self.root.after(0, lambda: self._set_status(RED, f"failed: {exc}"))

    def _on_started(self):
        self.url_lbl.configure(text=self.ctl.url or "—")
        self.port_var.set(str(self.ctl.port))
        self.toggle_btn.configure(text="Stop")
        self._set_status(GREEN, "running")
        self._poll_health()

    def _toggle_server(self):
        if self.ctl.running:
            self.ctl.stop()
            self.url_lbl.configure(text="—")
            self.sources_lbl.configure(text="")
            self.toggle_btn.configure(text="Start")
            self._set_status(DIM, "stopped")
        else:
            self._set_status(AMBER, "starting…")
            try:
                port = int(self.port_var.get())
            except ValueError:
                port = self.default_port
            threading.Thread(target=self._do_start, args=(port,), daemon=True).start()

    def _poll_health(self):
        if not self.ctl.running:
            return

        def work():
            h = self.ctl.health()
            self.root.after(0, lambda: self._show_health(h))
        threading.Thread(target=work, daemon=True).start()

    def _show_health(self, h):
        if h.get("error"):
            self._set_status(AMBER, "starting…")
        else:
            srcs = " · ".join(h.get("sources", []) or [])
            ai = "AI on" if h.get("ai") else "heuristics"
            self.sources_lbl.configure(text=f"sources: {srcs}   ·   {ai}")
            self._set_status(GREEN, "running")
        if self.ctl.running:
            self.root.after(5000, self._poll_health)

    def _set_status(self, color, text):
        self.status_dot.itemconfigure(self._dot, fill=color)
        self.status_lbl.configure(text=text)

    # ---- verify ----
    def _verify(self):
        claim = (self.claim_var.get() or "").strip()
        if not claim:
            return
        if not self.ctl.running:
            self._set_result([("Server is not running — start it on the Home tab.\n", "warn")])
            return
        self._set_result([("Verifying — searching the literature…\n", "dim")])

        def work():
            r = self.ctl.api("/v1/verify", "POST", {"claim": claim})
            self.root.after(0, lambda: self._render_receipt(claim, r))
        threading.Thread(target=work, daemon=True).start()

    def _render_receipt(self, claim, r):
        if r.get("error"):
            self._set_result([(f"Could not verify: {r['error']}\n", "warn")])
            return
        status = r.get("status", "—")
        col = {"Supported": "green", "Mixed": "amber", "Contradicted": "red",
               "Insufficient": "dim", "Unsupported": "dim"}.get(status, "dim")
        lines = [(f"“{claim}”\n\n", "claim"),
                 (f"{status.upper()}", col),
                 (f"   ·   {str(r.get('strength', '')).upper()} certainty   ·   "
                  f"{int(round((r.get('confidence') or 0) * 100))}% confidence\n\n", "dim"),
                 (f"▲ {r.get('supporting', 0)} supporting     ", "green"),
                 (f"▼ {r.get('contradicting', 0)} contradicting     ", "red"),
                 (f"◦ {r.get('neutral', 0)} neutral\n", "dim")]
        sr = r.get("strength_rationale") or {}
        if sr.get("summary"):
            lines.append(("\n" + sr["summary"] + "\n", "body"))
        if r.get("key_limitation"):
            lines.append(("\n⚠ " + r["key_limitation"] + "\n", "warn"))
        cites = r.get("citations") or []
        if cites:
            lines.append(("\nTop evidence:\n", "dimhead"))
            gly = {"support": "▲", "contradict": "▼", "neutral": "◦"}
            for c in cites[:5]:
                g = gly.get(c.get("stance"), "◦")
                lines.append((f"  {g} [{c.get('label', '')}, {c.get('year') or 'n.d.'}] "
                              f"{(c.get('title') or '')[:70]}\n", "body"))
        lines.append(("\nDecision support only — read the sources. Not medical advice.\n", "fine"))
        self._set_result(lines)

    def _text_tags(self):
        t = self.result
        t.tag_configure("claim", font=("Segoe UI", 12, "bold"), foreground=INK)
        t.tag_configure("green", foreground=GREEN, font=("Segoe UI", 13, "bold"))
        t.tag_configure("amber", foreground=AMBER, font=("Segoe UI", 13, "bold"))
        t.tag_configure("red", foreground=RED, font=("Segoe UI", 13, "bold"))
        t.tag_configure("dim", foreground=DIM)
        t.tag_configure("dimhead", foreground=DIM, font=("Segoe UI", 9, "bold"))
        t.tag_configure("body", foreground=INK)
        t.tag_configure("warn", foreground=AMBER)
        t.tag_configure("fine", foreground=DIM, font=("Segoe UI", 8))

    def _set_result(self, segments):
        self.result.configure(state="normal")
        self.result.delete("1.0", "end")
        for text, tag in segments:
            self.result.insert("end", text, tag)
        self.result.configure(state="disabled")

    # ---- settings actions ----
    def _gen_key(self):
        r = self.ctl.api("/v1/keys", "POST", {"label": "desktop"})
        self._key = r.get("key")
        self.key_lbl.configure(text=self._key or r.get("error", "could not issue key"))

    def _copy_key(self):
        if getattr(self, "_key", None):
            self.root.clipboard_clear()
            self.root.clipboard_append(self._key)

    def _save_ai(self):
        val = (self.ai_var.get() or "").strip()
        if val:
            os.environ["STRATA_LLM_KEY"] = val
        else:
            os.environ.pop("STRATA_LLM_KEY", None)

    def _open_data(self):
        path = self.ctl.data_dir()
        try:
            os.makedirs(path, exist_ok=True)
            webbrowser.open("file://" + os.path.abspath(path))
        except Exception:
            pass

    # ---- misc ----
    def _open(self, path):
        if not self.ctl.running:
            self._toggle_server()
        if self.ctl.url:
            webbrowser.open(self.ctl.url + path)

    def _on_close(self):
        try:
            self.ctl.stop()
        finally:
            self.root.destroy()

    def run(self):
        self.root.mainloop()


def main(argv=None) -> int:
    """Entry point for `strata desktop` and the packaged executable."""
    try:
        import tkinter  # noqa: F401
    except Exception:
        print(f"{APP_NAME} needs a graphical desktop (Tkinter is unavailable here).")
        print("On a headless machine, run the server directly:  strata serve")
        return 1
    try:
        StrataDesktop().run()
        return 0
    except Exception as exc:                       # pragma: no cover - display/runtime issues
        print(f"{APP_NAME} could not start: {exc}")
        print("Fallback:  strata serve   (then open http://127.0.0.1:8600)")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
