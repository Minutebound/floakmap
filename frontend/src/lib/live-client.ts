/**
 * Reconnecting websocket client for the live feed.
 *
 * Three behaviours worth knowing about:
 *
 * - Reconnects with exponential backoff and jitter. Without jitter, a backend
 *   restart brings every client back at the same instant and the stampede
 *   knocks it over again.
 * - Pauses when the tab is hidden. A phone in a pocket should not hold a
 *   socket open burning battery for a map nobody is looking at.
 * - Tracks sequence numbers. A gap means frames were dropped, so the client
 *   asks for a fresh snapshot rather than drawing a map it cannot trust.
 */
import type { ServerFrame, ConnectionState } from '@/lib/live-types';

export interface ClientFrameOut {
  type: 'subscribe' | 'viewport' | 'ping' | 'follow';
  subject_ids?: string[];
  bbox?: [number, number, number, number];
  follow_subject_id?: string | null;
}

interface Options {
  url: string;
  token: string;
  onFrame: (frame: ServerFrame) => void;
  onState?: (state: ConnectionState) => void;
  onGap?: () => void;
}

const BASE_DELAY = 1000;
const MAX_DELAY = 30000;
const HEARTBEAT_MS = 25000;

export class LiveClient {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private lastSeq = 0;
  private heartbeat?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private closed = false;
  private queue: ClientFrameOut[] = [];

  constructor(private opts: Options) {}

  connect() {
    this.closed = false;
    this.open();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      this.ws?.close(1000, 'tab hidden');
    } else if (!this.closed && this.ws?.readyState !== WebSocket.OPEN) {
      this.attempts = 0;
      this.open();
    }
  };

  private open() {
    this.opts.onState?.(this.attempts === 0 ? 'connecting' : 'retrying');
    const url = `${this.opts.url}?token=${encodeURIComponent(this.opts.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.opts.onState?.('live');
      this.queue.forEach((f) => ws.send(JSON.stringify(f)));
      this.queue = [];
      this.heartbeat = setInterval(() => this.send({ type: 'ping' }), HEARTBEAT_MS);
    };

    ws.onmessage = (ev) => {
      const frame = JSON.parse(ev.data) as ServerFrame;
      if (frame.type === 'pong') return;
      if (frame.seq > 0 && this.lastSeq > 0 && frame.seq > this.lastSeq + 1) {
        this.opts.onGap?.();
      }
      this.lastSeq = frame.seq || this.lastSeq;
      this.opts.onFrame(frame);
    };

    ws.onclose = (ev) => {
      clearInterval(this.heartbeat);
      if (this.closed) return;
      // 4401 is our auth rejection: retrying with the same bad token is futile.
      if (ev.code === 4401) {
        this.opts.onState?.('closed');
        return;
      }
      this.scheduleRetry();
    };

    ws.onerror = () => ws.close();
  }

  private scheduleRetry() {
    this.attempts += 1;
    const backoff = Math.min(BASE_DELAY * 2 ** (this.attempts - 1), MAX_DELAY);
    const jitter = backoff * (0.5 + Math.random() * 0.5);
    this.opts.onState?.('retrying');
    this.retry = setTimeout(() => this.open(), jitter);
  }

  send(frame: ClientFrameOut) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    } else if (frame.type !== 'ping') {
      this.queue = [...this.queue.filter((f) => f.type !== frame.type), frame];
    }
  }

  /** Called on map moveend so the server stops sending what is off screen. */
  setViewport(bbox: [number, number, number, number]) {
    this.send({ type: 'viewport', bbox });
  }

  follow(subjectId: string | null) {
    this.send({ type: 'follow', follow_subject_id: subjectId });
  }

  close() {
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.ws?.close(1000, 'client closed');
    this.opts.onState?.('closed');
  }
}
