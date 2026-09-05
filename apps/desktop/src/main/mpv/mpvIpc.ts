import { createConnection, type Socket } from "node:net";

/**
 * A minimal client for mpv's JSON IPC protocol over a Windows named pipe
 * (`--input-ipc-server=\\.\pipe\<name>`). One newline-delimited JSON command per line in,
 * one newline-delimited JSON reply/event per line out. See:
 * https://mpv.io/manual/master/#json-ipc
 */
export class MpvIpcClient {
  private socket: Socket | null = null;
  private buffer = "";
  private requestId = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly propertyListeners = new Map<string, Set<(value: unknown) => void>>();

  constructor(private readonly pipeName: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.pipeName);
      const onError = (error: Error) => reject(error);
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.off("error", onError);
        socket.on("data", (chunk) => this.handleData(chunk));
        socket.on("error", (error) => this.rejectAllPending(error));
        this.socket = socket;
        resolve();
      });
    });
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf-8");
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.trim().length === 0) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // malformed line from mpv — ignore rather than crash the bridge
    }

    if (typeof message["request_id"] === "number") {
      const pending = this.pending.get(message["request_id"]);
      if (!pending) return;
      this.pending.delete(message["request_id"]);
      if (message["error"] === "success") pending.resolve(message["data"]);
      else pending.reject(new Error(String(message["error"])));
      return;
    }

    if (message["event"] === "property-change" && typeof message["name"] === "string") {
      const listeners = this.propertyListeners.get(message["name"]);
      listeners?.forEach((listener) => listener(message["data"]));
    }
  }

  private rejectAllPending(error: Error): void {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  command<T = unknown>(args: readonly unknown[]): Promise<T> {
    if (!this.socket) return Promise.reject(new Error("mpv IPC socket is not connected"));
    const id = ++this.requestId;
    const payload = JSON.stringify({ command: args, request_id: id }) + "\n";
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket?.write(payload, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  setProperty(name: string, value: unknown): Promise<void> {
    return this.command(["set_property", name, value]);
  }

  getProperty<T = unknown>(name: string): Promise<T> {
    return this.command<T>(["get_property", name]);
  }

  /** Subscribes to change events for an observed property. Call `observeProperty` once per name first. */
  onPropertyChange(name: string, listener: (value: unknown) => void): () => void {
    let set = this.propertyListeners.get(name);
    if (!set) {
      set = new Set();
      this.propertyListeners.set(name, set);
    }
    set.add(listener);
    return () => set?.delete(listener);
  }

  private observedIds = new Map<string, number>();

  async observeProperty(name: string): Promise<void> {
    if (this.observedIds.has(name)) return;
    const id = this.observedIds.size + 1;
    this.observedIds.set(name, id);
    await this.command(["observe_property", id, name]);
  }

  close(): void {
    this.socket?.end();
    this.socket = null;
    this.rejectAllPending(new Error("mpv IPC connection closed"));
  }
}
