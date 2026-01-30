import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Tooltip } from "../Tooltip";

try {
  GlobalRegistrator.register();
} catch {
  // Already registered by another test file
}

type ScheduledTimeout = {
  handle: ReturnType<typeof setTimeout>;
  delay: number | undefined;
};

describe("Tooltip", () => {
  const scheduled: ScheduledTimeout[] = [];
  const cleared: unknown[] = [];
  let originalSetTimeout: typeof setTimeout;
  let originalClearTimeout: typeof clearTimeout;

  beforeEach(() => {
    scheduled.length = 0;
    cleared.length = 0;

    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;

    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      const handle = originalSetTimeout(...args);
      scheduled.push({
        handle,
        delay: typeof args[1] === "number" ? args[1] : undefined,
      });
      return handle;
    }) as typeof setTimeout;

    globalThis.clearTimeout = ((...args: Parameters<typeof clearTimeout>) => {
      cleared.push(args[0]);
      return originalClearTimeout(...args);
    }) as typeof clearTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  it("clears pending show timeout on unmount", () => {
    const delay = 1234;
    const { getByRole, unmount } = render(
      <Tooltip content="tip" delay={delay}>
        <button type="button">Hover</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(getByRole("button", { name: "Hover" }));

    const scheduledShow = scheduled.filter((t) => t.delay === delay).at(-1);

    expect(scheduledShow).toBeDefined();

    unmount();

    expect(cleared).toContain(scheduledShow!.handle);
  });
});
