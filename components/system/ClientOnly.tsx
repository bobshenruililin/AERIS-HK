"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Renders `fallback` on the server and the first client paint, then mounts
 * `children` after useEffect. First-paint HTML therefore matches hydration.
 */
export function ClientOnly({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted ? <>{children}</> : <>{fallback}</>;
}
