/**
 * Strata JS/TS SDK — the verification layer for medical AI.
 * Zero dependencies; works in Node 18+ and the browser (global fetch).
 *
 *   import { Strata } from "./strata.js";
 *   const strata = new Strata({ apiKey: "sk_live_...", baseUrl: "https://api.your-strata.host" });
 *
 *   // Verify a claim your AI just produced
 *   const receipt = await strata.verify("Metformin reduces cardiovascular mortality in type 2 diabetes");
 *   if (receipt.status === "Contradicted" || receipt.status === "Mixed") {
 *     // gate, flag, or annotate the answer
 *   }
 *
 *   // Continuous surveillance
 *   const { id } = await strata.monitor("SGLT2 inhibitors reduce heart-failure hospitalization");
 *   const { change } = await strata.check(id);
 *   change.events.forEach(e => console.log(e.text)); // "Certainty upgraded: moderate → high"
 *
 *   // Embed the public trust badge:  <img src={strata.sealUrl(id)} alt="Evidence Verified" />
 */
export class Strata {
  constructor({ apiKey = null, baseUrl = "http://127.0.0.1:8600", timeout = 60000 } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeout = timeout;
  }

  async _req(path, { method = "GET", params, body } = {}) {
    let url = this.baseUrl + path;
    if (params) {
      const qs = Object.entries(params)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
      if (qs) url += "?" + qs;
    }
    const headers = { Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (this.apiKey) headers["Authorization"] = "Bearer " + this.apiKey;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeout);
    try {
      const res = await fetch(url, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } finally {
      clearTimeout(t);
    }
  }

  /** Evidence Receipt for a single claim. */
  verify(claim) {
    return this._req("/v1/verify", { method: "POST", body: { claim } });
  }

  /** Put a claim under continuous surveillance (registers + first check). */
  monitor(claim, tenant) {
    return this._req("/v1/monitor/register", { params: { claim, tenant } });
  }

  /** Re-verify a monitored claim; response.change holds any new events. */
  check(claimId) {
    return this._req("/v1/monitor/check", { params: { id: claimId } });
  }

  claims() {
    return this._req("/v1/monitor");
  }

  receipt(claimId) {
    return this._req(`/v1/receipt/${claimId}`);
  }

  /** Public 'Evidence Verified' badge URL — embed as an <img>. */
  sealUrl(claimId) {
    return `${this.baseUrl}/v1/seal/${claimId}.svg`;
  }

  health() {
    return this._req("/v1/health");
  }
}

export default Strata;
