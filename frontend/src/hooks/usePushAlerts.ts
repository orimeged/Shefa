import { useCallback, useEffect, useState } from "react";

import type { StaffApi } from "../api/staffClient";
import type { PushState } from "../lib/staff/push";
import {
  applicationServerKey,
  isInstalled,
  isIos,
  pushStateOf,
  pushSupported,
  staffRegistration,
} from "../lib/staff/push";

/** The staff app's alerts switch: whether this phone gets pushes, and turning them on or off. */
export function usePushAlerts(api: StaffApi) {
  const [state, setState] = useState<PushState>("checking");
  const [serverKey, setServerKey] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = pushSupported();
      const facts = {
        supported,
        ios: isIos(),
        installed: isInstalled(),
        serverKey: null as string | null,
        permission: supported ? Notification.permission : null,
        subscribed: false,
      };
      if (supported) {
        try {
          facts.serverKey = await api.pushKey();
          if (facts.serverKey) {
            const registration = await staffRegistration();
            const subscription = await registration.pushManager.getSubscription();
            facts.subscribed = subscription !== null;
            // The server may have forgotten it, after a redeploy wiped a test database.
            if (subscription && facts.permission === "granted") {
              await api.subscribe(subscription.toJSON());
            }
          }
        } catch {
          // Whatever failed, the switch says what it can; alerts still show while open.
        }
      }
      if (!cancelled) {
        setServerKey(facts.serverKey);
        setState(pushStateOf(facts));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  /** Must run from a tap: browsers only ask for permission in answer to one. */
  const enable = useCallback(async () => {
    if (!serverKey) return;
    setIsBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await staffRegistration();
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(serverKey),
        }));
      await api.subscribe(subscription.toJSON());
      setState("on");
    } catch {
      setState("off");
    } finally {
      setIsBusy(false);
    }
  }, [api, serverKey]);

  const disable = useCallback(async () => {
    setIsBusy(true);
    try {
      const registration = await staffRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.unsubscribe(subscription.endpoint).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setState("off");
    } finally {
      setIsBusy(false);
    }
  }, [api]);

  return { state, isBusy, enable, disable, test: api.testPush };
}
