/**
 * Type declarations to extend bun:test's Matchers with @testing-library/jest-dom matchers.
 */

import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  interface Matchers<T = unknown>
    extends TestingLibraryMatchers<typeof expect.stringContaining, T> {}
}
