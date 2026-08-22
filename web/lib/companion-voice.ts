export type CompanionVoiceDeps = {
  stopTts: () => void;
  cancelTurn: () => void;
  startTurn: (text: string) => void;
  transcribe: (blob: Blob) => Promise<string>;
  synthesizeAndPlay: (text: string, signal: AbortSignal) => Promise<void>;
  now: () => number;
};

export class CompanionVoiceController {
  private speaking = false;
  private ttsAbort: AbortController | null = null;

  constructor(private readonly deps: CompanionVoiceDeps) {}

  markSpeaking(): void {
    this.speaking = true;
  }

  markIdle(): void {
    this.speaking = false;
  }

  /** Stop playback immediately (idempotent). */
  flushAudio(): void {
    this.ttsAbort?.abort();
    this.ttsAbort = null;
    this.deps.stopTts();
    this.speaking = false;
  }

  async bargeInWithText(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.flushAudio();
    this.deps.cancelTurn();
    this.deps.startTurn(trimmed);
  }

  async commitRecording(blob: Blob): Promise<void> {
    const text = (await this.deps.transcribe(blob)).trim();
    if (!text) {
      throw new Error("没有识别到有效语音，请再说一次或改用文字。");
    }
    await this.bargeInWithText(text);
  }

  async speakAssistant(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.ttsAbort?.abort();
    this.ttsAbort = new AbortController();
    this.speaking = true;
    try {
      await this.deps.synthesizeAndPlay(trimmed, this.ttsAbort.signal);
    } catch {
      // Voice is optional; missing TTS config must not surface as a hard failure.
    } finally {
      this.speaking = false;
    }
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }
}
