import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PRODUCT } from "@assent/core";
import { useAuth } from "../state/auth";

/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628) — the desktop app never sees a
 * password. In production this screen:
 *
 *   1. POSTs to the web dashboard `POST /api/device/code` → { device_code,
 *      user_code, verification_uri, interval, expires_in }.
 *   2. Shows the short `user_code` and asks the user to approve in their browser
 *      at `verification_uri` (they authenticate to the dashboard there, with TOTP).
 *   3. Polls `POST /api/device/token` every `interval` seconds until it returns
 *      an access + refresh token (or `authorization_pending` / `slow_down`).
 *   4. Stores the refresh token in the OS keychain via Tauri
 *      (tauri-plugin-stronghold / the `keyring` crate) — never in localStorage —
 *      and exchanges it for short-lived access tokens on demand.
 *
 * Here the polling loop is replaced by an explicit "approve" button so the flow
 * is demonstrable offline. No secret is ever entered in this window.
 */
function generateUserCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  const pick = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)] ?? "X").join("");
  return `${pick()}-${pick()}`;
}

export function DeviceAuth() {
  const { authed, approve } = useAuth();
  const navigate = useNavigate();
  const userCode = useMemo(generateUserCode, []);

  useEffect(() => {
    if (authed) navigate("/corpus", { replace: true });
  }, [authed, navigate]);

  const onApprove = () => {
    approve();
    navigate("/corpus", { replace: true });
  };

  return (
    <div className="d-auth">
      <div className="d-auth-card">
        <div className="d-auth-brand">{PRODUCT.desktopName}</div>
        <div className="d-auth-sub">Authorize this device to reach your account</div>

        <div className="d-auth-code" aria-label="Your device code">{userCode}</div>
        <div className="d-auth-verify">
          Enter this code at <b>{PRODUCT.domain}/activate</b>
        </div>

        <div className="d-auth-status">
          <span className="d-spinner" aria-hidden />
          Waiting for approval in your browser…
        </div>

        <button className="d-btn d-btn--primary" style={{ width: "100%" }} onClick={onApprove}>
          Simulate browser approval
        </button>

        <div className="d-auth-note">
          Device Authorization Grant (RFC 8628). The desktop app never asks for your password —
          you approve in the browser, and a refresh token is stored in the OS keychain (Tauri).
        </div>
      </div>
    </div>
  );
}
