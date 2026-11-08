import { Maximize, Minus, Plus } from "lucide-react";
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { useMemo, useRef } from "react";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";

import type { Zone } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import { isTap } from "../../lib/admin/tapGuard";
import type { MapLayout, Point, ZoneShape } from "../../lib/mapGeometry";
import { fitZoneLabel } from "../../lib/mapGeometry";
import { MapEndpoint, MapFloor } from "../MapFloor";

interface AdminMapEditorProps {
  layout: MapLayout;
  zones: readonly Zone[];
  selectedNodeId: number | null;
  onSelectZone: (nodeId: number) => void;
  /** Drawn on the floor, beneath the shelves. */
  underZones?: ReactNode;
  /** Drawn over the shelves, so it must let clicks through to them. */
  overZones?: ReactNode;
  /** Stays put while the map pans and zooms. */
  legend?: ReactNode;
}

const MAX_SCALE = 6;

/** The floor plan with every shelf face clickable, for managers. */
export function AdminMapEditor({
  layout,
  zones,
  selectedNodeId,
  onSelectZone,
  underZones,
  overZones,
  legend,
}: AdminMapEditorProps) {
  const { t } = useLanguage();
  const zoneByElementId = useMemo(
    () => new Map(zones.map((zone) => [zone.svg_element_id, zone])),
    [zones],
  );
  const pressedAt = useRef<Point | null>(null);

  const zoneOf = (target: EventTarget): Zone | undefined => {
    const shape = (target as Element).closest("[data-zone]");
    return shape ? zoneByElementId.get(shape.id) : undefined;
  };

  const handlePress = ({ clientX, clientY }: PointerEvent) => {
    pressedAt.current = { x: clientX, y: clientY };
  };

  const handleClick = ({ target, clientX, clientY }: MouseEvent) => {
    const zone = zoneOf(target);
    if (zone && isTap(pressedAt.current, { x: clientX, y: clientY })) {
      onSelectZone(zone.id);
    }
    pressedAt.current = null;
  };

  const handleKey = (event: KeyboardEvent) => {
    const zone = zoneOf(event.target);
    if (zone && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onSelectZone(zone.id);
    }
  };

  return (
    // The map is drawn in store coordinates, and the library positions it from the left.
    <div dir="ltr" className="relative overflow-hidden rounded-xl bg-surface ring-1 ring-slate-200">
      <TransformWrapper
        minScale={1}
        maxScale={MAX_SCALE}
        doubleClick={{ disabled: true }}
        panning={{ velocityDisabled: true }}
        wheel={{ step: 0.2 }}
      >
        <ZoomControls />
        <TransformComponent
          wrapperStyle={{ width: "100%", touchAction: "none" }}
          contentStyle={{ width: "100%" }}
        >
          <svg
            viewBox={layout.viewBox}
            role="group"
            aria-label={t.adminMapLabel}
            onPointerDownCapture={handlePress}
            onClick={handleClick}
            onKeyDown={handleKey}
            className="block h-auto max-h-[calc(100dvh-13rem)] w-full"
          >
            <MapFloor layout={layout} />
            {underZones}
            {layout.zones.map((shape) => (
              <ZoneRect
                key={shape.elementId}
                shape={shape}
                zone={zoneByElementId.get(shape.elementId)}
                isSelected={zoneByElementId.get(shape.elementId)?.id === selectedNodeId}
              />
            ))}
            {overZones}
            <g className="pointer-events-none">
              {layout.zones.map((shape) => (
                <DepartmentLabel
                  key={shape.elementId}
                  shape={shape}
                  zone={zoneByElementId.get(shape.elementId)}
                />
              ))}
            </g>
            <MapEndpoint point={layout.entrance} label={t.entrance} />
            <MapEndpoint point={layout.checkout} label={t.checkout} />
          </svg>
        </TransformComponent>
      </TransformWrapper>
      {legend}
    </div>
  );
}

function ZoneRect({
  shape,
  zone,
  isSelected,
}: {
  shape: ZoneShape;
  zone: Zone | undefined;
  isSelected: boolean;
}) {
  const { t } = useLanguage();
  const { elementId, ...rect } = shape;

  // Drawn but unknown to the database: nothing to open, so it stays plain shelf.
  if (!zone) {
    return <rect {...rect} rx={0.2} className="fill-shelf" />;
  }

  const fill = isSelected
    ? "fill-next stroke-ink"
    : zone.item_count > 0
      ? "fill-brand-soft stroke-brand hover:fill-next-soft"
      : "fill-paper stroke-muted/50 hover:fill-next-soft";
  return (
    <rect
      {...rect}
      id={elementId}
      data-zone
      role="button"
      tabIndex={0}
      aria-label={t.zoneLabel(zone.zone_name, zone.item_count)}
      rx={0.2}
      strokeWidth={0.07}
      className={`cursor-pointer transition-colors ${fill}`}
    />
  );
}

/** Above the map's overlays, so a department's name stays readable through the heat. */
function DepartmentLabel({ shape, zone }: { shape: ZoneShape; zone: Zone | undefined }) {
  const { pick } = useLanguage();
  if (!zone?.preview) {
    return null;
  }

  const name = pick(zone.preview, zone.preview_en ?? zone.preview);
  const { text, fontSize } = fitZoneLabel(name, shape.height);
  const x = shape.x + shape.width / 2;
  const y = shape.y + shape.height / 2;

  return (
    <text
      data-zone-label={shape.elementId}
      x={x}
      y={y}
      transform={`rotate(-90 ${x} ${y})`}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={fontSize}
      fontWeight={600}
      stroke="rgba(255, 255, 255, 0.8)"
      strokeWidth={0.12}
      paintOrder="stroke"
      className="fill-slate-900 select-none"
    >
      {text}
    </text>
  );
}

function ZoomControls() {
  const { t } = useLanguage();
  const { zoomIn, zoomOut, resetTransform } = useControls();
  const controls = [
    { label: t.zoomIn, Icon: Plus, onClick: () => zoomIn() },
    { label: t.zoomOut, Icon: Minus, onClick: () => zoomOut() },
    { label: t.zoomReset, Icon: Maximize, onClick: () => resetTransform() },
  ];

  return (
    // The strip between the shelves and the store front, the one place it hides no zone.
    <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 gap-1">
      {controls.map(({ label, Icon, onClick }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          title={label}
          onClick={onClick}
          className="grid size-11 place-items-center rounded-xl bg-surface text-ink shadow ring-1 ring-line hover:bg-brand-soft"
        >
          <Icon aria-hidden className="size-5" />
        </button>
      ))}
    </div>
  );
}
