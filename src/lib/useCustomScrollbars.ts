"use client";

import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";

export type ScrollThumbMetrics = { size: number; offset: number };

function computeScrollThumb(
  trackSize: number,
  scrollSize: number,
  clientSize: number,
  scrollOffset: number,
): ScrollThumbMetrics {
  if (!trackSize || !scrollSize || !clientSize) return { size: 0, offset: 0 };
  const ratio = clientSize / scrollSize;
  const size = Math.max(28, Math.floor(trackSize * ratio));
  const maxOffset = Math.max(0, trackSize - size);
  const maxScroll = Math.max(1, scrollSize - clientSize);
  const offset = Math.round((scrollOffset / maxScroll) * maxOffset);
  return { size, offset };
}

function useTrackSize(
  ref: RefObject<HTMLElement | null>,
  dimension: "width" | "height",
  resetKey: unknown,
) {
  const [size, setSize] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const read = () => {
      setSize(dimension === "width" ? el.clientWidth : el.clientHeight);
    };

    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dimension, ref, resetKey]);

  return size;
}

type UseCustomScrollbarsOptions = {
  tableScrollRef: RefObject<HTMLDivElement | null>;
  /** Re-run scroll/track measurements when content size changes (e.g. row count). */
  contentKey: unknown;
};

export function useCustomScrollbars({ tableScrollRef, contentKey }: UseCustomScrollbarsOptions) {
  const tableScrollId = useId();
  const bottomTrackRef = useRef<HTMLDivElement | null>(null);
  const sideTrackRef = useRef<HTMLDivElement | null>(null);
  const [bottomScrollWidth, setBottomScrollWidth] = useState(0);
  const [bottomScrollClientWidth, setBottomScrollClientWidth] = useState(0);
  const [sideScrollHeight, setSideScrollHeight] = useState(0);
  const [sideScrollClientHeight, setSideScrollClientHeight] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useLayoutEffect(() => {
    const tableEl = tableScrollRef.current;
    if (!tableEl) return;

    const updateMetrics = () => {
      setBottomScrollWidth(tableEl.scrollWidth);
      setBottomScrollClientWidth(tableEl.clientWidth);
      setSideScrollHeight(tableEl.scrollHeight);
      setSideScrollClientHeight(tableEl.clientHeight);
    };

    const onTableScroll = () => {
      setScrollLeft(tableEl.scrollLeft);
      setScrollTop(tableEl.scrollTop);
    };

    updateMetrics();
    setScrollLeft(tableEl.scrollLeft);
    setScrollTop(tableEl.scrollTop);
    tableEl.addEventListener("scroll", onTableScroll, { passive: true });
    const ro = new ResizeObserver(updateMetrics);
    ro.observe(tableEl);

    return () => {
      tableEl.removeEventListener("scroll", onTableScroll);
      ro.disconnect();
    };
  }, [contentKey, tableScrollRef]);

  const bottomTrackWidth = useTrackSize(bottomTrackRef, "width", contentKey);
  const sideTrackHeight = useTrackSize(sideTrackRef, "height", contentKey);

  const bottomThumb = useMemo(
    () =>
      computeScrollThumb(
        bottomTrackWidth,
        bottomScrollWidth,
        bottomScrollClientWidth,
        scrollLeft,
      ),
    [bottomScrollClientWidth, bottomScrollWidth, bottomTrackWidth, scrollLeft],
  );

  const sideThumb = useMemo(
    () =>
      computeScrollThumb(sideTrackHeight, sideScrollHeight, sideScrollClientHeight, scrollTop),
    [sideScrollClientHeight, sideScrollHeight, sideTrackHeight, scrollTop],
  );

  const horizontalScrollMax = Math.max(0, bottomScrollWidth - bottomScrollClientWidth);
  const verticalScrollMax = Math.max(0, sideScrollHeight - sideScrollClientHeight);

  const onBottomTrackMouseDown = useCallback(
    (e: MouseEvent) => {
      const track = bottomTrackRef.current;
      const tableEl = tableScrollRef.current;
      if (!track || !tableEl) return;
      const rect = track.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const { size } = bottomThumb;
      const trackWidth = rect.width;
      const maxOffset = Math.max(0, trackWidth - size);
      const maxScroll = Math.max(1, bottomScrollWidth - bottomScrollClientWidth);
      const targetOffset = Math.min(maxOffset, Math.max(0, x - size / 2));
      tableEl.scrollLeft = Math.round((targetOffset / Math.max(1, maxOffset)) * maxScroll);
    },
    [bottomScrollClientWidth, bottomScrollWidth, bottomThumb, tableScrollRef],
  );

  const onSideTrackMouseDown = useCallback(
    (e: MouseEvent) => {
      const track = sideTrackRef.current;
      const tableEl = tableScrollRef.current;
      if (!track || !tableEl) return;
      const rect = track.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const { size } = sideThumb;
      const trackHeight = rect.height;
      const maxOffset = Math.max(0, trackHeight - size);
      const maxScroll = Math.max(1, sideScrollHeight - sideScrollClientHeight);
      const targetOffset = Math.min(maxOffset, Math.max(0, y - size / 2));
      tableEl.scrollTop = Math.round((targetOffset / Math.max(1, maxOffset)) * maxScroll);
    },
    [sideScrollClientHeight, sideScrollHeight, sideThumb, tableScrollRef],
  );

  const startDragBottomThumb = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const track = bottomTrackRef.current;
      const tableEl = tableScrollRef.current;
      if (!track || !tableEl) return;
      const rect = track.getBoundingClientRect();
      const startX = e.clientX;
      const startOffset = bottomThumb.offset;
      const size = bottomThumb.size;
      const trackWidth = rect.width;
      const maxOffset = Math.max(0, trackWidth - size);
      const maxScroll = Math.max(1, bottomScrollWidth - bottomScrollClientWidth);

      const onMove = (ev: globalThis.MouseEvent) => {
        const dx = ev.clientX - startX;
        const nextOffset = Math.min(maxOffset, Math.max(0, startOffset + dx));
        tableEl.scrollLeft = Math.round((nextOffset / Math.max(1, maxOffset)) * maxScroll);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [bottomScrollClientWidth, bottomScrollWidth, bottomThumb, tableScrollRef],
  );

  const startDragSideThumb = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const track = sideTrackRef.current;
      const tableEl = tableScrollRef.current;
      if (!track || !tableEl) return;
      const rect = track.getBoundingClientRect();
      const startY = e.clientY;
      const startOffset = sideThumb.offset;
      const size = sideThumb.size;
      const trackHeight = rect.height;
      const maxOffset = Math.max(0, trackHeight - size);
      const maxScroll = Math.max(1, sideScrollHeight - sideScrollClientHeight);

      const onMove = (ev: globalThis.MouseEvent) => {
        const dy = ev.clientY - startY;
        const nextOffset = Math.min(maxOffset, Math.max(0, startOffset + dy));
        tableEl.scrollTop = Math.round((nextOffset / Math.max(1, maxOffset)) * maxScroll);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sideScrollClientHeight, sideScrollHeight, sideThumb, tableScrollRef],
  );

  return {
    tableScrollId,
    bottomTrackRef,
    sideTrackRef,
    bottomThumb,
    sideThumb,
    bottomScrollWidth,
    bottomScrollClientWidth,
    sideScrollHeight,
    sideScrollClientHeight,
    bottomTrackA11yProps: {
      role: "scrollbar" as const,
      "aria-label": "Horizontal scrollbar",
      "aria-controls": tableScrollId,
      "aria-orientation": "horizontal" as const,
      "aria-valuenow": scrollLeft,
      "aria-valuemin": 0,
      "aria-valuemax": horizontalScrollMax,
    },
    sideTrackA11yProps: {
      role: "scrollbar" as const,
      "aria-label": "Vertical scrollbar",
      "aria-controls": tableScrollId,
      "aria-orientation": "vertical" as const,
      "aria-valuenow": scrollTop,
      "aria-valuemin": 0,
      "aria-valuemax": verticalScrollMax,
    },
    onBottomTrackMouseDown,
    onSideTrackMouseDown,
    startDragBottomThumb,
    startDragSideThumb,
  };
}
