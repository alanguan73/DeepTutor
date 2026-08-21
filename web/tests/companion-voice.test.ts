import test from "node:test";
import assert from "node:assert/strict";

import {
  CompanionVoiceController,
  type CompanionVoiceDeps,
} from "../lib/companion-voice";

type CallLog = {
  stopTts: number;
  cancelTurn: number;
  startTurn: string[];
  transcribe: Blob[];
  synthesizeAndPlay: Array<{ text: string; aborted: boolean }>;
};

function createDeps(overrides: Partial<CompanionVoiceDeps> = {}): {
  deps: CompanionVoiceDeps;
  log: CallLog;
} {
  const log: CallLog = {
    stopTts: 0,
    cancelTurn: 0,
    startTurn: [],
    transcribe: [],
    synthesizeAndPlay: [],
  };

  const deps: CompanionVoiceDeps = {
    stopTts: () => {
      log.stopTts += 1;
    },
    cancelTurn: () => {
      log.cancelTurn += 1;
    },
    startTurn: (text: string) => {
      log.startTurn.push(text);
    },
    transcribe: async (blob: Blob) => {
      log.transcribe.push(blob);
      return "transcribed text";
    },
    synthesizeAndPlay: async (text: string, signal: AbortSignal) => {
      log.synthesizeAndPlay.push({ text, aborted: signal.aborted });
    },
    now: () => 0,
    ...overrides,
  };

  return { deps, log };
}

test("bargeInWithText stops TTS, cancels turn, then starts turn with trimmed text", async () => {
  const order: string[] = [];
  const { deps } = createDeps({
    stopTts: () => {
      order.push("stopTts");
    },
    cancelTurn: () => {
      order.push("cancelTurn");
    },
    startTurn: (text: string) => {
      order.push(`startTurn:${text}`);
    },
  });
  const controller = new CompanionVoiceController(deps);
  controller.markSpeaking();

  await controller.bargeInWithText("  hello world  ");

  assert.deepEqual(order, [
    "stopTts",
    "cancelTurn",
    "startTurn:hello world",
  ]);
  assert.equal(controller.isSpeaking, false);
});

test("bargeInWithText ignores empty or whitespace-only text", async () => {
  const { deps, log } = createDeps();
  const controller = new CompanionVoiceController(deps);

  await controller.bargeInWithText("");
  await controller.bargeInWithText("   \t\n  ");

  assert.equal(log.stopTts, 0);
  assert.equal(log.cancelTurn, 0);
  assert.deepEqual(log.startTurn, []);
});

test("commitRecording transcribes then barge-ins with transcribed text", async () => {
  const order: string[] = [];
  const blob = new Blob(["audio"], { type: "audio/webm" });
  const { deps } = createDeps({
    transcribe: async (received: Blob) => {
      order.push("transcribe");
      assert.equal(received, blob);
      return "  spoken reply  ";
    },
    stopTts: () => {
      order.push("stopTts");
    },
    cancelTurn: () => {
      order.push("cancelTurn");
    },
    startTurn: (text: string) => {
      order.push(`startTurn:${text}`);
    },
  });
  const controller = new CompanionVoiceController(deps);

  await controller.commitRecording(blob);

  assert.deepEqual(order, [
    "transcribe",
    "stopTts",
    "cancelTurn",
    "startTurn:spoken reply",
  ]);
});

test("commitRecording does nothing when transcription is empty", async () => {
  let transcribed = 0;
  const { deps, log } = createDeps({
    transcribe: async () => {
      transcribed += 1;
      return "   ";
    },
  });
  const controller = new CompanionVoiceController(deps);

  await controller.commitRecording(new Blob(["audio"]));

  assert.equal(transcribed, 1);
  assert.equal(log.cancelTurn, 0);
  assert.deepEqual(log.startTurn, []);
});

test("flushAudio is idempotent and clears speaking state", () => {
  const { deps, log } = createDeps();
  const controller = new CompanionVoiceController(deps);
  controller.markSpeaking();

  controller.flushAudio();
  controller.flushAudio();

  assert.equal(log.stopTts, 2);
  assert.equal(controller.isSpeaking, false);
});

test("speakAssistant synthesizes trimmed text and clears speaking when done", async () => {
  const { deps, log } = createDeps();
  const controller = new CompanionVoiceController(deps);

  const pending = controller.speakAssistant("  hi there  ");
  assert.equal(controller.isSpeaking, true);
  await pending;

  assert.equal(controller.isSpeaking, false);
  assert.equal(log.synthesizeAndPlay.length, 1);
  assert.equal(log.synthesizeAndPlay[0]?.text, "hi there");
  assert.equal(log.synthesizeAndPlay[0]?.aborted, false);
});

test("speakAssistant ignores empty text", async () => {
  const { deps, log } = createDeps();
  const controller = new CompanionVoiceController(deps);

  await controller.speakAssistant("  \n  ");

  assert.equal(log.synthesizeAndPlay.length, 0);
  assert.equal(controller.isSpeaking, false);
});
