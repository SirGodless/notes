import { useEffect, useState, type RefObject } from 'react';

/**
 * Meldet, ob ein Element sich dem sichtbaren Bereich bis auf `margin` Pixel
 * genaehert hat.
 *
 * Damit bekommen nur Seiten in Blicknaehe ein Canvas. Ohne das wuerde ein
 * 20-Seiten-Dokument mit drei Ebenen ueber 800 MB Canvas-Speicher belegen –
 * A4 bei Renderfaktor 2 sind rund 14 MB pro Ebene und Seite.
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
      { rootMargin: `${margin}px 0px ${margin}px 0px` },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin]);

  return near;
}
