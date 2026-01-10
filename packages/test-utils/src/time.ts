let originalDateNow: (() => number) | null = null;
let frozenTime: number | null = null;

export function freezeTime(isoTime?: string): void {
  if (!originalDateNow) {
    originalDateNow = Date.now;
  }
  const now = originalDateNow();
  if (isoTime) {
    const parsed = Date.parse(isoTime);
    if (Number.isNaN(parsed)) {
      throw new Error(`freezeTime received invalid ISO time: ${isoTime}`);
    }
    frozenTime = parsed;
  } else {
    frozenTime = now;
  }
  Date.now = () => (frozenTime ?? originalDateNow?.() ?? now);
}

export function advanceTime(ms: number): void {
  if (frozenTime === null) {
    throw new Error('advanceTime called without freezeTime; call freezeTime first.');
  }
  frozenTime += ms;
}

export function mockDateNow(fakeNow: number): () => void {
  if (!originalDateNow) {
    originalDateNow = Date.now;
  }
  Date.now = () => fakeNow;
  return restoreTime;
}

export function restoreTime(): void {
  if (originalDateNow) {
    Date.now = originalDateNow;
  }
  frozenTime = null;
  originalDateNow = null;
}
