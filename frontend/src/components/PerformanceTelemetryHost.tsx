import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { postClientPerformanceSample } from "../api/client";

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value: number, places = 1) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

export function PerformanceTelemetryHost() {
  const location = useLocation();
  const routeRef = useRef(location.pathname);
  const fpsRef = useRef(0);
  const longTaskCountRef = useRef(0);
  const longTaskMsRef = useRef(0);
  const lcpRef = useRef(0);
  const clsRef = useRef(0);

  useEffect(() => {
    routeRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    let frameCount = 0;
    let startedAt = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      frameCount += 1;
      const elapsed = now - startedAt;
      if (elapsed >= 1000) {
        fpsRef.current = round((frameCount * 1000) / elapsed);
        frameCount = 0;
        startedAt = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const observers: PerformanceObserver[] = [];
    const observe = (type: string, callback: PerformanceObserverCallback) => {
      try {
        const observer = new PerformanceObserver(callback);
        observer.observe({ type, buffered: true });
        observers.push(observer);
      } catch {
        // Some browsers do not expose every performance entry type.
      }
    };
    observe("longtask", (list) => {
      for (const entry of list.getEntries()) {
        longTaskCountRef.current += 1;
        longTaskMsRef.current += entry.duration;
      }
    });
    observe("largest-contentful-paint", (list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) lcpRef.current = last.startTime;
    });
    observe("layout-shift", (list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as any;
        if (!shift.hadRecentInput) clsRef.current += Number(shift.value ?? 0);
      }
    });
    return () => observers.forEach((observer) => observer.disconnect());
  }, []);

  useEffect(() => {
    const report = () => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const paints = performance.getEntriesByType("paint");
      const firstPaint = paints.find((entry) => entry.name === "first-paint");
      const firstContentfulPaint = paints.find((entry) => entry.name === "first-contentful-paint");
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const apiDurations = resources
        .filter((entry) => (entry.initiatorType === "fetch" || entry.initiatorType === "xmlhttprequest") && entry.name.includes("/api/"))
        .slice(-80)
        .map((entry) => entry.duration)
        .filter((duration) => Number.isFinite(duration));
      const memory = (performance as any).memory;
      void postClientPerformanceSample({
        route: routeRef.current,
        fps: fpsRef.current,
        memoryMb: memory ? round(memory.usedJSHeapSize / 1024 / 1024) : undefined,
        heapLimitMb: memory ? round(memory.jsHeapSizeLimit / 1024 / 1024) : undefined,
        navigationMs: navigation ? round(navigation.duration) : undefined,
        firstPaintMs: firstPaint ? round(firstPaint.startTime) : undefined,
        firstContentfulPaintMs: firstContentfulPaint ? round(firstContentfulPaint.startTime) : undefined,
        largestContentfulPaintMs: lcpRef.current ? round(lcpRef.current) : undefined,
        cumulativeLayoutShift: round(clsRef.current, 3),
        longTaskCount: longTaskCountRef.current,
        longTaskMs: round(longTaskMsRef.current),
        resourceCount: resources.length,
        apiAvgMs: round(apiDurations.reduce((sum, value) => sum + value, 0) / Math.max(1, apiDurations.length)),
        apiP95Ms: round(percentile(apiDurations, 95)),
      });
    };
    const id = window.setInterval(report, 5000);
    window.setTimeout(report, 1200);
    return () => window.clearInterval(id);
  }, []);

  return null;
}
