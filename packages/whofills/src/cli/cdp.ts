/** The little of the Chrome DevTools Protocol the CLI needs, over Node's built-in WebSocket. No dependencies. */

type Listener = (params: any, sessionId?: string) => void;

export class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, Listener[]>();
  closed: Promise<void>;

  private constructor(private ws: WebSocket) {
    this.closed = new Promise((resolve) => {
      ws.addEventListener("close", () => {
        for (const p of this.pending.values()) p.reject(new Error("connection closed"));
        this.pending.clear();
        resolve();
      });
    });
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p?.reject(new Error(m.error.message));
        else p?.resolve(m.result);
      } else for (const l of this.listeners.get(m.method) ?? []) l(m.params, m.sessionId);
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Cdp(ws)), { once: true });
      ws.addEventListener("error", () => reject(new Error("could not connect to the browser")), { once: true });
    });
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) return reject(new Error("connection closed"));
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(method: string, listener: Listener) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }

  close() {
    this.ws.close();
  }
}

export async function browserEndpoint(port: number): Promise<string | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`);
    return ((await r.json()) as { webSocketDebuggerUrl?: string }).webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  }
}
