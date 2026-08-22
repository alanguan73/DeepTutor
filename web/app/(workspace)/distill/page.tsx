"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FlaskConical, Loader2 } from "lucide-react";
import DistillComposer from "@/components/distill/DistillComposer";
import DistillMessageList, {
  type DistillMessage,
} from "@/components/distill/DistillMessageList";
import {
  listKnowledgeBases,
  type KnowledgeBaseSummary,
} from "@/lib/knowledge-api";
import {
  UnifiedWSClient,
  type StartTurnMessage,
  type StreamEvent,
} from "@/lib/unified-ws";

type DistillMode = "simple" | "cangjie";

const CANGJIE_DEFAULT_BRIEF_ZH =
  "请按 cangjie-skill 蒸馏专家技能包（可用粘贴正文和/或知识库）";
const CANGJIE_DEFAULT_BRIEF_EN =
  "Please distill an expert skill pack with cangjie-skill (paste and/or knowledge base)";

const CANGJIE_PASTE_MIN = 80;

function newMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultCangjieBrief(): string {
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh")) {
    return CANGJIE_DEFAULT_BRIEF_ZH;
  }
  return CANGJIE_DEFAULT_BRIEF_EN;
}

export default function DistillPage() {
  const [messages, setMessages] = useState<DistillMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [dtSessionId, setDtSessionId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [mode, setMode] = useState<DistillMode>("simple");
  const [kbName, setKbName] = useState("");
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>(
    [],
  );
  const [kbsLoaded, setKbsLoaded] = useState(false);

  const clientRef = useRef<UnifiedWSClient | null>(null);
  const sessionRef = useRef<string | null>(null);
  const retryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    sessionRef.current = dtSessionId;
  }, [dtSessionId]);

  useEffect(() => {
    let cancelled = false;
    void listKnowledgeBases()
      .then((list) => {
        if (!cancelled) setKnowledgeBases(list);
      })
      .catch(() => {
        if (!cancelled) setKnowledgeBases([]);
      })
      .finally(() => {
        if (!cancelled) setKbsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEvent = useCallback((event: StreamEvent) => {
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
      return;
    }

    if (event.type === "done") {
      setBusy(false);
      setConnected(true);
      return;
    }

    if (event.type === "error") {
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: "system",
          text: event.content || "Something went wrong.",
          stage: event.stage,
          source: event.source,
        },
      ]);
      setBusy(false);
      return;
    }

    if (event.type !== "content" || !event.content) return;

    setMessages((prev) => [
      ...prev,
      {
        id: newMessageId(),
        role: "assistant",
        text: event.content,
        stage: event.stage || undefined,
        source: event.source || undefined,
      },
    ]);
  }, []);

  useEffect(() => {
    const client = new UnifiedWSClient(handleEvent, () => {
      setBusy(false);
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
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages]);

  function sendWithRetry(payload: StartTurnMessage, attempt = 0) {
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

  function startTurn() {
    if (busy) return;

    const trimmed = draft.trim();
    const hasPaste = trimmed.length >= CANGJIE_PASTE_MIN;
    const hasKb = Boolean(kbName);

    if (mode === "cangjie" && !hasKb && !hasPaste) {
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: "system",
          text:
            "Cangjie distill needs a knowledge base and/or pasted source text (about 80+ characters). You can also upload a .txt / .md file.",
        },
      ]);
      return;
    }

    if (mode === "simple" && !trimmed) return;

    const text =
      mode === "cangjie" && !trimmed
        ? defaultCangjieBrief()
        : trimmed || defaultCangjieBrief();

    setMessages((prev) => [
      ...prev,
      { id: newMessageId(), role: "user", text },
    ]);
    setDraft("");
    setBusy(true);
    const busyWatchdog = setTimeout(() => {
      retryTimersRef.current.delete(busyWatchdog);
      setBusy(false);
    }, 120_000);
    retryTimersRef.current.add(busyWatchdog);

    const cangjieConfig: Record<string, string> = {
      distill_mode: "cangjie",
    };
    if (hasKb) cangjieConfig.kb_name = kbName;

    const payload: StartTurnMessage = {
      type: "start_turn",
      content: text,
      capability: "distill",
      session_id: sessionRef.current ?? undefined,
      config: mode === "cangjie" ? cangjieConfig : {},
    };
    sendWithRetry(payload);
  }

  function handleUploadFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setDraft((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
    };
    reader.onerror = () => {
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: "system",
          text: `Failed to read file: ${file.name}`,
        },
      ]);
    };
    reader.readAsText(file);
  }

  function handleNewDistill() {
    retryTimersRef.current.forEach((timer) => clearTimeout(timer));
    retryTimersRef.current.clear();
    sessionRef.current = null;
    setMessages([]);
    setDraft("");
    setBusy(false);
    setDtSessionId(null);
    setKbName("");
  }

  const sendDisabled =
    busy ||
    (mode === "simple" && !draft.trim()) ||
    (mode === "cangjie" && !kbName && draft.trim().length < CANGJIE_PASTE_MIN);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
            <FlaskConical className="h-4 w-4 text-[var(--primary)]" aria-hidden />
            Distill
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
            Turn methodology excerpts into DeepTutor skills
            {dtSessionId ? (
              <span className="ml-2 font-mono opacity-70">
                session {dtSessionId.slice(0, 8)}…
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Distill mode"
            className="flex items-center gap-0.5 rounded-lg bg-[var(--muted)]/70 p-0.5"
          >
            {(
              [
                { key: "simple", label: "Simple" },
                { key: "cangjie", label: "Cangjie" },
              ] as const
            ).map((tab) => {
              const active = mode === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={busy}
                  onClick={() => setMode(tab.key)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-[background-color,color] duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
                    active
                      ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleNewDistill}
            disabled={!dtSessionId && messages.length === 0}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--ring)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            New distill
          </button>
          {!connected && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              {everConnected ? "Reconnecting…" : "Connecting…"}
            </span>
          )}
        </div>
      </header>

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto w-full max-w-3xl">
          <DistillMessageList messages={messages} />
        </div>
      </div>

      {mode === "cangjie" && (
        <div className="border-t border-[var(--border)] bg-[var(--card)]/20 px-4 py-2.5">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--muted-foreground)]">
                Knowledge base (optional if you paste / upload text)
              </label>
              <select
                value={kbName}
                onChange={(e) => setKbName(e.target.value)}
                disabled={busy}
                aria-label="Knowledge base"
                className="h-9 w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 text-[12.5px] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">No knowledge base — paste only</option>
                {knowledgeBases.map((kb) => (
                  <option key={kb.name} value={kb.name}>
                    {kb.name}
                  </option>
                ))}
              </select>
              {kbsLoaded && knowledgeBases.length === 0 ? (
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  No knowledge bases yet. Create one on the{" "}
                  <Link
                    href="/knowledge"
                    className="underline hover:text-[var(--foreground)]"
                  >
                    Knowledge
                  </Link>{" "}
                  page, or paste / upload text below.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--foreground)] hover:bg-[var(--muted)]/40">
                Upload .txt / .md
                <input
                  type="file"
                  accept=".txt,.md,.markdown,text/plain,text/markdown"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    void handleUploadFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
              </label>
              <span className="text-[11px] text-[var(--muted-foreground)]">
                Paste long source in the composer (≥{CANGJIE_PASTE_MIN} chars) and/or pick a KB.
              </span>
            </div>
          </div>
        </div>
      )}

      <DistillComposer
        draft={draft}
        busy={busy}
        sendDisabled={sendDisabled}
        placeholder={
          mode === "cangjie"
            ? "Paste source text to distill (or a short brief if using a KB)…"
            : "Paste a counseling methodology excerpt…"
        }
        onDraftChange={setDraft}
        onSend={startTurn}
      />
    </div>
  );
}
