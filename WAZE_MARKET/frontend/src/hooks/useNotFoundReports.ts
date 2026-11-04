import { useCallback, useEffect, useState } from "react";

import { postNotFoundReport, STORE_ID } from "../api/client";
import { browserStorage, newUuid, NotFoundQueue } from "../lib/events/notFoundQueue";

export interface NotFoundSighting {
  itemQuery: string;
  categoryId: string;
  x: number;
  y: number;
}

/** Reports what a shopper couldn't find, whenever the signal allows. */
export function useNotFoundReports(sessionId: string) {
  const [queue] = useState(() => new NotFoundQueue(postNotFoundReport, browserStorage()));

  useEffect(() => {
    const flush = () => void queue.flush();
    flush();
    window.addEventListener("online", flush);
    return () => {
      window.removeEventListener("online", flush);
      queue.stop();
    };
  }, [queue]);

  return useCallback(
    ({ itemQuery, categoryId, x, y }: NotFoundSighting) =>
      queue.add({
        event_id: newUuid(),
        store_id: STORE_ID,
        session_id: sessionId,
        item_query: itemQuery,
        category_id: categoryId,
        x_coord: x,
        y_coord: y,
        timestamp: new Date().toISOString(),
      }),
    [queue, sessionId],
  );
}
