import { useEffect, useState, type RefObject } from 'react';

/**
 * Meldet, ob ein Element sich dem sichtbaren Bereich bis auf `margin` Pixel
 * genaehert hat – auf allen vier Seiten (die v2-Szene wird in beide
 * Richtungen gepannt, nicht nur vertikal gescrollt wie v1s Seitenstapel).
 *
 * Damit bekommen nur Inseln in Blicknaehe ueberhaupt Kacheln. Ohne das
 * wuerde ein Arbeitsbereich mit vielen Inseln weit mehr Speicher belegen,
 * als je gleichzeitig sichtbar ist.
 */
export function useNearViewport(
  ref: RefObject<HTMLElement | null>,
  margin: number,
  initiallyNear = false,
): boolean {
  const [near, setNear] = useState(initiallyNear);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setNear(entry.isIntersecting);
      },
      { rootMargin: `${margin}px` },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin]);

  return near;
}
