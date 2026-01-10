export interface TestWsClientOptions {
  url: string;
  protocols?: string | string[];
}

export interface WsEvent<T = unknown> {
  type: string;
  payload: T;
  receivedAt: string;
}

export class TestWsClient {
  private socket: WebSocket;
  private events: WsEvent[] = [];
  private openPromise: Promise<void>;

  constructor({ url, protocols }: TestWsClientOptions) {
    this.socket = new WebSocket(url, protocols);
    this.openPromise = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve());
      this.socket.addEventListener('error', (event) => reject(event));
    });

    this.socket.addEventListener('message', (event) => {
      const payload = normalizeWsPayload(event.data);
      this.events.push({
        type: 'message',
        payload,
        receivedAt: new Date().toISOString()
      });
    });
  }

  async waitForOpen(): Promise<void> {
    await this.openPromise;
  }

  send(message: string): void {
    this.socket.send(message);
  }

  close(): void {
    this.socket.close();
  }

  getEvents(): WsEvent[] {
    return this.events;
  }
}

export async function createTestWsClient(options: TestWsClientOptions): Promise<TestWsClient> {
  const client = new TestWsClient(options);
  await client.waitForOpen();
  return client;
}

export async function waitForWsEvent<T>(
  events: WsEvent<T>[],
  matcher: (event: WsEvent<T>) => boolean,
  timeoutMs = 2000
): Promise<WsEvent<T>> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const match = events.find(matcher);
      if (match) {
        clearInterval(interval);
        resolve(match);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Timed out waiting for WebSocket event after ${timeoutMs}ms`));
      }
    }, 25);
  });
}

export function mockWsHub() {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();

  return {
    on(event: string, handler: (payload: unknown) => void) {
      const existing = listeners.get(event) ?? [];
      existing.push(handler);
      listeners.set(event, existing);
    },
    emit(event: string, payload: unknown) {
      const handlers = listeners.get(event) ?? [];
      for (const handler of handlers) {
        handler(payload);
      }
    }
  };
}

function normalizeWsPayload(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data as Uint8Array);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return '[blob]';
  }
  return String(data);
}
