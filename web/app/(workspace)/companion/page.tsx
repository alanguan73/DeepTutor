"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, Loader2 } from "lucide-react";
import CompanionComposer from "@/components/companion/CompanionComposer";
import CompanionMessageList, {
  type CompanionMessage,
} from "@/components/companion/CompanionMessageList";
import CompanionProgressPanel, {
  type CompanionProgress,
} from "@/components/companion/CompanionProgressPanel";
import CompanionVoiceBar from "@/components/companion/CompanionVoiceBar";
import {
  extractAskUserPayload,
  type AskUserPayload,
} from "@/components/chat/home/AskUserOptions";
import CounselAskUserCard from "@/components/counsel/CounselAskUserCard";
import { hasPendingAskUser } from "@/lib/ask-user-state";
import { looksLikeCrisisRedirect } from "@/lib/counsel-transcript";
import { apiFetch, apiUrl } from "@/lib/api";
import { CompanionVoiceController } from "@/lib/companion-voice";
import {
  companionTranscribe,
  companionSynthesizeAndPlay,
} from "@/lib/companion-voice-http";
import {
  UnifiedWSClient,
  type StartTurnMessage,
  type StreamEvent,
} from "@/lib/unified-ws";

function newMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function askUserPayloadFromToolCall(event: StreamEvent): AskUserPayload | null {
  const meta = (event.metadata || {}) as Record<string, unknown>;
  const args = meta.args;
  if (!args || typeof args !== "object") return null;
  const questions = (args as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  return {
    intro: null,
    questions: questions.map((q, idx) => {
      const row = q as Record<string, unknown>;
      return {
        id: String(row.id || `q${idx}`),
        prompt: String(row.prompt || ""),
        header: typeof row.header === "string" ? row.header : null,
        multi_select: false,
        options: [],
        allow_free_text: true,
        placeholder: null,
      };
    }),
  };
}

function parseProgressPayload(event: StreamEvent): CompanionProgress | null {
  const meta = (event.metadata || {}) as Record<string, unknown>;
  if (
    typeof meta.phase === "string" ||
    typeof meta.label === "string" ||
    Array.isArray(meta.known)
  ) {
    return {
      phase: String(meta.phase || ""),
      label: String(meta.label || meta.phase || ""),
      known: Array.isArray(meta.known)
        ? meta.known.map((x) => String(x)).filter(Boolean)
        : [],
      next_hint: String(meta.next_hint || ""),
    };
  }
  const raw = (event.content || "").trim();
  if (!raw.startsWith("{")) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      phase: String(data.phase || ""),
      label: String(data.label || data.phase || ""),
      known: Array.isArray(data.known)
        ? data.known.map((x) => String(x)).filter(Boolean)
        : [],
      next_hint: String(data.next_hint || ""),
    };
  } catch {
    return null;
  }
}

export default function CompanionPage() {
  const [messages, setMessages] = useState<CompanionMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [dtSessionId, setDtSessionId] = useState<string | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [crisisHit, setCrisisHit] = useState(false);
  const [progressUiOn, setProgressUiOn] = useState(false);
  const [progress, setProgress] = useState<CompanionProgress | null>(null);
  const [pendingAskUser, setPendingAskUser] = useState<AskUserPayload | null>(
    null,
  );
  const [recording, setRecording] = useState(false);

  const clientRef = useRef<UnifiedWSClient | null>(null);
  const sessionRef = useRef<string | null>(null);
  const turnIdRef = useRef<string | null>(null);
  const turnEventsRef = useRef<StreamEvent[]>([]);
  const assistantBufferRef = useRef<{ id: string; stage: string } | null>(null);
  const retryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const progressUiRef = useRef(false);
  const busyRef = useRef(false);
  const crisisHitRef = useRef(false);
  const lastAssistantTextRef = useRef("");
  const voiceRef = useRef<CompanionVoiceController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const holdActiveRef = useRef(false);
  const startTurnWithTextRef = useRef<(text: string) => void>(() => {});
  const handleInterruptRef = useRef<() => void>(() => {});

  useEffect(() => {
    sessionRef.current = dtSessionId;
  }, [dtSessionId]);

  useEffect(() => {
    turnIdRef.current = activeTurnId;
  }, [activeTurnId]);

  useEffect(() => {
    progressUiRef.current = progressUiOn;
  }, [progressUiOn]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    crisisHitRef.current = crisisHit;
  }, [crisisHit]);

  const appendAssistantContent = useCallback((text: string, stage: string) => {
    const normalized = stage || "responding";
    if (
      assistantBufferRef.current &&
      assistantBufferRef.current.stage === normalized
    ) {
      const targetId = assistantBufferRef.current.id;
      lastAssistantTextRef.current += text;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === targetId
            ? { ...m, text: m.text + text, stage: normalized }
            : m,
        ),
      );
      return;
    }
    const id = newMessageId();
    assistantBufferRef.current = { id, stage: normalized };
    lastAssistantTextRef.current = text;
    setMessages((prev) => [
      ...prev,
      { id, role: "assistant", text, stage: normalized },
    ]);
  }, []);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      turnEventsRef.current = [...turnEventsRef.current, event];

      if (event.turn_id) {
        turnIdRef.current = event.turn_id;
        setActiveTurnId(event.turn_id);
      }

      if (event.type === "session" || event.type === "session_meta") {
        const metadata = (event.metadata || {}) as Record<string, unknown>;
        const sessionId =
          typeof metadata.session_id === "string"
            ? metadata.session_id
            : typeof event.session_id === "string"
              ? event.session_id
              : "";
        if (sessionId) {
          sessionRef.current = sessionId;
          setDtSessionId(sessionId);
        }
        const tid =
          typeof metadata.turn_id === "string"
            ? metadata.turn_id
            : event.turn_id;
        if (tid) {
          turnIdRef.current = tid;
          setActiveTurnId(tid);
        }
        return;
      }

      if (event.type === "done") {
        const full = lastAssistantTextRef.current;
        if (full && !crisisHitRef.current) {
          void voiceRef.current?.speakAssistant(full);
        }
        assistantBufferRef.current = null;
        const card = extractAskUserPayload(turnEventsRef.current);
        if (card && !card.resolved) {
          setPendingAskUser(card.payload);
          setBusy(false);
          busyRef.current = false;
        } else {
          setPendingAskUser(null);
          setBusy(false);
          busyRef.current = false;
        }
        setConnected(true);
        setActiveTurnId(null);
        turnIdRef.current = null;
        return;
      }

      if (event.type === "error") {
        assistantBufferRef.current = null;
        setMessages((prev) => [
          ...prev,
          {
            id: newMessageId(),
            role: "system",
            text: event.content || "Something went wrong.",
          },
        ]);
        setBusy(false);
        busyRef.current = false;
        setPendingAskUser(null);
        setActiveTurnId(null);
        turnIdRef.current = null;
        return;
      }

      if (event.type === "tool_call" && event.content === "ask_user") {
        const payload = askUserPayloadFromToolCall(event);
        if (payload) setPendingAskUser(payload);
        return;
      }

      if (event.stage === "companion_progress") {
        const parsed = parseProgressPayload(event);
        if (parsed) setProgress(parsed);
        return;
      }

      if (event.type === "progress") {
        const meta = event.metadata || {};
        if (meta.ask_user_resolved) {
          setPendingAskUser(null);
        }
        if (event.stage === "companion_progress") {
          const parsed = parseProgressPayload(event);
          if (parsed) setProgress(parsed);
        }
        return;
      }

      if (event.type !== "content" || !event.content) return;

      const text = event.content;
      const stage = event.stage || "responding";
      if (stage === "companion_progress") return;

      appendAssistantContent(text, stage);

      if (looksLikeCrisisRedirect(text)) {
        crisisHitRef.current = true;
        setCrisisHit(true);
        setPendingAskUser(null);
      }
    },
    [appendAssistantContent],
  );

  useEffect(() => {
    const client = new UnifiedWSClient(handleEvent, () => {
      setBusy(false);
      busyRef.current = false;
      setConnected(false);
    });
    clientRef.current = client;
    setConnected(false);
    client.connect();

    const poll = window.setInterval(() => {
      if (client.connected) {
        setConnected(true);
        setEverConnected(true);
        window.clearInterval(poll);
      }
    }, 100);
    const giveUp = window.setTimeout(() => window.clearInterval(poll), 15_000);

    const retryTimers = retryTimersRef.current;
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(giveUp);
      retryTimers.forEach((timer) => clearTimeout(timer));
      retryTimers.clear();
      client.disconnect();
      clientRef.current = null;
    };
  }, [handleEvent]);

  useEffect(() => {
    voiceRef.current = new CompanionVoiceController({
      stopTts: () => {
        // synthesizeAndPlay pauses via AbortSignal; no shared audio element.
      },
      cancelTurn: () => handleInterruptRef.current(),
      startTurn: (text) => startTurnWithTextRef.current(text),
      transcribe: companionTranscribe,
      synthesizeAndPlay: companionSynthesizeAndPlay,
      now: () => Date.now(),
    });
    return () => {
      voiceRef.current?.flushAudio();
      voiceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages, pendingAskUser, progress]);

  const roomLocked = crisisHit;
  const awaitingAskUser =
    Boolean(pendingAskUser) &&
    Boolean(activeTurnId) &&
    hasPendingAskUser(turnEventsRef.current, activeTurnId);
  const sendBlocked = busy || roomLocked || awaitingAskUser;

  function sendWithRetry(
    payload:
      | StartTurnMessage
      | {
          type: "submit_user_reply";
          turn_id: string;
          answers?: Array<{ questionId: string; text: string }>;
          text?: string;
        }
      | { type: "cancel_turn"; turn_id: string },
    attempt = 0,
  ) {
    const client = clientRef.current;
    if (!client) return;
    if (client.connected) {
      client.send(payload);
      setConnected(true);
      setEverConnected(true);
      return;
    }
    if (attempt >= 10) {
      setBusy(false);
      busyRef.current = false;
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: "system",
          text: "Connection failed. Please try again.",
        },
      ]);
      return;
    }
    const timer = setTimeout(() => {
      retryTimersRef.current.delete(timer);
      sendWithRetry(payload, attempt + 1);
    }, 200);
    retryTimersRef.current.add(timer);
  }

  async function syncProgressUi(next: boolean, sessionId: string | null) {
    if (!sessionId) return;
    try {
      await apiFetch(
        apiUrl(`/api/v1/companion/sessions/${encodeURIComponent(sessionId)}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ progress_ui: next }),
        },
      );
    } catch {
      // Next start_turn config still carries progress_ui.
    }
  }

  function handleProgressToggle() {
    const next = !progressUiOn;
    setProgressUiOn(next);
    void syncProgressUi(next, sessionRef.current);
  }

  function handleInterrupt() {
    voiceRef.current?.flushAudio();
    const turnId = turnIdRef.current;
    if (!turnId || !busyRef.current) return;
    sendWithRetry({ type: "cancel_turn", turn_id: turnId });
    assistantBufferRef.current = null;
    busyRef.current = false;
    setBusy(false);
    setActiveTurnId(null);
    turnIdRef.current = null;
    setPendingAskUser(null);
  }

  function startTurnWithText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || roomLocked || crisisHitRef.current) return;
    // busyRef is cleared synchronously in handleInterrupt so barge-in can
    // start a new turn in the same stack after cancelTurn.
    if (busyRef.current) return;

    turnEventsRef.current = [];
    assistantBufferRef.current = null;
    lastAssistantTextRef.current = "";
    setPendingAskUser(null);

    setMessages((prev) => [
      ...prev,
      { id: newMessageId(), role: "user", text: trimmed },
    ]);
    setDraft("");
    busyRef.current = true;
    setBusy(true);
    const busyWatchdog = setTimeout(() => {
      retryTimersRef.current.delete(busyWatchdog);
      busyRef.current = false;
      setBusy(false);
    }, 180_000);
    retryTimersRef.current.add(busyWatchdog);

    sendWithRetry({
      type: "start_turn",
      content: trimmed,
      capability: "companion",
      session_id: sessionRef.current ?? undefined,
      language: "zh",
      config: { progress_ui: progressUiRef.current },
    });
  }

  startTurnWithTextRef.current = startTurnWithText;
  handleInterruptRef.current = handleInterrupt;

  function onSend() {
    const text = draft.trim();
    if (!text || sendBlocked) return;
    startTurnWithText(text);
  }

  async function onHoldStart() {
    if (sendBlocked || recording || holdActiveRef.current) return;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      return;
    }
    holdActiveRef.current = true;
    // Spec: speech start → barge-in stop current turn/TTS (before mic grant)
    voiceRef.current?.flushAudio();
    handleInterrupt();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      holdActiveRef.current = false;
      return;
    }
    if (!holdActiveRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const rec = new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    mediaRecorderRef.current = rec;
    rec.start();
    setRecording(true);
  }

  async function onHoldEnd() {
    holdActiveRef.current = false;
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    setRecording(false);
    mediaRecorderRef.current = null;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      if (rec.state !== "inactive") {
        rec.stop();
      } else {
        resolve();
      }
      rec.stream.getTracks().forEach((t) => t.stop());
    });
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];
    await voiceRef.current?.commitRecording(blob);
  }

  function submitAskUser(answers: Array<{ questionId: string; text: string }>) {
    const turnId = turnIdRef.current;
    if (!turnId || busy || roomLocked) return;
    busyRef.current = true;
    setBusy(true);
    setPendingAskUser(null);
    const busyWatchdog = setTimeout(() => {
      retryTimersRef.current.delete(busyWatchdog);
      busyRef.current = false;
      setBusy(false);
    }, 180_000);
    retryTimersRef.current.add(busyWatchdog);
    sendWithRetry({
      type: "submit_user_reply",
      turn_id: turnId,
      answers,
    });
  }

  function handleNewSession() {
    voiceRef.current?.flushAudio();
    retryTimersRef.current.forEach((timer) => clearTimeout(timer));
    retryTimersRef.current.clear();
    sessionRef.current = null;
    turnIdRef.current = null;
    turnEventsRef.current = [];
    assistantBufferRef.current = null;
    lastAssistantTextRef.current = "";
    busyRef.current = false;
    crisisHitRef.current = false;
    setMessages([]);
    setDraft("");
    setBusy(false);
    setDtSessionId(null);
    setActiveTurnId(null);
    setCrisisHit(false);
    setProgress(null);
    setPendingAskUser(null);
    holdActiveRef.current = false;
    setRecording(false);
  }

  const canNewSession = Boolean(dtSessionId || messages.length > 0 || crisisHit);
  const voiceDisabled = (sendBlocked || roomLocked) && !recording;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
            <Heart className="h-4 w-4 text-[var(--primary)]" aria-hidden />
            Companion
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
            Long-term陪聊 — interrupt anytime
            {dtSessionId ? (
              <span className="ml-2 font-mono opacity-70">
                session {dtSessionId.slice(0, 8)}…
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={progressUiOn}
              onChange={handleProgressToggle}
              className="rounded border-[var(--border)]"
            />
            显示辅导进度
          </label>
          <button
            type="button"
            onClick={handleNewSession}
            disabled={!canNewSession}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--ring)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            New session
          </button>
          {!connected && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              {everConnected ? "Reconnecting…" : "Connecting…"}
            </span>
          )}
        </div>
      </header>

      {crisisHit && (
        <div
          role="status"
          className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          Crisis redirect detected. This companion session is locked — start a
          new session if needed.
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex h-full w-full max-w-3xl gap-3 px-4 py-4">
          <div ref={scrollerRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="space-y-4">
              <CompanionMessageList messages={messages} />
              {awaitingAskUser && pendingAskUser ? (
                <CounselAskUserCard
                  payload={pendingAskUser}
                  busy={busy}
                  onSubmit={submitAskUser}
                />
              ) : null}
            </div>
          </div>
          {progressUiOn ? (
            <div className="hidden w-44 shrink-0 sm:block">
              <CompanionProgressPanel progress={progress} />
            </div>
          ) : null}
        </div>
      </div>

      {progressUiOn ? (
        <div className="border-t border-[var(--border)] px-4 py-2 sm:hidden">
          <CompanionProgressPanel progress={progress} />
        </div>
      ) : null}

      <CompanionComposer
        draft={draft}
        busy={busy}
        sendDisabled={sendBlocked}
        inputDisabled={roomLocked}
        interruptEnabled={busy && Boolean(activeTurnId) && !roomLocked}
        voiceSlot={
          <CompanionVoiceBar
            recording={recording}
            disabled={voiceDisabled}
            onHoldStart={() => {
              void onHoldStart();
            }}
            onHoldEnd={() => {
              void onHoldEnd();
            }}
          />
        }
        onDraftChange={setDraft}
        onSend={onSend}
        onInterrupt={handleInterrupt}
      />
    </div>
  );
}
