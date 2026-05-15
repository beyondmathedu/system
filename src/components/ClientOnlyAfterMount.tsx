"use client";

import { useEffect, useState, type ReactNode } from "react";

type Props = {
  fallback: ReactNode;
  children: ReactNode;
};

/**
 * SSR 與首次 client paint 只輸出 `fallback`；`useEffect` 後先渲染 `children`。
 * 用於瀏覽器外掛會喺 hydration 前改 DOM（例如插入游標層）令 React 對唔上嘅頁面。
 */
export default function ClientOnlyAfterMount({ fallback, children }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted ? <>{children}</> : <>{fallback}</>;
}
