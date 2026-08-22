"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, Loader2 } from "lucide-react";
import CompanionComposer from "@/components/companion/CompanionComposer";
import CompanionExpertPicker from "@/components/companion/CompanionExpertPicker";
import CompanionMessageList, {
  type CompanionMessage,
} from "@/components/companion/CompanionMessageList";
import CompanionProgressPanel, {
  type CompanionProgress,
} from "@/components/companion/CompanionProgressPanel";
import CompanionVoiceBar from "@/components/companion/CompanionVoiceBar";
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

function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `companion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const [recording, setRecording] = useState(false);
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [personaId, setPersonaId] = useState("");
  const [personaError, setPersonaError] = useState<string | null>(null);

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
  const startTurnWithTextRef = useRef<(text: string) => void | Promise<void>>(
    () => {},
  );
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
        setConnected(true);
        setEverConnected(true);
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

      if (event.type === "done" || event.type === "result") {
        if (event.type === "done") {
          const full = lastAssistantTextRef.current;
          if (full && !crisisHitRef.current) {
            void voiceRef.current?.speakAssistant(full).catch(() => {
              // TTS optional — missing voice model must not block the UI.
            });
          }
        }
        assistantBufferRef.current = null;
        setBusy(false);
        busyRef.current = false;
        setConnected(true);
        setEverConnected(true);
        if (event.type === "done") {
          setActiveTurnId(null);
          turnIdRef.current = null;
        }
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
        setActiveTurnId(null);
        turnIdRef.current = null;
        return;
      }

      if (event.stage === "companion_progress") {
        const parsed = parseProgressPayload(event);
        if (parsed) setProgress(parsed);
        return;
      }

      if (event.type === "progress") {
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
  }, [messages, progress]);

  const roomLocked = crisisHit;
  const sendBlocked = busy || roomLocked;

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

  function ensureSessionId(): string {
    if (sessionRef.current) return sessionRef.current;
    const id = newSessionId();
    sessionRef.current = id;
    setDtSessionId(id);
    return id;
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

  async function syncPersona(nextPersonaId: string, sessionId: string) {
    await apiFetch(
      apiUrl(`/api/v1/companion/sessions/${encodeURIComponent(sessionId)}`),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona_id: nextPersonaId }),
      },
    );
  }

  function handleProgressToggle() {
    const next = !progressUiOn;
    setProgressUiOn(next);
    void syncProgressUi(next, sessionRef.current);
  }

  function handlePersonaChange(next: string) {
    setPersonaId(next);
    setPersonaError(null);
    if (!next) return;
    const sessionId = ensureSessionId();
    void syncPersona(next, sessionId).catch(() => {
      setPersonaError("专家人格绑定失败，请重试");
    });
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
  }

  async function startTurnWithText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || roomLocked || crisisHitRef.current) return;
    // busyRef is cleared synchronously in handleInterrupt so barge-in can
    // start a new turn in the same stack after cancelTurn.
    if (busyRef.current) return;

    if (!personaId) {
      setPersonaError("请先选择专家人格");
      return;
    }

    const sessionId = ensureSessionId();
    try {
      await syncPersona(personaId, sessionId);
    } catch {
      setPersonaError("专家人格绑定失败，请重试");
      return;
    }

    turnEventsRef.current = [];
    assistantBufferRef.current = null;
    lastAssistantTextRef.current = "";
    setPersonaError(null);

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
      session_id: sessionId,
      language: "zh",
      config: { progress_ui: progressUiRef.current },
    });
  }

  startTurnWithTextRef.current = startTurnWithText;
  handleInterruptRef.current = handleInterrupt;

  function onSend() {
    const text = draft.trim();
    if (!text || sendBlocked) return;
    if (!personaId) {
      setPersonaError("请先选择专家人格");
      return;
    }
    void startTurnWithText(text);
  }

  async function onHoldStart() {
    // Allow barge-in while busy (generation/TTS); only lock on crisis.
    if (roomLocked || recording || holdActiveRef.current || voiceTranscribing) {
      return;
    }
    setVoiceError(null);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setVoiceError("当前浏览器不支持录音，请换 Chrome / Edge，或改用文字输入。");
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
      setVoiceError("无法使用麦克风：请在浏览器允许本站麦克风权限后重试。");
      return;
    }
    if (!holdActiveRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
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
    const mimeType = rec.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    if (!blob.size) {
      setVoiceError("没录到声音，请按住稍久一点再说。");
      return;
    }
    setVoiceTranscribing(true);
    try {
      await voiceRef.current?.commitRecording(blob);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "语音识别失败";
      if (/No active STT|STT model|stt/i.test(msg) || msg.includes("400")) {
        setVoiceError(
          "语音识别未配置：请到 Settings → Voice 添加并启用 STT 模型（按住说话才能用）。也可先用文字输入。",
        );
      } else if (/denied|permission|麦克风/i.test(msg)) {
        setVoiceError("麦克风权限被拒绝，请在浏览器设置中允许后重试。");
      } else {
        setVoiceError(msg || "语音识别失败，请改用文字输入。");
      }
    } finally {
      setVoiceTranscribing(false);
    }
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
    setPersonaError(null);
    holdActiveRef.current = false;
    setRecording(false);
  }

  const canNewSession = Boolean(dtSessionId || messages.length > 0 || crisisHit);
  const voiceDisabled = roomLocked && !recording;

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
          <CompanionExpertPicker
            personaId={personaId}
            onPersonaChange={handlePersonaChange}
          />
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

      {(personaError || voiceError) && (
        <div
          role="alert"
          className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-800 dark:text-red-200"
        >
          {personaError || voiceError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex h-full w-full max-w-3xl gap-3 px-4 py-4">
          <div ref={scrollerRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="space-y-4">
              <CompanionMessageList messages={messages} />
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
            transcribing={voiceTranscribing}
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
