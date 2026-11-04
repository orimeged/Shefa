import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AdminApi } from "../../api/adminClient";
import type {
  CatalogCategory,
  CatalogEntry,
  MapAudioResult,
  NotFoundReportRow,
  Zone,
  ZoneItem,
} from "../../api/types";
import type { DictationProblem } from "../../hooks/useInventoryDictation";
import { MAX_RECORDING_SECONDS, useInventoryDictation } from "../../hooks/useInventoryDictation";
import { useZoneInventory } from "../../hooks/useZoneInventory";
import { useLanguage } from "../../i18n/LanguageProvider";
import { formatClock } from "../../lib/admin/clipRecorder";
import type { StagedRow } from "../../lib/admin/staging";
import { stageItems, toBatch } from "../../lib/admin/staging";
import { Notice } from "../Notice";
import { AddItemForm } from "./AddItemForm";
import { StagingArea } from "./StagingArea";
import { ZoneInventoryList } from "./ZoneInventoryList";

interface ZoneManagementModalProps {
  api: AdminApi;
  nodeId: number;
  zones: readonly Zone[];
  categories: readonly CatalogCategory[];
  /** The alert being dealt with, when this shelf is that item's new location. */
  placing?: NotFoundReportRow | null;
  onChanged: () => void;
  onPlaced?: (row: NotFoundReportRow) => void;
  onClose: () => void;
}

export function ZoneManagementModal({
  api,
  nodeId,
  zones,
  categories,
  placing = null,
  onChanged,
  onPlaced,
  onClose,
}: ZoneManagementModalProps) {
  const { t, language } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const inventory = useZoneInventory(api, nodeId, onChanged);
  const { save } = inventory;

  const [rows, setRows] = useState<StagedRow[]>([]);
  const [transcript, setTranscript] = useState("");
  const [fromDictionary, setFromDictionary] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  // The native modal keeps focus inside and shuts the page behind it to screen readers.
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const send = useCallback((clip: Blob) => api.mapAudio(clip, language), [api, language]);
  const onResult = useCallback(
    (result: MapAudioResult) => {
      setRows((current) => stageItems(current, result.items, categories));
      setTranscript(result.transcript);
      setFromDictionary(result.classified_by === "dictionary");
      setSavedCount(null);
    },
    [categories],
  );
  const dictation = useInventoryDictation({ send, onResult });

  const requestClose = () => {
    const nothingToLose = rows.length === 0 && dictation.phase === "idle" && !dictation.canResend;
    if (nothingToLose || window.confirm(t.unsavedConfirm)) {
      dictation.cancel();
      onClose();
    }
  };

  const change = (action: () => Promise<ZoneItem[]>) => {
    setSavedCount(null);
    return save(action);
  };

  const approve = async () => {
    const count = rows.length;
    if (await change(() => api.assignBatch(nodeId, toBatch(rows)))) {
      setRows([]);
      setTranscript("");
      setSavedCount(count);
    }
  };

  const add = async (action: () => Promise<ZoneItem[]>) => {
    const saved = await change(action);
    if (saved && placing) {
      onPlaced?.(placing);
    }
    return saved;
  };

  // A relocated product leaves its other shelves: routing goes to the closest
  // one, which could still be the shelf shoppers couldn't find it on.
  const relocate = placing !== null;

  const addExisting = (entry: CatalogEntry) =>
    add(() => api.assign(nodeId, entry.entity_type, entry.entity_id, relocate));

  const addNew = (name: string, categoryId: number) =>
    add(() => api.assignBatch(nodeId, [{ name, category_id: categoryId }], relocate));

  const move = (item: ZoneItem, toNodeId: number) =>
    void change(() => api.move(nodeId, item.entity_type, item.entity_id, toNodeId));

  const remove = (item: ZoneItem) =>
    void change(async () => {
      await api.remove(nodeId, item.entity_type, item.entity_id);
      return api.zoneItems(nodeId);
    });

  const zone = zones.find((candidate) => candidate.id === nodeId);
  const isDictating = dictation.phase !== "idle";

  const problems: Record<DictationProblem, string> = {
    denied: t.dictationDenied,
    unsupported: t.dictationUnsupported,
    unavailable: t.dictationUnavailable,
    failed: t.dictationFailed,
    empty: t.dictationEmpty,
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="zone-title"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      className="m-auto mb-0 max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-[2rem] bg-paper px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] text-ink shadow-2xl backdrop:bg-ink/40 sm:mb-auto sm:rounded-[2rem]"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="zone-title" className="min-w-0 truncate text-lg font-semibold">
          {zone?.zone_name}
        </h2>
        <button
          type="button"
          onClick={requestClose}
          aria-label={t.closePanel}
          className="grid size-11 shrink-0 place-items-center rounded-xl text-muted"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {placing && (
          <p role="status" className="rounded-2xl bg-next-soft px-4 py-3 font-medium ring-1 ring-next">
            {t.placingHint(placing.item_query)}
          </p>
        )}

        <section aria-label={t.zoneInventory} className="flex flex-col gap-2">
          <h3 className="font-semibold">{t.zoneInventory}</h3>
          {inventory.loadFailed && <Notice message={t.loadFailed} onRetry={inventory.reload} />}
          {inventory.saveFailed && <Notice message={t.saveFailed} />}
          {inventory.items === null && !inventory.loadFailed && (
            <div className="h-16 animate-pulse rounded-2xl bg-line/60" />
          )}
          {inventory.items && (
            <ZoneInventoryList
              items={inventory.items}
              otherZones={zones.filter((candidate) => candidate.id !== nodeId)}
              disabled={inventory.isSaving}
              onMove={move}
              onRemove={remove}
            />
          )}
          {savedCount !== null && (
            <p role="status" className="font-medium text-brand-strong">
              {t.itemsAdded(savedCount)}
            </p>
          )}
        </section>

        {!placing && (
          <section className="flex flex-col gap-2">
            {dictation.phase === "recording" ? (
              <div className="flex flex-col gap-2 rounded-2xl bg-surface p-3 ring-1 ring-danger">
                <p role="status" className="flex items-center gap-2 font-semibold text-danger">
                  <span aria-hidden className="size-3 animate-pulse rounded-full bg-danger" />
                  {t.recording(formatClock(dictation.seconds), formatClock(MAX_RECORDING_SECONDS))}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={dictation.stop}
                    className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-danger px-4 font-semibold text-white"
                  >
                    <Square aria-hidden className="size-5" />
                    {t.stopRecording}
                  </button>
                  <button
                    type="button"
                    onClick={dictation.cancel}
                    className="min-h-12 rounded-xl px-4 font-medium text-muted"
                  >
                    {t.cancelRecording}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={isDictating}
                onClick={() => void dictation.start()}
                className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-ink px-4 text-lg font-semibold text-white disabled:opacity-60"
              >
                {isDictating ? (
                  <LoaderCircle aria-hidden className="size-5 animate-spin" />
                ) : (
                  <Mic aria-hidden className="size-5" />
                )}
                {dictation.phase === "sending" ? t.processingAudio : t.dictateInventory}
              </button>
            )}
            {!isDictating && !dictation.problem && (
              <p className="text-sm text-muted">{t.dictateHint}</p>
            )}
            {dictation.problem && (
              <Notice
                message={problems[dictation.problem]}
                onRetry={dictation.canResend ? dictation.resend : undefined}
              />
            )}
          </section>
        )}

        {rows.length > 0 && (
          <StagingArea
            rows={rows}
            transcript={transcript}
            fromDictionary={fromDictionary}
            categories={categories}
            disabled={inventory.isSaving}
            onChange={setRows}
            onApprove={() => void approve()}
          />
        )}

        <AddItemForm
          api={api}
          categories={categories}
          disabled={inventory.isSaving}
          initialText={placing?.item_query}
          initialCategoryId={placing?.catalog_category_id}
          productsOnly={placing !== null}
          onAddExisting={addExisting}
          onAddNew={addNew}
        />
      </div>
    </dialog>
  );
}
