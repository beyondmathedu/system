"use client";

import { useSyncExternalStore } from "react";
import AppTopNavContent from "./AppTopNavContent";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import type { HighlightKey } from "./AppTopNavContent";

export type { HighlightKey };

function subscribeNavReady() {
  return () => {};
}

/** Same shell as pre-hydration so server HTML matches the client’s first paint (avoids next/dynamic + Suspense drift). */
function NavHydrationShell() {
  return (
    <div className="contents">
      <nav
        className="fixed inset-x-0 top-0 z-[60] m-0"
        style={{ backgroundImage: PRIMARY_GRADIENT }}
        aria-busy="true"
        aria-label="Loading navigation"
      >
        <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
          <div className="h-[56px] px-6 sm:h-[56px]" />
        </div>
      </nav>
      <div className="h-[56px] sm:h-[56px]" />
    </div>
  );
}

export default function AppTopNav({ highlight = null }: { highlight?: HighlightKey }) {
  const navReady = useSyncExternalStore(subscribeNavReady, () => true, () => false);

  return (
    <div className="contents">
      {navReady ? <AppTopNavContent highlight={highlight} /> : <NavHydrationShell />}
    </div>
  );
}
