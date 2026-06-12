import { useEffect, useRef, useState } from "react";

type TableHeaderBand = "compact" | "expanded";

const COMPACT_TABLE_HEADER_MAX_WIDTH = 760;

export function useResponsiveTableHeaderBand(): {
  ref: React.RefObject<HTMLDivElement | null>;
  band: TableHeaderBand;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [band, setBand] = useState<TableHeaderBand>("expanded");

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = (width: number) => {
      setBand(width < COMPACT_TABLE_HEADER_MAX_WIDTH ? "compact" : "expanded");
    };

    update(element.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      update(entry.contentRect.width);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, band };
}
