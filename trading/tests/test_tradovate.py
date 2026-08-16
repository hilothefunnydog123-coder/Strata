from __future__ import annotations

import unittest

from strata_vp.brokers.base import BracketOrder
from strata_vp.brokers.tradovate import (
    TradovateBroker,
    TradovateCredentials,
    TradovateError,
)

CREDENTIALS = TradovateCredentials(
    name="trader", password="secret", app_id="strata", app_version="1.0", cid=1, sec="key"
)


class FakeTransport:
    """Records every request and answers from a queue, so the request bodies
    can be asserted without a network or an account. The shape of what goes on
    the wire is the whole contract here: a bracket that arrives inverted or
    without isAutomated is a live incident, not a failed test."""

    def __init__(self, responses: dict[str, list[dict]] | None = None) -> None:
        self.calls: list[tuple[str, str, dict | None, dict]] = []
        self.responses = responses or {}

    def __call__(self, method, url, body, headers):
        self.calls.append((method, url, body, headers))
        path = url.split("/v1", 1)[1].split("?")[0]
        queue = self.responses.get(path)
        if queue:
            return queue.pop(0) if len(queue) > 1 else queue[0]
        return {}

    def body_for(self, path: str) -> dict:
        for _method, url, body, _headers in self.calls:
            if path in url and body is not None:
                return body
        raise AssertionError(f"no request recorded for {path}; saw {[c[1] for c in self.calls]}")


def _connected(transport: FakeTransport) -> TradovateBroker:
    broker = TradovateBroker(CREDENTIALS, live=False, transport=transport, sleep=lambda _: None)
    broker.connect()
    return broker


def _transport(**extra) -> FakeTransport:
    responses = {
        "/auth/accessTokenRequest": [{"accessToken": "tok", "mdAccessToken": "md"}],
        "/account/list": [{"items": [{"id": 77, "name": "DEMO77"}]}],
        "/contract/find": [{"id": 4242}],
        "/order/placeOSO": [{"orderId": 9001}],
    }
    responses.update(extra)
    return FakeTransport(responses)


class TestAuthentication(unittest.TestCase):
    def test_connect_stores_the_token_and_the_account(self):
        transport = _transport()
        broker = _connected(transport)
        self.assertEqual(broker.access_token, "tok")
        self.assertEqual(broker.md_access_token, "md")
        self.assertEqual(broker.account_id, 77)
        self.assertEqual(broker.account_spec, "DEMO77")

    def test_it_uses_the_demo_host_unless_told_otherwise(self):
        transport = _transport()
        _connected(transport)
        self.assertTrue(all("demo.tradovateapi.com" in call[1] for call in transport.calls))

    def test_a_penalty_ticket_is_waited_out_and_retried(self):
        """A p-ticket response means throttled, not rejected. Treating it as a
        failure and retrying immediately is how the account gets locked."""
        transport = _transport(
            **{
                "/auth/accessTokenRequest": [
                    {"p-ticket": "abc", "p-time": 5},
                    {"accessToken": "tok2"},
                ]
            }
        )
        waited: list[float] = []
        broker = TradovateBroker(
            CREDENTIALS, transport=transport, sleep=lambda seconds: waited.append(seconds)
        )
        broker.connect()
        self.assertEqual(waited, [5.0])
        self.assertEqual(broker.access_token, "tok2")
        second = [c for c in transport.calls if "accessTokenRequest" in c[1]][1]
        self.assertEqual(second[2]["p-ticket"], "abc")

    def test_a_captcha_stops_rather_than_looping(self):
        transport = _transport(
            **{"/auth/accessTokenRequest": [{"p-ticket": "x", "p-time": 1, "p-captcha": True}]}
        )
        broker = TradovateBroker(CREDENTIALS, transport=transport, sleep=lambda _: None)
        with self.assertRaises(TradovateError):
            broker.connect()

    def test_a_missing_token_is_an_error_not_a_silent_none(self):
        transport = _transport(
            **{"/auth/accessTokenRequest": [{"errorText": "Invalid credentials"}]}
        )
        broker = TradovateBroker(CREDENTIALS, transport=transport, sleep=lambda _: None)
        with self.assertRaises(TradovateError) as caught:
            broker.connect()
        self.assertIn("Invalid credentials", str(caught.exception))

    def test_calls_before_connect_are_refused(self):
        broker = TradovateBroker(CREDENTIALS, transport=_transport())
        with self.assertRaises(TradovateError):
            broker.accounts()


class TestBracketConstruction(unittest.TestCase):
    def test_a_long_bracket_sells_the_stop_and_the_target(self):
        transport = _transport()
        broker = _connected(transport)
        order_id = broker.submit(
            BracketOrder("MNQZ5", "long", 2, entry=20000.0, stop=19975.0, target=20040.0, tag="vp")
        )
        self.assertEqual(order_id, "9001")

        body = transport.body_for("/order/placeOSO")
        self.assertEqual(body["action"], "Buy")
        self.assertEqual(body["orderType"], "Limit")
        self.assertEqual(body["price"], 20000.0)
        self.assertEqual(body["orderQty"], 2)
        self.assertEqual(body["accountId"], 77)
        self.assertEqual(body["bracket1"], {
            "action": "Sell", "orderType": "Stop", "stopPrice": 19975.0, "timeInForce": "GTC",
        })
        self.assertEqual(body["bracket2"], {
            "action": "Sell", "orderType": "Limit", "price": 20040.0, "timeInForce": "GTC",
        })

    def test_a_short_bracket_is_the_mirror(self):
        transport = _transport()
        broker = _connected(transport)
        broker.submit(BracketOrder("MNQZ5", "short", 1, entry=20000.0, stop=20025.0, target=19960.0))
        body = transport.body_for("/order/placeOSO")
        self.assertEqual(body["action"], "Sell")
        self.assertEqual(body["bracket1"]["action"], "Buy")
        self.assertEqual(body["bracket1"]["stopPrice"], 20025.0)
        self.assertEqual(body["bracket2"]["action"], "Buy")
        self.assertEqual(body["bracket2"]["price"], 19960.0)

    def test_the_stop_and_target_ride_along_with_the_entry(self):
        """One request, not three. A fill with no resting stop is the state
        that turns a normal loss into a failed account."""
        transport = _transport()
        broker = _connected(transport)
        broker.submit(BracketOrder("MNQZ5", "long", 1, entry=None, stop=19975.0, target=20040.0))
        placements = [c for c in transport.calls if "/order/" in c[1]]
        self.assertEqual(len(placements), 1)
        self.assertIn("placeOSO", placements[0][1])

    def test_automated_orders_declare_themselves(self):
        transport = _transport()
        broker = _connected(transport)
        broker.submit(BracketOrder("MNQZ5", "long", 1, entry=None, stop=19975.0, target=20040.0))
        self.assertIs(transport.body_for("/order/placeOSO")["isAutomated"], True)

    def test_a_market_entry_omits_the_price(self):
        transport = _transport()
        broker = _connected(transport)
        broker.submit(BracketOrder("MNQZ5", "long", 1, entry=None, stop=19975.0, target=20040.0))
        body = transport.body_for("/order/placeOSO")
        self.assertEqual(body["orderType"], "Market")
        self.assertNotIn("price", body)

    def test_prices_are_snapped_to_the_tick(self):
        transport = _transport()
        broker = _connected(transport)
        broker.tick_size = 0.25
        broker.submit(
            BracketOrder("MNQZ5", "long", 1, entry=20000.13, stop=19975.07, target=20040.19)
        )
        body = transport.body_for("/order/placeOSO")
        self.assertEqual(body["price"], 20000.25)
        self.assertEqual(body["bracket1"]["stopPrice"], 19975.0)
        self.assertEqual(body["bracket2"]["price"], 20040.25)

    def test_an_inverted_bracket_never_reaches_the_network(self):
        transport = _transport()
        broker = _connected(transport)
        before = len(transport.calls)
        with self.assertRaises(ValueError):
            broker.submit(BracketOrder("MNQZ5", "long", 1, entry=20000.0, stop=20050.0, target=19950.0))
        with self.assertRaises(ValueError):
            broker.submit(BracketOrder("MNQZ5", "short", 1, entry=20000.0, stop=19950.0, target=20050.0))
        self.assertEqual(len(transport.calls), before)

    def test_an_entry_outside_its_own_bracket_is_refused(self):
        transport = _transport()
        broker = _connected(transport)
        with self.assertRaises(ValueError):
            broker.submit(
                BracketOrder("MNQZ5", "long", 1, entry=20050.0, stop=19975.0, target=20040.0)
            )

    def test_a_rejection_is_raised_with_its_reason(self):
        transport = _transport(**{"/order/placeOSO": [{"failureText": "Account not enabled for API"}]})
        broker = _connected(transport)
        with self.assertRaises(TradovateError) as caught:
            broker.submit(BracketOrder("MNQZ5", "long", 1, entry=None, stop=1.0, target=2.0))
        self.assertIn("Account not enabled for API", str(caught.exception))


class TestPositionAndFlatten(unittest.TestCase):
    def test_flat_when_the_server_says_flat(self):
        transport = _transport(**{"/position/list": [{"items": []}]})
        broker = _connected(transport)
        self.assertIsNone(broker.position("MNQZ5").side)

    def test_a_long_position_is_read_from_the_server(self):
        transport = _transport(
            **{"/position/list": [{"items": [{"contractId": 4242, "netPos": 3, "netPrice": 20010.5}]}]}
        )
        broker = _connected(transport)
        position = broker.position("MNQZ5")
        self.assertEqual(position.side, "long")
        self.assertEqual(position.contracts, 3)
        self.assertAlmostEqual(position.average_price, 20010.5)

    def test_other_contracts_are_ignored(self):
        transport = _transport(
            **{"/position/list": [{"items": [{"contractId": 999, "netPos": -5, "netPrice": 1.0}]}]}
        )
        broker = _connected(transport)
        self.assertIsNone(broker.position("MNQZ5").side)

    def test_flatten_cancels_working_orders_then_liquidates(self):
        transport = _transport(
            **{
                "/order/list": [
                    {
                        "items": [
                            {"id": 5, "contractId": 4242, "ordStatus": "Working"},
                            {"id": 6, "contractId": 4242, "ordStatus": "Filled"},
                            {"id": 7, "contractId": 999, "ordStatus": "Working"},
                        ]
                    }
                ],
                "/order/cancelOrder": [{}],
                "/order/liquidatePosition": [{}],
            }
        )
        broker = _connected(transport)
        broker.flatten("MNQZ5")
        cancelled = [c[2]["orderId"] for c in transport.calls if "cancelOrder" in c[1]]
        self.assertEqual(cancelled, [5])
        liquidation = transport.body_for("/order/liquidatePosition")
        self.assertEqual(liquidation["contractId"], 4242)
        self.assertEqual(liquidation["accountId"], 77)

    def test_cancelling_an_already_filled_order_is_not_an_error(self):
        transport = _transport(**{"/order/cancelOrder": [{"failureReason": "AlreadyCompleted"}]})
        broker = _connected(transport)
        broker.cancel("5")  # must not raise

    def test_bars_says_what_to_do_instead_of_returning_nothing(self):
        broker = _connected(_transport())
        with self.assertRaises(NotImplementedError) as caught:
            broker.bars("MNQZ5", 5, 100)
        self.assertIn("websocket", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
