"""Outbound notifications — honest about whether anything was actually sent.

Demo requests are always persisted to the database. Email delivery is attempted
only if SMTP is configured via environment (``STRATA_SMTP_HOST`` etc.); if it is
not, the request is stored and clearly marked *not delivered* rather than
pretending a mail went out. No secrets are ever placed in client-side code.

    STRATA_SMTP_HOST, STRATA_SMTP_PORT, STRATA_SMTP_USER, STRATA_SMTP_PASSWORD
    STRATA_DEMO_RECIPIENT   (default: d.lake003@gmail.com)
    STRATA_SMTP_FROM        (default: STRATA_SMTP_USER or no-reply@strata.local)
"""
from __future__ import annotations

import os
from typing import Any, Dict, Tuple

DEFAULT_RECIPIENT = "d.lake003@gmail.com"


def _smtp_configured() -> bool:
    return bool(os.environ.get("STRATA_SMTP_HOST"))


def deliver_demo_request(req: Dict[str, Any]) -> Tuple[bool, str]:
    """Try to email a demo request. Returns (delivered, note)."""
    recipient = os.environ.get("STRATA_DEMO_RECIPIENT", DEFAULT_RECIPIENT)
    body = _format(req, recipient)
    if not _smtp_configured():
        return (False, f"Stored only — SMTP not configured; would notify {recipient}. "
                       f"Set STRATA_SMTP_HOST to enable email.")
    try:
        _send_smtp(recipient, f"[Strata] Demo request from {req.get('organization') or req.get('email')}",
                   body)
        return (True, f"Emailed to {recipient}.")
    except Exception as exc:  # never crash the request path on a mail failure
        return (False, f"Stored; email attempt failed: {type(exc).__name__}: {exc}")


def _format(req: Dict[str, Any], recipient: str) -> str:
    lines = ["New Strata demo request:", ""]
    for key in ("name", "email", "organization", "role", "company", "use_case"):
        lines.append(f"  {key.replace('_', ' ').title()}: {req.get(key, '')}")
    lines += ["", f"(routed to {recipient})"]
    return "\n".join(lines)


def _send_smtp(to_addr: str, subject: str, body: str) -> None:
    import smtplib
    from email.message import EmailMessage

    host = os.environ["STRATA_SMTP_HOST"]
    port = int(os.environ.get("STRATA_SMTP_PORT", "587"))
    user = os.environ.get("STRATA_SMTP_USER")
    pw = os.environ.get("STRATA_SMTP_PASSWORD")
    sender = os.environ.get("STRATA_SMTP_FROM", user or "no-reply@strata.local")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_addr
    msg.set_content(body)

    with smtplib.SMTP(host, port, timeout=15) as s:
        s.starttls()
        if user and pw:
            s.login(user, pw)
        s.send_message(msg)
