/**
 * Performance Monitor
 *
 * Runtime performance monitoring utilities for tracking
 * Core Web Vitals and custom metrics.
 */

export interface PerformanceMetrics {
  // Core Web Vitals
  fcp: number | null; // First Contentful Paint
  lcp: number | null; // Largest Contentful Paint
  fid: number | null; // First Input Delay
  cls: number | null; // Cumulative Layout Shift
  ttfb: number | null; // Time to First Byte
  inp: number | null; // Interaction to Next Paint

  // Custom metrics
  jsHeapSize: number | null;
  domNodes: number | null;
  longTasks: number;
  frameRate: number | null;
}

export interface LongTaskEntry {
  startTime: number;
  duration: number;
  name: string;
}

export interface PerformanceReport {
  metrics: PerformanceMetrics;
  longTasks: LongTaskEntry[];
  timestamp: number;
  url: string;
}

type MetricCallback = (metrics: PerformanceMetrics) => void;

class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    fcp: null,
    lcp: null,
    fid: null,
    cls: null,
    ttfb: null,
    inp: null,
    jsHeapSize: null,
    domNodes: null,
    longTasks: 0,
    frameRate: null,
  };

  private longTasks: LongTaskEntry[] = [];
  private observers: PerformanceObserver[] = [];
  private frameRateInterval: ReturnType<typeof setInterval> | null = null;
  private callbacks: Set<MetricCallback> = new Set();

  constructor() {
    if (typeof window === 'undefined') return;
    this.initObservers();
  }

  /**
   * Initialize performance observers
   */
  private initObservers(): void {
    // First Contentful Paint
    this.observePaint();

    // Largest Contentful Paint
    this.observeLCP();

    // First Input Delay
    this.observeFID();

    // Cumulative Layout Shift
    this.observeCLS();

    // Interaction to Next Paint
    this.observeINP();

    // Long Tasks
    this.observeLongTasks();

    // Navigation timing (TTFB)
    this.observeNavigation();
  }

  private observePaint(): void {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            this.metrics.fcp = entry.startTime;
            this.notifyCallbacks();
          }
        }
      });
      observer.observe({ type: 'paint', buffered: true });
      this.observers.push(observer);
    } catch (e) {
      console.debug('[PerfMonitor] Paint observer not supported');
    }
  }

  private observeLCP(): void {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        if (lastEntry) {
          this.metrics.lcp = lastEntry.startTime;
          this.notifyCallbacks();
        }
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      this.observers.push(observer);
    } catch (e) {
      console.debug('[PerfMonitor] LCP observer not supported');
    }
  }

  private observeFID(): void {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // FID is the first interaction
          if (this.metrics.fid === null) {
            this.metrics.fid = (entry as PerformanceEventTiming).processingStart - entry.startTime;
            this.notifyCallbacks();
          }
        }
      });
      observer.observe({ type: 'first-input', buffered: true });
      this.observers.push(observer);
    } catch (e) {
      console.debug('[PerfMonitor] FID observer not supported');
    }
  }

  private observeCLS(): void {
    try {
      let clsValue = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const layoutShift = entry as PerformanceEntry & {
            hadRecentInput?: boolean;
            value?: number;
          };
          if (!layoutShift.hadRecentInput) {
            clsValue += layoutShift.value || 0;
            this.metrics.cls = clsValue;
            this.notifyCallbacks();
          }
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });
      this.observers.push(observer);
    } catch (e) {
      console.debug('[PerfMonitor] CLS observer not supported');
    }
  }

  private observeINP(): void {
    try {
      const interactions: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const eventEntry = entry as PerformanceEventTiming;
          if (eventEntry.interactionId) {
            const duration = eventEntry.duration;
            interactions.push(duration);
            // INP is p75 of all interactions
            interactions.sort((a, b) => a - b);
            const p75Index = Math.floor(interactions.length * 0.75);
            this.metrics.inp = interactions[p75Index];
            this.notifyCallbacks();
          }
        }
      });
      observer.observe({ type: 'event', buffered: true });
      this.observers.push(observer);
    } catch (e) {
      console.debug('[PerfMonitor] INP observer not supported');
    }
  }

  private observeLongTasks(): void {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.metrics.longTasks++;
          this.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
          });
          // Keep only last 100 long tasks
          if (this.longTasks.length > 100) {
            this.longTasks.shift();
          }
          this.notifyCallbacks();
        }
      });
      observer.observe({ type: 'longtask' });
      this.observers.push(observer);
    } catch (e) {
      console.debug('[PerfMonitor] Long tasks observer not supported');
    }
  }

  private observeNavigation(): void {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const navEntry = entry as PerformanceNavigationTiming;
          this.metrics.ttfb = navEntry.responseStart - navEntry.requestStart;
          this.notifyCallbacks();
        }
      });
      observer.observe({ type: 'navigation', buffered: true });
      this.observers.push(observer);
    } catch (e) {
      console.debug('[PerfMonitor] Navigation observer not supported');
    }
  }

  /**
   * Start frame rate monitoring
   */
  startFrameRateMonitoring(sampleInterval = 1000): void {
    if (this.frameRateInterval) return;

    let lastTime = performance.now();
    let frameCount = 0;

    const measureFrame = () => {
      frameCount++;
      requestAnimationFrame(measureFrame);
    };
    requestAnimationFrame(measureFrame);

    this.frameRateInterval = setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTime;
      this.metrics.frameRate = Math.round((frameCount * 1000) / elapsed);
      frameCount = 0;
      lastTime = now;
      this.notifyCallbacks();
    }, sampleInterval);
  }

  /**
   * Stop frame rate monitoring
   */
  stopFrameRateMonitoring(): void {
    if (this.frameRateInterval) {
      clearInterval(this.frameRateInterval);
      this.frameRateInterval = null;
    }
  }

  /**
   * Update memory and DOM metrics (call periodically)
   */
  updateRuntimeMetrics(): void {
    if (typeof window === 'undefined') return;

    // Memory usage (Chrome only)
    const memory = (performance as Performance & { memory?: {
      usedJSHeapSize: number;
    } }).memory;
    if (memory) {
      this.metrics.jsHeapSize = memory.usedJSHeapSize;
    }

    // DOM node count
    if (typeof document !== 'undefined') {
      this.metrics.domNodes = document.querySelectorAll('*').length;
    }

    this.notifyCallbacks();
  }

  /**
   * Subscribe to metric updates
   */
  subscribe(callback: MetricCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  private notifyCallbacks(): void {
    for (const callback of this.callbacks) {
      callback(this.getMetrics());
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Get performance report
   */
  getReport(): PerformanceReport {
    return {
      metrics: this.getMetrics(),
      longTasks: [...this.longTasks],
      timestamp: Date.now(),
      url: typeof window !== 'undefined' ? window.location.href : '',
    };
  }

  /**
   * Check if metrics pass thresholds
   */
  checkThresholds(thresholds: Partial<Record<keyof PerformanceMetrics, number>>): {
    passed: boolean;
    failures: string[];
  } {
    const failures: string[] = [];

    for (const [key, threshold] of Object.entries(thresholds)) {
      const value = this.metrics[key as keyof PerformanceMetrics];
      if (value !== null && typeof value === 'number' && value > threshold) {
        failures.push(`${key}: ${value.toFixed(2)} > ${threshold}`);
      }
    }

    return {
      passed: failures.length === 0,
      failures,
    };
  }

  /**
   * Get Web Vitals rating (good/needs-improvement/poor)
   */
  getWebVitalsRating(): Record<string, 'good' | 'needs-improvement' | 'poor' | 'unknown'> {
    const ratings: Record<string, 'good' | 'needs-improvement' | 'poor' | 'unknown'> = {};

    // LCP thresholds: good < 2.5s, poor > 4s
    if (this.metrics.lcp !== null) {
      if (this.metrics.lcp < 2500) ratings.lcp = 'good';
      else if (this.metrics.lcp < 4000) ratings.lcp = 'needs-improvement';
      else ratings.lcp = 'poor';
    } else {
      ratings.lcp = 'unknown';
    }

    // FID thresholds: good < 100ms, poor > 300ms
    if (this.metrics.fid !== null) {
      if (this.metrics.fid < 100) ratings.fid = 'good';
      else if (this.metrics.fid < 300) ratings.fid = 'needs-improvement';
      else ratings.fid = 'poor';
    } else {
      ratings.fid = 'unknown';
    }

    // CLS thresholds: good < 0.1, poor > 0.25
    if (this.metrics.cls !== null) {
      if (this.metrics.cls < 0.1) ratings.cls = 'good';
      else if (this.metrics.cls < 0.25) ratings.cls = 'needs-improvement';
      else ratings.cls = 'poor';
    } else {
      ratings.cls = 'unknown';
    }

    // INP thresholds: good < 200ms, poor > 500ms
    if (this.metrics.inp !== null) {
      if (this.metrics.inp < 200) ratings.inp = 'good';
      else if (this.metrics.inp < 500) ratings.inp = 'needs-improvement';
      else ratings.inp = 'poor';
    } else {
      ratings.inp = 'unknown';
    }

    // TTFB thresholds: good < 800ms, poor > 1800ms
    if (this.metrics.ttfb !== null) {
      if (this.metrics.ttfb < 800) ratings.ttfb = 'good';
      else if (this.metrics.ttfb < 1800) ratings.ttfb = 'needs-improvement';
      else ratings.ttfb = 'poor';
    } else {
      ratings.ttfb = 'unknown';
    }

    return ratings;
  }

  /**
   * Disconnect all observers
   */
  disconnect(): void {
    for (const observer of this.observers) {
      observer.disconnect();
    }
    this.observers = [];
    this.stopFrameRateMonitoring();
  }
}

// Singleton instance
let monitorInstance: PerformanceMonitor | null = null;

/**
 * Get the performance monitor singleton
 */
export function getPerformanceMonitor(): PerformanceMonitor {
  if (!monitorInstance) {
    monitorInstance = new PerformanceMonitor();
  }
  return monitorInstance;
}

/**
 * Create a new performance mark
 */
export function mark(name: string): void {
  performance.mark(name);
}

/**
 * Measure between two marks
 */
export function measure(name: string, startMark: string, endMark?: string): number {
  const end = endMark || name;
  performance.measure(name, startMark, end);
  const entries = performance.getEntriesByName(name, 'measure');
  return entries[entries.length - 1]?.duration ?? 0;
}

/**
 * Time a function execution
 */
export async function timeExecution<T>(
  name: string,
  fn: () => T | Promise<T>
): Promise<{ result: T; duration: number }> {
  const startMark = `${name}-start`;
  const endMark = `${name}-end`;

  mark(startMark);
  const result = await fn();
  mark(endMark);

  const duration = measure(name, startMark, endMark);

  return { result, duration };
}

export { PerformanceMonitor };
