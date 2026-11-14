"""Deciding, as a report comes in, whether to ring the floor staff's phones."""

from datetime import UTC, datetime

from fastapi import BackgroundTasks, Request

from app.api.admin import shelf_finder
from app.domain.events import ALERT_THRESHOLD, ALERT_WINDOW, EventStore, NotFoundEvent
from app.repositories.inventory_repository import SqlInventoryRepository
from app.services.push import AlertNotifier, alert_message, should_alert


def schedule_alert(request: Request, background: BackgroundTasks, event: NotFoundEvent) -> None:
    """Pushes an alert after the response, when this report opens one or makes it count.

    After the response, because a push service can take seconds and the shopper's
    phone shouldn't wait on the shift manager's.
    """
    notifier: AlertNotifier = request.app.state.notifier
    if not notifier.enabled:
        return
    events: EventStore = request.app.state.events
    since = datetime.now(UTC) - ALERT_WINDOW
    open_now = events.open_reports(event.store_id, event.item_query, event.category_id, since)
    previous = events.previous_open_report(event.store_id, event.item_query, event.category_id, since, event.timestamp)
    if not should_alert(open_now, event.source, event.timestamp - previous if previous else None):
        return
    reminder = event.source == "shopper" and open_now not in (1, ALERT_THRESHOLD)
    inventory: SqlInventoryRepository = request.app.state.inventory
    department = (
        inventory.departments_of(event.store_id, {event.category_id}).get(event.category_id)
        if event.category_id
        else None
    )
    payload = alert_message(
        item=event.item_query,
        category_id=event.category_id,
        open_reports=open_now,
        shelf=shelf_finder(request, event.store_id)(event.category_id),
        department=department.name if department else None,
        source=event.source,
        reminder=reminder,
    )
    background.add_task(notifier.notify, event.store_id, payload)
