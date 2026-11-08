import { zoneTone } from "../lib/zoneCode";

interface ZoneBadgeProps {
  code: string;
  tone: number;
  className?: string;
}

/** The same disc as the item's pin on the map, so the eye can match the two. */
export function ZoneBadge({ code, tone, className = "size-13 text-xl" }: ZoneBadgeProps) {
  return (
    <span
      dir="ltr"
      className={`zone-badge grid shrink-0 place-items-center rounded-full font-extrabold text-white ${className}`}
      style={{ background: zoneTone(tone) }}
    >
      {code}
    </span>
  );
}
