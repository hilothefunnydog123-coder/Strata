"""Strata Python SDK — the verification layer for medical AI, in ~60 lines.

Standard library only (urllib); drop it into any service.

    from strata_client import Strata
    strata = Strata(api_key="sk_live_...", base_url="https://api.your-strata.host")

    # Verify a single claim your AI just generated
    receipt = strata.verify("Metformin reduces cardiovascular mortality in type 2 diabetes")
    print(receipt["status"], receipt["strength"])          # e.g. "Supported moderate"
    if receipt["status"] in ("Contradicted", "Mixed"):
        ...  # gate or flag the AI's answer

    # Put a claim under continuous surveillance; poll for change events
    claim_id = strata.monitor("SGLT2 inhibitors reduce heart-failure hospitalization")["id"]
    change = strata.check(claim_id)["change"]
    for event in change["events"]:
        print(event["text"])                                # "Certainty upgraded: moderate → high"
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request


class StrataError(RuntimeError):
    pass


class Strata:
    def __init__(self, api_key: str | None = None,
                 base_url: str = "http://127.0.0.1:8600", timeout: int = 60):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _req(self, path: str, method: str = "GET", params=None, body=None):
        url = self.base_url + path
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if self.api_key:
            req.add_header("Authorization", "Bearer " + self.api_key)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            raise StrataError(f"{e.code}: {e.read().decode(errors='ignore')}") from None

    # ---- Verify ----
    def verify(self, claim: str) -> dict:
        """Return an Evidence Receipt for a single claim."""
        return self._req("/v1/verify", "POST", body={"claim": claim})

    # ---- Monitor ----
    def monitor(self, claim: str, tenant: str | None = None) -> dict:
        """Put a claim under continuous surveillance (registers + first check)."""
        return self._req("/v1/monitor/register", params={"claim": claim, "tenant": tenant})

    def check(self, claim_id: str) -> dict:
        """Re-verify a monitored claim; the response's 'change' holds any new events."""
        return self._req("/v1/monitor/check", params={"id": claim_id})

    def claims(self) -> dict:
        return self._req("/v1/monitor")

    def receipt(self, claim_id: str) -> dict:
        return self._req(f"/v1/receipt/{claim_id}")

    def seal_url(self, claim_id: str) -> str:
        """Public 'Evidence Verified' badge URL — embed as an <img>."""
        return f"{self.base_url}/v1/seal/{claim_id}.svg"

    def health(self) -> dict:
        return self._req("/v1/health")
