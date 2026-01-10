export interface TestClientOptions {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
}

export interface TestClientRequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
}

export interface TestClient {
  request: (method: string, path: string, options?: TestClientRequestOptions) => Promise<Response>;
  get: (path: string, options?: TestClientRequestOptions) => Promise<Response>;
  post: (path: string, options?: TestClientRequestOptions) => Promise<Response>;
  put: (path: string, options?: TestClientRequestOptions) => Promise<Response>;
  del: (path: string, options?: TestClientRequestOptions) => Promise<Response>;
}

export function createTestClient(options: TestClientOptions): TestClient {
  const { baseUrl, defaultHeaders } = options;

  const request = async (
    method: string,
    path: string,
    reqOptions: TestClientRequestOptions = {}
  ): Promise<Response> => {
    const headers: Record<string, string> = {
      ...(defaultHeaders ?? {}),
      ...(reqOptions.headers ?? {})
    };

    let body: BodyInit | undefined;
    if (reqOptions.body !== undefined) {
      body = JSON.stringify(reqOptions.body);
      headers['content-type'] = headers['content-type'] ?? 'application/json';
    }

    return fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body
    });
  };

  return {
    request,
    get: (path, reqOptions) => request('GET', path, reqOptions),
    post: (path, reqOptions) => request('POST', path, reqOptions),
    put: (path, reqOptions) => request('PUT', path, reqOptions),
    del: (path, reqOptions) => request('DELETE', path, reqOptions)
  };
}

export function mockAuthContext(token = 'test-token'): { headers: Record<string, string> } {
  return {
    headers: {
      authorization: `Bearer ${token}`
    }
  };
}

export async function assertApiResponse<T = unknown>(
  response: Response,
  expectations: { status?: number; body?: Partial<T> } = {}
): Promise<T | undefined> {
  const { status, body } = expectations;
  if (status !== undefined && response.status !== status) {
    throw new Error(`Expected status ${status}, got ${response.status}`);
  }

  if (!body) {
    return undefined;
  }

  const data = (await response.json()) as T;
  for (const [key, value] of Object.entries(body)) {
    const actual = (data as Record<string, unknown>)[key];
    if (actual !== value) {
      throw new Error(`Expected response body ${key}=${String(value)}, got ${String(actual)}`);
    }
  }

  return data;
}
