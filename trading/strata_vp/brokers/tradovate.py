"""Tradovate adapter.

The path this account actually trades on. Everything here is REST over
`urllib`, so there is still nothing to install.

Before writing a line of code against it, check one thing with your prop firm:
**whether API access is enabled on your account at all.** Tradovate gates
automated access behind an API Access add on, and prop firms reselling
Tradovate make their own decision on top of that. Some allow it, some allow it
only on evaluation accounts, some not at all, and none of them advertise which.
An account that cannot place an API order will authenticate fine and reject
every order, so test against the demo host first, which is free:

    broker = TradovateBroker(credentials, live=False)
    broker.connect()
    print(broker.accounts())

Three details in here are not cosmetic:

  The bracket is one request. `placeOSO` sends the entry with its stop and
  target attached, so the protective stop exists at the exchange the moment the
  entry fills. Placing the entry and then the stop is two round trips with a
  naked position in between, and that gap is where an account dies when the
  connection drops.

  `isAutomated` is set on every order. Tradovate requires automated orders to
  declare themselves, and the flag is not optional in their terms of use.

  Authentication can answer with a penalty rather than a token. A `p-ticket`
  response means "wait `p-time` seconds and ask again with this ticket", and
  code that treats it as a failure will hammer the endpoint and get the account
  locked. It is handled below.

Bars come over the market data websocket, not REST, which is the one piece
that needs a dependency. `bars()` says so rather than pretending. Feed the
strategy from a CSV or another source until that is wired up: the engine takes
any callable that returns bars.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

from .base import Broker, BracketOrder, Position, Side

DEMO_HOST = "https://demo.tradovateapi.com/v1"
LIVE_HOST = "https://live.tradovateapi.com/v1"

Transport = Callable[[str, str, dict[str, Any] | None, dict[str, str]], dict[str, Any]]


@dataclass(frozen=True, slots=True)
class TradovateCredentials:
    name: str
    password: str
    app_id: str
    app_version: str
    cid: int
    sec: str
    device_id: str = "strata-vp"

    def as_payload(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "password": self.password,
            "appId": self.app_id,
            "appVersion": self.app_version,
            "cid": self.cid,
            "sec": self.sec,
            "deviceId": self.device_id,
        }


class TradovateError(RuntimeError):
    pass


def _urllib_transport(
    method: str, url: str, body: dict[str, Any] | None, headers: dict[str, str]
) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:400]
        raise TradovateError(f"{method} {url} returned {error.code}: {detail}") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise TradovateError(f"{method} {url} failed: {error}") from error
    if not raw:
        return {}
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, dict) else {"items": parsed}


@dataclass
class TradovateBroker(Broker):
    credentials: TradovateCredentials
    live: bool = False
    tick_size: float = 0.25
    transport: Transport = _urllib_transport
    sleep: Callable[[float], None] = time.sleep
    max_auth_attempts: int = 3

    access_token: str | None = field(default=None, init=False)
    md_access_token: str | None = field(default=None, init=False)
    expires_at: float = field(default=0.0, init=False)
    account_id: int | None = field(default=None, init=False)
    account_spec: str | None = field(default=None, init=False)
    _contracts: dict[str, int] = field(default_factory=dict, init=False)

    @property
    def host(self) -> str:
        return LIVE_HOST if self.live else DEMO_HOST

    # Authentication --------------------------------------------------------

    def connect(self) -> None:
        self._authenticate()
        accounts = self.accounts()
        if not accounts:
            raise TradovateError("authenticated but the account list is empty")
        first = accounts[0]
        self.account_id = int(first["id"])
        self.account_spec = str(first.get("name") or first.get("nickname") or first["id"])

    def _authenticate(self) -> None:
        payload = self.credentials.as_payload()
        for attempt in range(self.max_auth_attempts):
            response = self.transport(
                "POST",
                f"{self.host}/auth/accessTokenRequest",
                payload,
                {"Content-Type": "application/json"},
            )
            ticket = response.get("p-ticket")
            if ticket:
                # A throttling penalty, not a failure. Wait the stated time and
                # come back with the ticket. Retrying immediately is how an
                # account gets locked out.
                wait = float(response.get("p-time") or 60)
                if response.get("p-captcha"):
                    raise TradovateError(
                        "Tradovate is asking for a captcha. Log in through the web "
                        "terminal once by hand, then retry."
                    )
                self.sleep(wait)
                payload = {**self.credentials.as_payload(), "p-ticket": ticket}
                continue
            token = response.get("accessToken")
            if not token:
                raise TradovateError(
                    f"authentication failed: {response.get('errorText') or response}"
                )
            self.access_token = token
            self.md_access_token = response.get("mdAccessToken")
            # Tokens last about 80 minutes. Renew well before the edge.
            self.expires_at = time.monotonic() + 60 * 60
            return
        raise TradovateError("authentication kept returning a penalty ticket")

    def _headers(self) -> dict[str, str]:
        if self.access_token is None:
            raise TradovateError("call connect() first")
        if time.monotonic() > self.expires_at:
            self._renew()
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.access_token}",
        }

    def _renew(self) -> None:
        response = self.transport(
            "GET",
            f"{self.host}/auth/renewAccessToken",
            None,
            {"Authorization": f"Bearer {self.access_token}"},
        )
        token = response.get("accessToken")
        if not token:
            # A renewal that fails is recoverable by logging in again, and
            # silently continuing on a dead token is not.
            self._authenticate()
            return
        self.access_token = token
        self.md_access_token = response.get("mdAccessToken") or self.md_access_token
        self.expires_at = time.monotonic() + 60 * 60

    def _get(self, path: str) -> dict[str, Any]:
        return self.transport("GET", f"{self.host}{path}", None, self._headers())

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        return self.transport("POST", f"{self.host}{path}", body, self._headers())

    # Reference data --------------------------------------------------------

    def accounts(self) -> list[dict[str, Any]]:
        response = self._get("/account/list")
        items = response.get("items", response)
        return list(items) if isinstance(items, list) else []

    def contract_id(self, symbol: str) -> int:
        if symbol in self._contracts:
            return self._contracts[symbol]
        response = self._get(f"/contract/find?name={symbol}")
        identifier = response.get("id")
        if identifier is None:
            raise TradovateError(f"no contract named {symbol}")
        self._contracts[symbol] = int(identifier)
        return int(identifier)

    # Orders ----------------------------------------------------------------

    def submit(self, order: BracketOrder) -> str:
        self._validate(order)
        entry_action = "Buy" if order.side == "long" else "Sell"
        exit_action = "Sell" if order.side == "long" else "Buy"

        body: dict[str, Any] = {
            "accountSpec": self.account_spec,
            "accountId": self.account_id,
            "action": entry_action,
            "symbol": order.symbol,
            "orderQty": int(order.contracts),
            "isAutomated": True,
            "bracket1": {
                "action": exit_action,
                "orderType": "Stop",
                "stopPrice": self._tick(order.stop),
                "timeInForce": "GTC",
            },
            "bracket2": {
                "action": exit_action,
                "orderType": "Limit",
                "price": self._tick(order.target),
                "timeInForce": "GTC",
            },
        }
        if order.entry is None:
            body["orderType"] = "Market"
        else:
            body["orderType"] = "Limit"
            body["price"] = self._tick(order.entry)
        if order.tag:
            body["text"] = order.tag[:64]

        response = self._post("/order/placeOSO", body)
        identifier = response.get("orderId") or response.get("id")
        if identifier is None:
            reason = response.get("failureText") or response.get("failureReason") or response
            raise TradovateError(f"order rejected: {reason}")
        return str(identifier)

    def cancel(self, order_id: str) -> None:
        response = self._post("/order/cancelOrder", {"orderId": int(order_id)})
        failure = response.get("failureReason")
        # Cancelling an order that already filled is not an error worth raising:
        # the caller's intent, that the order is not working, is satisfied.
        if failure and failure not in ("NotFound", "AlreadyCompleted"):
            raise TradovateError(f"cancel rejected: {response.get('failureText') or failure}")

    def position(self, symbol: str) -> Position:
        contract = self.contract_id(symbol)
        response = self._get("/position/list")
        items = response.get("items", response)
        rows = [
            row
            for row in (items if isinstance(items, list) else [])
            if int(row.get("contractId", -1)) == contract
        ]
        net = sum(int(row.get("netPos", 0)) for row in rows)
        if net == 0:
            return Position(symbol, None, 0, 0.0, 0.0)
        # netPrice is the average price of the open position in Tradovate's
        # terms, and is absent on a freshly opened one.
        prices = [float(row["netPrice"]) for row in rows if row.get("netPrice") is not None]
        average = sum(prices) / len(prices) if prices else 0.0
        side: Side = "long" if net > 0 else "short"
        return Position(symbol, side, abs(net), average, 0.0)

    def flatten(self, symbol: str) -> None:
        """Reads the position from the server, not from anything this object
        believes, because local state is exactly what is wrong when flatten is
        the thing being called."""
        contract = self.contract_id(symbol)
        orders = self._get("/order/list")
        items = orders.get("items", orders)
        for row in items if isinstance(items, list) else []:
            if int(row.get("contractId", -1)) != contract:
                continue
            if row.get("ordStatus") in ("Working", "Pending", "Suspended"):
                self.cancel(str(row["id"]))
        self._post(
            "/order/liquidatePosition",
            {"accountId": self.account_id, "contractId": contract, "admin": False},
        )

    def bars(self, symbol: str, minutes: int, count: int) -> Sequence[Any]:
        raise NotImplementedError(
            "Tradovate serves chart data over the market data websocket "
            "(wss://md.tradovateapi.com/v1/websocket, md/getChart), not REST. "
            "That needs a websocket client, which is the one dependency this "
            "package does not carry. Until it is wired up, pass any other "
            "BarSource to LiveTrader: the strategy does not care where bars "
            "come from, only that they are closed and in order."
        )

    # Helpers ---------------------------------------------------------------

    def _tick(self, price: float) -> float:
        if self.tick_size <= 0:
            return price
        return round(round(price / self.tick_size) * self.tick_size, 10)

    @staticmethod
    def _validate(order: BracketOrder) -> None:
        if order.contracts < 1:
            raise ValueError("contracts must be at least one")
        if order.side == "long" and not order.stop < order.target:
            raise ValueError("long bracket needs the stop below the target")
        if order.side == "short" and not order.stop > order.target:
            raise ValueError("short bracket needs the stop above the target")
        if order.entry is not None:
            inside = (
                order.stop < order.entry < order.target
                if order.side == "long"
                else order.target < order.entry < order.stop
            )
            if not inside:
                raise ValueError("entry must sit between the stop and the target")
