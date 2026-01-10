export interface ApiErrorExpectation {
  status: number;
  code?: string;
}

export async function expectApiError(response: Response, expectation: ApiErrorExpectation): Promise<void> {
  if (response.status !== expectation.status) {
    throw new Error(`Expected status ${expectation.status}, got ${response.status}`);
  }

  if (!expectation.code) {
    return;
  }

  const payload = (await response.json()) as { code?: string };
  if (payload.code !== expectation.code) {
    throw new Error(`Expected error code ${expectation.code}, got ${payload.code ?? 'undefined'}`);
  }
}

export function expectEvent<T>(
  events: T[],
  matcher: (event: T) => boolean,
  message = 'Expected event not found.'
): T {
  const match = events.find(matcher);
  if (!match) {
    throw new Error(message);
  }
  return match;
}

export function expectDatabaseState(
  rows: Array<Record<string, unknown>>,
  matcher: (row: Record<string, unknown>) => boolean,
  message = 'Expected database state not found.'
): Record<string, unknown> {
  const match = rows.find(matcher);
  if (!match) {
    throw new Error(message);
  }
  return match;
}
