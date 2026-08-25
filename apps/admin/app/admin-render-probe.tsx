"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { recordAdminRenderTiming } from "./lib/request-diagnostics";

export function AdminRenderProbe() {
  const pathname = usePathname();
  useEffect(() => {
    const renderStartedAt = performance.now();
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => recordAdminRenderTiming(pathname, renderStartedAt));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [pathname]);
  return null;
}
