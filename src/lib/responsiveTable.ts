"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

/** Base table classes: fluid on small screens, optional desktop min-width from lg. */
export const RESPONSIVE_TABLE_BASE =
  "w-full min-w-0 table-fixed border-collapse text-[11px] sm:text-sm";

export function responsiveTableClass(desktopMinPx: number): string {
  return `${RESPONSIVE_TABLE_BASE} lg:min-w-[${desktopMinPx}px]`;
}

export function responsiveStickyScale(viewportWidth: number): number {
  if (viewportWidth >= 1024) return 1;
  if (viewportWidth >= 640) return 0.72;
  return 0.55;
}

export function responsiveStickyFloor(viewportWidth: number): number {
  return viewportWidth >= 640 ? 36 : 28;
}

export function scaledStickyWidth(
  desktopPx: number,
  viewportWidth: number,
): number {
  const scale = responsiveStickyScale(viewportWidth);
  if (scale >= 1) return desktopPx;
  return Math.max(responsiveStickyFloor(viewportWidth), Math.round(desktopPx * scale));
}

export type StickyColumnDef = { id: string; desktopWidth: number };

export type ResponsiveStickyLayout = {
  viewportWidth: number;
  widths: Record<string, number>;
  lefts: Record<string, number>;
};

export function buildResponsiveStickyLayout(
  columns: readonly StickyColumnDef[],
  viewportWidth: number,
): ResponsiveStickyLayout {
  const widths: Record<string, number> = {};
  const lefts: Record<string, number> = {};
  let left = 0;
  for (const col of columns) {
    widths[col.id] = scaledStickyWidth(col.desktopWidth, viewportWidth);
    lefts[col.id] = left;
    left += widths[col.id];
  }
  return { viewportWidth, widths, lefts };
}

export function useResponsiveStickyLayout(
  columns: readonly StickyColumnDef[],
): ResponsiveStickyLayout {
  const [viewportWidth, setViewportWidth] = useState(1200);

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return useMemo(
    () => buildResponsiveStickyLayout(columns, viewportWidth),
    [columns, viewportWidth],
  );
}

export function stickyColumnStyle(
  layout: ResponsiveStickyLayout,
  id: string,
  opts?: { includeLeft?: boolean },
): CSSProperties {
  const w = layout.widths[id] ?? 0;
  const style: CSSProperties = {
    width: w,
    minWidth: w,
    maxWidth: w,
  };
  if (opts?.includeLeft !== false) {
    style.left = layout.lefts[id] ?? 0;
  }
  return style;
}

/** Sticky header cells only need minWidth + left (width can flex). */
export function stickyHeaderStyle(
  layout: ResponsiveStickyLayout,
  id: string,
): CSSProperties {
  const w = layout.widths[id] ?? 0;
  return {
    left: layout.lefts[id] ?? 0,
    minWidth: w,
  };
}

export function responsiveColMinWidth(desktopPx: number, viewportWidth: number): number {
  return scaledStickyWidth(desktopPx, viewportWidth);
}

export function responsiveColStyle(
  desktopMinPx: number,
  viewportWidth: number,
): CSSProperties {
  return { minWidth: responsiveColMinWidth(desktopMinPx, viewportWidth) };
}
