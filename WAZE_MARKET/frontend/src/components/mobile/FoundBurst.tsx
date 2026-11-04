import type { CSSProperties } from "react";
import { useMemo } from "react";

const COLORS = [
  "var(--color-brand)",
  "var(--color-next)",
  "var(--color-you)",
  "var(--color-brand-soft)",
];

interface Piece {
  dx: number;
  dy: number;
  spin: number;
  color: string;
  delayMs: number;
}

/** Fans upward, away from a thumb at the bottom of the screen, then drifts down. */
function pieces(count: number, reachPx: number): Piece[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = Math.PI + (Math.PI * (index + 0.5)) / count + (Math.random() - 0.5) * 0.35;
    const reach = reachPx * (0.55 + Math.random() * 0.45);
    return {
      dx: Math.cos(angle) * reach,
      dy: Math.sin(angle) * reach,
      spin: (Math.random() - 0.5) * 720,
      color: COLORS[index % COLORS.length]!,
      delayMs: Math.random() * 60,
    };
  });
}

/** A small pop of confetti, sized to its container. Hidden when motion is reduced. */
export function FoundBurst({ finale = false }: { finale?: boolean }) {
  const burst = useMemo(() => (finale ? pieces(34, 170) : pieces(14, 70)), [finale]);

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
      {burst.map((piece, index) => (
        <span
          key={index}
          className={finale ? "confetti-piece confetti-finale" : "confetti-piece"}
          style={
            {
              "--dx": `${piece.dx}px`,
              "--dy": `${piece.dy}px`,
              "--spin": `${piece.spin}deg`,
              background: piece.color,
              animationDelay: `${piece.delayMs}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
