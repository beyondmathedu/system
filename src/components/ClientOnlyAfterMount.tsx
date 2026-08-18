"use client";

import { useSyncExternalStore, type ReactNode } from "react";

type Props = {
  fallback: ReactNode;
  children: ReactNode;
  /** When true, render children immediately (SSR + first paint). */
  disabled?: boolean;
};

function subscribe() {
  return () => {};
}

/**
 * SSR 與首次 client paint 只輸出 `fallback`；hydration 後渲染 `children`。
 * 用於瀏覽器外掛會喺 hydration 前改 DOM（例如插入游標層）令 React 對唔上嘅頁面。
 */
export default function ClientOnlyAfterMount({ fallback, children, disabled = false }: Props) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (disabled || mounted) return <>{children}</>;
  return <>{fallback}</>;
}
