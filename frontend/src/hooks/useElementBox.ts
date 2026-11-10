import type { RefObject } from "react";
import { useLayoutEffect, useState } from "react";

export interface ElementBox {
  /** From the top of the viewport, in pixels. */
  top: number;
  bottom: number;
  height: number;
}

const NONE: ElementBox = { top: 0, bottom: 0, height: 0 };

/** Where an element sits on screen, kept up as it changes size: what it covers of what's under it. */
export function useElementBox(ref: RefObject<HTMLElement | null>, active = true): ElementBox {
  const [box, setBox] = useState<ElementBox>(NONE);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !active) {
      setBox(NONE);
      return;
    }
    const measure = () => {
      const { top, bottom, height } = element.getBoundingClientRect();
      setBox((last) =>
        last.top === top && last.bottom === bottom && last.height === height ? last : { top, bottom, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, active]);

  return box;
}
