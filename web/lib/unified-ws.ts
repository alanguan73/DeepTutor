/**
 * Fork compatibility shim over the validated v2 turn transport.
 *
 * The psych-academy workspace pages (counsel / sim / dual / intake / observe /
 * distill / companion) still speak the historical `UnifiedWSClient` surface.
 * v1.6.6 replaced that client with `UnifiedTurnClient` (protocol 2.0, which the
 * backend rejects requests without), so this shim keeps the old constructor
 * shape — `new UnifiedWSClient(onEvent, onClose)`, `.connect()`, `.send()`,
 * `.disconnect()`, `.connected`, `.setResumeState()` — while every frame on
 * the wire is stamped `protocol_version: "2.0"` by the runtime client.
 */

import { UnifiedTurnClient } from "@/features/chat/transport/UnifiedTurnClient";
import type {
  ChatMessage,
  StreamEvent,
  StreamEventType,
  LLMSelection,
} from "@/features/chat/model/protocol";

export type { ChatMessage, LLMSelection, StreamEvent, StreamEventType };

export type StreamEventTypeAlias = StreamEventType;

export type {
  StartTurnMessage,
  SubscribeTurnMessage,
  SubscribeSessionMessage,
  ResumeTurnMessage,
  UnsubscribeMessage,
  CancelTurnMessage,
  RegenerateMessage,
  SubmitUserReplyMessage,
} from "@/features/chat/model/protocol";

export type StartTurnMessageCompat = ChatMessage;

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;

export class UnifiedWSClient {
  private runtime: UnifiedTurnClient;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastReceivedAt = 0;

  constructor(onEvent: (event: StreamEvent) => void, onClose?: () => void) {
    this.runtime = new UnifiedTurnClient((event) => {
      this.lastReceivedAt = Date.now();
      if (event.type === ("pong" as StreamEventType)) return;
      onEvent(event);
    }, onClose);
  }

  setResumeState(turnId: string | null, seq: number): void {
    this.runtime.setResumeState(turnId, seq);
  }

  connect(): void {
    this.runtime.connect();
    this.startHeartbeat();
  }

  send(msg: ChatMessage): void {
    if (!this.connected) {
      console.error("WebSocket not connected");
      return;
    }
    this.runtime.send(msg);
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.runtime.disconnect();
  }

  get connected(): boolean {
    return this.runtime.connected;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastReceivedAt > HEARTBEAT_TIMEOUT_MS) {
        this.runtime.disconnect();
        this.runtime.connect();
        return;
      }
      try {
        this.runtime.send({ type: "ping" } as unknown as ChatMessage);
      } catch {
        // socket may be closing
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
