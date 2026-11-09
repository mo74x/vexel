import { UsageMeterService } from '../../meter/usage-meter.service';
import { BilingualTranscriberService } from '../transcriber.service';

describe('UsageMeterService & BilingualTranscriberService', () => {
  let ledgerEntries: any[];
  let mockPrisma: any;
  let meter: UsageMeterService;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-openai-key';
    ledgerEntries = [];
    mockPrisma = {
      usageLedger: {
        create: async ({ data }: any) => {
          ledgerEntries.push(data);
          return data;
        },
      },
    };
    meter = new UsageMeterService(mockPrisma);
  });

  it('calculates LLM token and Whisper audio costs accurately in UsageLedger', async () => {
    await meter.recordLlmUsage({
      tenantId: 'tenant_1',
      runId: 'run_1',
      provider: 'anthropic:claude-sonnet-4-20250514',
      promptTokens: 1000,
      completionTokens: 500,
    });

    await meter.recordAudioUsage({
      tenantId: 'tenant_1',
      runId: 'run_1',
      provider: 'openai:whisper-1',
      audioSeconds: 45.2,
    });

    expect(ledgerEntries.length).toBe(2);
    expect(ledgerEntries[0].promptTokens).toBe(1000);
    expect(ledgerEntries[1].audioSeconds).toBe(46);
  });

  it('chronologically merges text and transcribed voice notes across the debounce window', async () => {
    const transcriber = new BilingualTranscriberService(meter);
    (transcriber as any).transcribeWhatsAppAudio = async () => ({
      text: 'اتفقنا على السعر ٤٥ ألف دولار',
      durationSeconds: 12.4,
    });

    const bundle = await transcriber.transcribeAndMergeBatch(
      'tenant_1',
      'run_1',
      'wa_token_123',
      [
        {
          messageId: 'm2',
          senderPhone: '+201001112222',
          type: 'audio',
          mediaUrl: 'media_99',
          timestamp: 1762540020000,
        },
        {
          messageId: 'm1',
          senderPhone: '+201001112222',
          type: 'text',
          text: 'Just finished call with Acme.',
          timestamp: 1762540005000,
        },
      ],
    );

    expect(bundle.messageCount).toBe(2);
    expect(bundle.totalAudioSeconds).toBe(12.4);
    expect(bundle.mergedTranscript).toContain('TEXT]: Just finished call with Acme.');
    expect(bundle.mergedTranscript).toContain('VOICE NOTE (13s)]: اتفقنا على السعر ٤٥ ألف دولار');
    expect(ledgerEntries.length).toBe(1);
  });
});

