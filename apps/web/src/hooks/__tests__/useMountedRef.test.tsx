/**
 * Tests for useMountedRef Hook - setState safety for async callbacks.
 *
 * Test Cases from bd-1v08:
 * 1. Mount ref tracking - verify returns correct value before/after unmount
 * 2. State update guard - verify setState calls are skipped when unmounted
 * 3. Callback safety - async callbacks don't update state after unmount
 * 4. Cleanup verification - refs are properly cleaned up
 * 5. No React warnings - verify no 'setState on unmounted' warnings
 */

import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useState, useEffect, useCallback } from "react";
import { useMountedRef } from "../useMountedRef";

// Wrap in try-catch to avoid errors when running with other test files that already registered
try {
  GlobalRegistrator.register();
} catch {
  // Already registered by another test file
}

// ============================================================================
// Test Components
// ============================================================================

/**
 * Simple component that exposes the mount ref value via callback.
 */
function MountRefTracker({
  onRefChange,
}: {
  onRefChange: (mounted: boolean) => void;
}) {
  const isMounted = useMountedRef();

  useEffect(() => {
    // Report mount ref value after each render
    onRefChange(isMounted.current);
  });

  return <div data-testid="tracker">Mounted: {String(isMounted.current)}</div>;
}

/**
 * Component that demonstrates guarded setState in async callbacks.
 */
function AsyncStateUpdater({
  delay,
  onAttemptSetState,
}: {
  delay: number;
  onAttemptSetState?: (skipped: boolean) => void;
}) {
  const isMounted = useMountedRef();
  const [value, setValue] = useState("initial");

  const updateAsync = useCallback(async () => {
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Guard against setState after unmount
    if (!isMounted.current) {
      onAttemptSetState?.(true); // Skipped
      return;
    }

    onAttemptSetState?.(false); // Not skipped
    setValue("updated");
  }, [delay, isMounted, onAttemptSetState]);

  useEffect(() => {
    updateAsync();
  }, [updateAsync]);

  return <div data-testid="value">{value}</div>;
}

/**
 * Component that tracks console.error calls for React warnings.
 */
function StateWarningTester({
  triggerWarning,
}: {
  triggerWarning: boolean;
}) {
  const isMounted = useMountedRef();
  const [state, setState] = useState(0);

  useEffect(() => {
    if (triggerWarning) {
      // Simulate async callback that completes after unmount
      setTimeout(() => {
        if (!isMounted.current) return;
        setState((s) => s + 1);
      }, 100);
    }
  }, [triggerWarning, isMounted]);

  return <div data-testid="state">{state}</div>;
}

// ============================================================================
// Test Suite
// ============================================================================

describe("useMountedRef", () => {
  describe("mount ref tracking", () => {
    it("returns false during initial render before useEffect", () => {
      // The ref starts as false and becomes true in useEffect
      const values: boolean[] = [];

      function Tracker() {
        const isMounted = useMountedRef();
        // Capture value during render (before useEffect runs)
        values.push(isMounted.current);

        useEffect(() => {
          // After mount, capture again
          values.push(isMounted.current);
        }, [isMounted]);

        return null;
      }

      render(<Tracker />);

      // First capture is during render (before useEffect) - should be false
      // Second capture is in useEffect (after mount) - should be true
      expect(values[0]).toBe(false);
      expect(values[1]).toBe(true);
    });

    it("returns true after component mounts", () => {
      let mountedValue = false;

      render(
        <MountRefTracker
          onRefChange={(mounted) => {
            mountedValue = mounted;
          }}
        />,
      );

      // After render and useEffect, should be true
      expect(mountedValue).toBe(true);
    });

    it("returns false after component unmounts", async () => {
      const values: boolean[] = [];

      function Tracker() {
        const isMounted = useMountedRef();

        useEffect(() => {
          return () => {
            // Capture value in cleanup (should be false)
            values.push(isMounted.current);
          };
        }, [isMounted]);

        return null;
      }

      const { unmount } = render(<Tracker />);

      // Unmount and check cleanup captured false
      unmount();

      expect(values[0]).toBe(false);
    });
  });

  describe("state update guard", () => {
    it("allows setState when component is mounted", async () => {
      let stateSkipped: boolean | null = null;

      const { getByTestId } = render(
        <AsyncStateUpdater
          delay={10}
          onAttemptSetState={(skipped) => {
            stateSkipped = skipped;
          }}
        />,
      );

      // Wait for async update
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(stateSkipped).not.toBeNull();
      expect(stateSkipped as boolean).toBe(false);
      expect(getByTestId("value").textContent).toBe("updated");
    });

    it("skips setState when component is unmounted", async () => {
      let stateSkipped: boolean | null = null;

      const { unmount } = render(
        <AsyncStateUpdater
          delay={100}
          onAttemptSetState={(skipped) => {
            stateSkipped = skipped;
          }}
        />,
      );

      // Unmount before async completes
      unmount();

      // Wait for async to complete
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      expect(stateSkipped).not.toBeNull();
      expect(stateSkipped as boolean).toBe(true);
    });
  });

  describe("cleanup verification", () => {
    it("properly sets ref to false on unmount", () => {
      let refDuringCleanup: boolean | null = null;

      function Tracker() {
        const isMounted = useMountedRef();

        useEffect(() => {
          return () => {
            // Capture ref value during cleanup
            refDuringCleanup = isMounted.current;
          };
        }, [isMounted]);

        return <div>test</div>;
      }

      const { unmount } = render(<Tracker />);
      unmount();

      // The ref should be false during cleanup
      expect(refDuringCleanup).not.toBeNull();
      expect(refDuringCleanup as boolean).toBe(false);
    });
  });

  describe("React warning prevention", () => {
    it("does not produce setState warnings when properly guarded", async () => {
      // Spy on console.error to detect React warnings
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        const message = String(args[0]);
        if (
          message.includes("unmounted") ||
          message.includes("memory leak") ||
          message.includes("Can't perform a React state update")
        ) {
          errors.push(message);
        }
        // Don't call originalError to avoid polluting test output
      };

      try {
        const { unmount } = render(<StateWarningTester triggerWarning={true} />);

        // Unmount before the setTimeout completes
        unmount();

        // Wait for the setTimeout to fire
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 150));
        });

        // Should have no React warnings
        expect(errors).toHaveLength(0);
      } finally {
        console.error = originalError;
      }
    });
  });

  describe("multiple components", () => {
    it("tracks mount state independently for each component", () => {
      const values: Map<string, boolean> = new Map();

      function Tracker({ id }: { id: string }) {
        const isMounted = useMountedRef();

        useEffect(() => {
          values.set(id, isMounted.current);
          return () => {
            values.set(id, isMounted.current);
          };
        }, [id, isMounted]);

        return <div>{id}</div>;
      }

      const { unmount: unmount1 } = render(<Tracker id="a" />);
      const { unmount: unmount2 } = render(<Tracker id="b" />);

      // Both should be mounted
      expect(values.get("a")).toBe(true);
      expect(values.get("b")).toBe(true);

      // Unmount only one
      unmount1();

      // a should be false, b should still be true
      expect(values.get("a")).toBe(false);
      expect(values.get("b")).toBe(true);

      unmount2();
      expect(values.get("b")).toBe(false);
    });
  });
});
