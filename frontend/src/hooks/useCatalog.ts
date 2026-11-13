import { useCallback, useEffect, useState } from "react";

import type { AdminApi } from "../api/adminClient";
import { ApiError } from "../api/client";
import type { CatalogProduct, PriceImport, ProductChanges, ProductDraft } from "../api/types";

/** Why a save didn't go through, in words a manager can act on. */
export type CatalogProblem = "duplicate" | "invalid" | "failed";

export type CatalogResult = { ok: true; product: CatalogProduct | null } | { ok: false; problem: CatalogProblem };

function problemOf(error: unknown): CatalogProblem {
  if (error instanceof ApiError && error.status === 409) return "duplicate";
  if (error instanceof ApiError && error.status === 422) return "invalid";
  return "failed";
}

/**
 * The store's catalog for the dashboard: loaded once, kept in step with every
 * change a manager makes, and shared by the catalog tab and the shelves on the map.
 */
export function useCatalog(api: AdminApi) {
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    api
      .products(controller.signal)
      .then(setProducts)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [api, attempt]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  const keep = useCallback(async (action: () => Promise<CatalogProduct>): Promise<CatalogResult> => {
    try {
      const product = await action();
      setProducts((current) => {
        const others = (current ?? []).filter((candidate) => candidate.id !== product.id);
        return [...others, product].sort((a, b) => a.name.localeCompare(b.name, "he"));
      });
      return { ok: true, product };
    } catch (error) {
      return { ok: false, problem: problemOf(error) };
    }
  }, []);

  const create = useCallback((draft: ProductDraft) => keep(() => api.createProduct(draft)), [api, keep]);
  const update = useCallback(
    (productId: number, changes: ProductChanges) => keep(() => api.updateProduct(productId, changes)),
    [api, keep],
  );
  const remove = useCallback(
    async (productId: number): Promise<CatalogResult> => {
      try {
        await api.deleteProduct(productId);
        setProducts((current) => (current ?? []).filter((product) => product.id !== productId));
        return { ok: true, product: null };
      } catch (error) {
        return { ok: false, problem: problemOf(error) };
      }
    },
    [api],
  );

  /** A chain's price file; on success the catalog reloads with the new prices. */
  const importPrices = useCallback(
    async (file: Blob): Promise<PriceImport | null> => {
      try {
        const result = await api.importPrices(file);
        reload();
        return result;
      } catch {
        return null;
      }
    },
    [api, reload],
  );

  return { products, failed, reload, create, update, remove, importPrices };
}

export type Catalog = ReturnType<typeof useCatalog>;
