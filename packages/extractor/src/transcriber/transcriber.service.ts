import OpenAI, { toFile } from 'openai';
import { UsageMeterService } from '../meter/usage-meter.service';

export interface BufferedMessage {
  messageId: string;
  senderPhone: string;
  type: 'text' | 'audio';
  text?: string;
  mediaUrl?: string;
  timestamp: number;
}

export interface MergedTranscriptBundle {
  senderPhone: string;
  messageCount: number;
  totalAudioSeconds: number;
  mergedTranscript: string;
}

export const DEFAULT_OPENAI_AUDIO_MODEL = 'whisper-1';

export class BilingualTranscriberService {
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(private readonly usageMeter: UsageMeterService, model?: string) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = model || process.env.OPENAI_AUDIO_MODEL || DEFAULT_OPENAI_AUDIO_MODEL;
  }

  async transcribeAndMergeBatch(
    tenantId: string,
    runId: string,
    whatsappAccessToken: string,
    messages: BufferedMessage[],
  ): Promise<MergedTranscriptBundle> {
    // Sort chronologically across the 30-second sliding debounce window
    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
    const transcriptLines: string[] = [];
    let totalAudioSeconds = 0;

    for (const msg of sorted) {
      const timeLabel = new Date(msg.timestamp).toISOString().slice(11, 19);

      if (msg.type === 'text' && msg.text) {
        transcriptLines.push(`[${timeLabel} TEXT]: ${msg.text}`);
        continue;
      }

      if (msg.type === 'audio' && msg.mediaUrl) {
        const { text, durationSeconds } = await this.transcribeWhatsAppAudio(
          msg.mediaUrl,
          whatsappAccessToken,
        );
        totalAudioSeconds += durationSeconds;
        transcriptLines.push(`[${timeLabel} VOICE NOTE (${Math.ceil(durationSeconds)}s)]: ${text}`);
      }
    }

    if (totalAudioSeconds > 0) {
      await this.usageMeter.recordAudioUsage({
        tenantId,
        runId,
        provider: `openai:${this.model}`,
        audioSeconds: totalAudioSeconds,
      });
    }

    return {
      senderPhone: sorted[0]?.senderPhone ?? 'unknown',
      messageCount: sorted.length,
      totalAudioSeconds,
      mergedTranscript: transcriptLines.join('\n'),
    };
  }

  private async transcribeWhatsAppAudio(
    mediaIdOrUrl: string,
    whatsappToken: string,
  ): Promise<{ text: string; durationSeconds: number }> {
    const response = await fetch(mediaIdOrUrl, {
      headers: { Authorization: `Bearer ${whatsappToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch WhatsApp audio media: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioFile = await toFile(Buffer.from(arrayBuffer), 'voice-note.ogg', {
      type: 'audio/ogg',
    });

    // verbose_json returns exact audio duration for our UsageLedger
    const transcription = await this.openai.audio.transcriptions.create({
      file: audioFile,
      model: this.model,
      response_format: 'verbose_json',
      prompt:
        'B2B sales conversation mixing English and Arabic (Egyptian/Gulf dialects). Preserve English business terms: HubSpot, PO, SLA, contract, retainer, invoice, Q1, Q2, Q3, Q4, USD, EGP, SAR, AED.',
    });

    return {
      text: transcription.text,
      durationSeconds: (transcription as any).duration ?? 15,
    };
  }
}