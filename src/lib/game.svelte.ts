// Live connection to one campaign. Reconnects on its own (phones lock their screens all the time)
// and re-identifies the phone with its stored device token.
import type { ClientMsg, PublicView, ServerMsg, YouView } from "../../shared/types";

const tokenKey = (code: string) => `aidm-token-${code}`;

export class GameConnection {
  view = $state<PublicView | null>(null);
  you = $state<YouView | null>(null);
  connected = $state(false);
  needsJoin = $state(false);
  error = $state<string | null>(null);
  notFound = $state(false);

  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  private errorTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    public code: string,
    private role: "screen" | "phone",
  ) {
    this.connect();
    document.addEventListener("visibilitychange", this.onVisible);
  }

  get token() {
    return localStorage.getItem(tokenKey(this.code)) ?? undefined;
  }

  private onVisible = () => {
    if (document.visibilityState === "visible" && !this.connected) this.connect();
  };

  private connect() {
    if (this.closed) return;
    this.ws?.close();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/${this.code}`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      if (this.role === "screen") this.raw({ t: "hello", role: "screen" });
      else if (this.token) this.raw({ t: "hello", role: "phone", token: this.token });
      else this.needsJoin = true;
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data) as ServerMsg);
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.connected = false;
      if (e.code === 1000 && e.reason === "Campaign deleted") this.notFound = true;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.closed || this.notFound) return;
    const delay = Math.min(10000, 500 * 2 ** this.retry++);
    setTimeout(() => !this.connected && this.connect(), delay);
    // A missing campaign closes the upgrade with 404; check once so the UI can say so.
    if (this.retry === 2)
      fetch(`/api/campaigns/${this.code}`).then((r) => {
        if (r.status === 404) this.notFound = true;
      });
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case "state":
        this.view = m.view;
        this.you = m.you;
        if (m.you) this.needsJoin = false;
        break;
      case "welcome":
        localStorage.setItem(tokenKey(this.code), m.token);
        break;
      case "unknown_token":
        localStorage.removeItem(tokenKey(this.code));
        this.needsJoin = true;
        break;
      case "error":
        this.error = m.message;
        clearTimeout(this.errorTimer);
        this.errorTimer = setTimeout(() => (this.error = null), 5000);
        break;
    }
  }

  private raw(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  send(m: ClientMsg) {
    if (!this.connected) {
      this.error = "Reconnecting… try again in a moment.";
      return;
    }
    this.raw(m);
  }

  destroy() {
    this.closed = true;
    document.removeEventListener("visibilitychange", this.onVisible);
    this.ws?.close();
  }
}
