"""Alerts pushed to the floor staff's phones, through each browser's push service.

A shopper's "not found" reaches the shift manager's phone within seconds, with the
app closed: that is what turns a report into a refilled shelf. Delivery goes through
the phone's own push service (Apple, Google or Mozilla), signed with the server's
VAPID key so they know who is sending.

Pushing is best effort. A phone the push service no longer knows is forgotten; any
other failure is logged and dropped, and the alert still waits in the staff app.
"""

import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol

from app.domain.events import ALERT_THRESHOLD, Source

logger = logging.getLogger(__name__)

# An alert an hour old is stale: by then someone walked past the shelf.
_TTL_SECONDS = 3600
_TIMEOUT_SECONDS = 10
_GONE = (404, 410)


@dataclass(frozen=True, slots=True)
class PushSubscription:
    endpoint: str
    p256dh: str
    auth: str


class PushOutcome(StrEnum):
    SENT = "sent"
    # The push service doesn't know this phone any more: drop the subscription.
    GONE = "gone"
    FAILED = "failed"


class PushSender(Protocol):
    def send(self, subscription: PushSubscription, payload: dict[str, Any]) -> PushOutcome: ...


class SubscriptionStore(Protocol):
    def for_store(self, store_id: str) -> Sequence[PushSubscription]: ...

    def remove(self, endpoint: str) -> None: ...


class WebPushSender:
    def __init__(self, private_key: str, subject: str) -> None:
        # Imported here: the app runs without them when push isn't configured.
        from py_vapid import Vapid

        self._vapid = Vapid.from_string(private_key)
        self._subject = subject

    def send(self, subscription: PushSubscription, payload: dict[str, Any]) -> PushOutcome:
        from pywebpush import WebPushException, webpush
        from requests import RequestException

        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=self._vapid,
                # A new dict each time: the library writes the audience and expiry into it.
                vapid_claims={"sub": self._subject},
                ttl=_TTL_SECONDS,
                timeout=_TIMEOUT_SECONDS,
            )
        except WebPushException as error:
            status = error.response.status_code if error.response is not None else None
            if status in _GONE:
                return PushOutcome.GONE
            logger.warning("Push failed with %s", status)
            return PushOutcome.FAILED
        except (RequestException, ValueError) as error:
            logger.warning("Push failed: %s", type(error).__name__)
            return PushOutcome.FAILED
        return PushOutcome.SENT


class AlertNotifier:
    """Sends one message to every phone subscribed for a store."""

    def __init__(self, subscriptions: SubscriptionStore, sender: PushSender | None, public_key: str | None) -> None:
        self._subscriptions = subscriptions
        self._sender = sender
        self.public_key = public_key if sender is not None else None

    @property
    def enabled(self) -> bool:
        return self._sender is not None

    def notify(self, store_id: str, payload: dict[str, Any]) -> int:
        """How many phones it reached."""
        if self._sender is None:
            return 0
        sent = 0
        for subscription in self._subscriptions.for_store(store_id):
            outcome = self._sender.send(subscription, payload)
            if outcome is PushOutcome.GONE:
                self._subscriptions.remove(subscription.endpoint)
            elif outcome is PushOutcome.SENT:
                sent += 1
        return sent


def should_alert(open_reports: int, source: Source) -> bool:
    """The first report of an item opens an alert; the third says it's real. Pickers always count.

    Only those two moments, so a busy shelf doesn't ring a phone with every shopper.
    """
    return source == "picker" or open_reports in (1, ALERT_THRESHOLD)


def alert_message(
    item: str,
    category_id: str | None,
    open_reports: int,
    shelf: str | None,
    department: str | None,
    source: Source,
) -> dict[str, Any]:
    """What the phone shows. In Hebrew: the floor staff's language in the pilot."""
    if source == "picker":
        title = "מלקט: חסר במדף"
    elif open_reports >= ALERT_THRESHOLD:
        title = f"{open_reports} דיווחים: כנראה מדף ריק"
    else:
        title = "לקוח לא מצא מוצר במדף"
    where = f"מדף {shelf}" if shelf else department
    return {
        "title": title,
        "body": f"{item} · {where}" if where else item,
        # A newer alert for the same item replaces the older one on the phone.
        "tag": f"alert:{category_id or ''}:{item}",
        "url": "/staff",
        "item": item,
        "category_id": category_id,
        "count": open_reports,
    }
