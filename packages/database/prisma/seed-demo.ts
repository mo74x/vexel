import { PrismaClient, MembershipRole, RunStatus, RunOutcome } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

// Load environment variables from packages/database/.env or root .env
dotenv.config({ path: resolve(process.cwd(), 'packages/database/.env') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/vexel?schema=public';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export function getDemoSeedDataset() {
  const tenantId = 'tenant_demo_mena';

  const tenant = {
    id: tenantId,
    name: 'Acme MENA Corp',
    slug: 'acme-mena-corp',
    hubspotPortalId: '14429103',
    hubspotAccessToken: 'vexel:enc:v1:demo_sealed_token_hubspot',
    whatsappPhoneId: '108923485721903',
    whatsappAccessToken: 'vexel:enc:v1:demo_sealed_token_whatsapp',
    fallbackApprovalPhone: '+201011112222',
    autoSyncThreshold: 85,
    manualMinutesPerUpdate: 6,
    locale: 'ar',
    timezone: 'Africa/Cairo',
  };

  const users = [
    {
      id: 'usr_demo_admin',
      email: 'karim@vexel-demo.com',
      name: 'Karim El-Sayed',
      locale: 'ar',
      role: MembershipRole.ADMIN,
    },
    {
      id: 'usr_demo_manager',
      email: 'sarah@vexel-demo.com',
      name: 'Sarah Mansour',
      locale: 'en',
      role: MembershipRole.MANAGER,
    },
    {
      id: 'usr_demo_support',
      email: 'support@vexel-demo.com',
      name: 'Nour Support',
      locale: 'ar',
      role: MembershipRole.SUPPORT,
    },
  ];

  const reps = [
    {
      id: 'rep_tamer',
      hubspotOwnerId: 'owner_101',
      fullName: 'Tamer Zaki',
      email: 'tamer@vexel-demo.com',
      whatsappPhone: '+201012345678',
    },
    {
      id: 'rep_layla',
      hubspotOwnerId: 'owner_102',
      fullName: 'Layla Al-Khatib',
      email: 'layla@vexel-demo.com',
      whatsappPhone: '+971501112233',
    },
    {
      id: 'rep_ahmed',
      hubspotOwnerId: 'owner_103',
      fullName: 'Ahmed Shawky',
      email: 'ahmed@vexel-demo.com',
      whatsappPhone: '+966501234567',
    },
    {
      id: 'rep_alex',
      hubspotOwnerId: 'owner_104',
      fullName: 'Alex Rivera',
      email: 'alex@vexel-demo.com',
      whatsappPhone: '+14155552671',
    },
  ];

  const runsToCreate = [
    // Run 1: Egyptian Arabic - Auto Synced Deal Contract
    {
      id: 'run_demo_01',
      daysAgo: 1,
      workflowName: 'omnichannel-to-hubspot-v1',
      externalDealId: 'deal_8801',
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.AUTO_SYNCED,
      confidenceScore: 94,
      decidedByRepId: 'rep_tamer',
      senderPhone: '+201012345678',
      transcript:
        'مساء الخير يا فندم، اجتمعت مع شركة البدر للخدمات اللوجستية النهاردة، الصفقة هتقفل على 85 ألف دولار، وهيبعتوا العقد موقع بكرة إن شاء الله، ياريت ننقل المرحلة لـ contractsent.',
      extractedData: {
        dealName: 'Al-Badr Logistics Cloud Expansion',
        dealStage: 'contractsent',
        amount: 85000,
        closeDate: '2026-11-25',
        summaryNote: 'اجتماع إيجابي وموافقة على العقد النهائي بقيمة $85,000.',
      },
      cost: 0.0185,
    },
    // Run 2: Gulf Arabic - Approved with Rep Override
    {
      id: 'run_demo_02',
      daysAgo: 2,
      workflowName: 'omnichannel-to-hubspot-v1',
      externalDealId: 'deal_8802',
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.APPROVED_WITH_OVERRIDE,
      confidenceScore: 82,
      decidedByRepId: 'rep_layla',
      senderPhone: '+971501112233',
      transcript:
        'السلام عليكم، كلمت اليوم أبو فهد بخصوص مناقصة التقنية السحابية في شركة الأفق، اتفقنا على 120 ألف درهم وننقل المرحلة للمفاوضات النهائية.',
      extractedData: {
        dealName: 'Al-Ofuq Digital Transformation',
        dealStage: 'decisionmakerboughtin',
        amount: 32000,
        summaryNote: 'مناقصة التقنية السحابية بموافقة الشركاء.',
      },
      overriddenFields: {
        amount: { from: 32000, to: 35000 },
      },
      cost: 0.0165,
    },
    // Run 3: English - Approved as is
    {
      id: 'run_demo_03',
      daysAgo: 3,
      workflowName: 'omnichannel-to-hubspot-v1',
      externalDealId: 'deal_8803',
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.APPROVED_AS_IS,
      confidenceScore: 88,
      decidedByRepId: 'rep_alex',
      senderPhone: '+14155552671',
      transcript:
        'Hey team, wrapped up a strong demo with Apex Healthcare. They agreed to move forward with the Enterprise plan, value is $48,000, moving stage to presentationscheduled.',
      extractedData: {
        dealName: 'Apex Healthcare Enterprise Plan',
        dealStage: 'presentationscheduled',
        amount: 48000,
        summaryNote: 'Demo completed; prospect agreed to evaluate enterprise pilot.',
      },
      cost: 0.0142,
    },
    // Run 4: Egyptian Arabic - Auto Synced Stage Change
    {
      id: 'run_demo_04',
      daysAgo: 4,
      workflowName: 'omnichannel-to-hubspot-v1',
      externalDealId: 'deal_8804',
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.AUTO_SYNCED,
      confidenceScore: 91,
      decidedByRepId: 'rep_tamer',
      senderPhone: '+201012345678',
      transcript:
        'سجل عندك صفقة نايل تك تم تحويلها لمرحلة closedwon بعد استلام الإيداع البنكي بقيمة 30 ألف دولار.',
      extractedData: {
        dealName: 'Nile Tech CRM Implementation',
        dealStage: 'closedwon',
        amount: 30000,
        summaryNote: 'تم استلام الإيداع وتأكيد إغلاق الصفقة بنجاح.',
      },
      cost: 0.0135,
    },
    // Run 5: Gulf Arabic - Waiting Rep Approval
    {
      id: 'run_demo_05',
      daysAgo: 0,
      workflowName: 'omnichannel-to-hubspot-v1',
      externalDealId: 'deal_8805',
      status: RunStatus.WAITING_APPROVAL,
      outcome: null,
      confidenceScore: 71,
      decidedByRepId: 'rep_ahmed',
      senderPhone: '+966501234567',
      transcript:
        'مرحباً، قابلت مدير المشتريات في مجموعة الراجحي التجارية، مبدئياً مهتمين جداً بالحلول بس لسه بنفاضل بين خطتين وننتظر رد مجلس الإدارة الأسبوع القادم.',
      extractedData: {
        dealName: 'Al-Rajhi Group ERP Integration',
        dealStage: 'qualifiedtobuy',
        amount: 60000,
        summaryNote: 'اجتماع تمهيدي مع الإدارة وطلب مقارنة بين الخطتين.',
      },
      cost: 0.012,
    },
    // Run 6: Bilingual - Reverted / Undone
    {
      id: 'run_demo_06',
      daysAgo: 7,
      workflowName: 'omnichannel-to-hubspot-v1',
      externalDealId: 'deal_8806',
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.UNDONE,
      confidenceScore: 89,
      decidedByRepId: 'rep_tamer',
      senderPhone: '+201012345678',
      transcript:
        'Update deal Cairo Horizon to closedwon 45k. Wait actually hold on, cancel that update, need confirmation first.',
      extractedData: {
        dealName: 'Cairo Horizon Advisory',
        dealStage: 'closedwon',
        amount: 45000,
      },
      cost: 0.015,
    },
    // Run 7: English - Failed / Rate limit
    {
      id: 'run_demo_07',
      daysAgo: 10,
      workflowName: 'omnichannel-to-hubspot-v1',
      externalDealId: null,
      status: RunStatus.FAILED,
      outcome: RunOutcome.FAILED,
      confidenceScore: 45,
      decidedByRepId: 'rep_alex',
      senderPhone: '+14155552671',
      transcript:
        'Update Delta Corp deal status to decision maker bought in. Looking forward to review.',
      extractedData: null,
      errorMessage: 'HubSpot API rate limit backoff exceeded after 3 attempts',
      cost: 0.008,
    },
    // Run 8: Gulf Arabic - Auto Synced
    {
      id: 'run_demo_08',
      daysAgo: 12,
      workflowName: 'omnichannel-to-hubspot-v1',
      externalDealId: 'deal_8808',
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.AUTO_SYNCED,
      confidenceScore: 93,
      decidedByRepId: 'rep_layla',
      senderPhone: '+971501112233',
      transcript:
        'تم توقيع مذكرة التفاهم مع شركة إعمار دبي بقيمة 95 ألف دولار، يرجى نقل المرحلة إلى closedwon.',
      extractedData: {
        dealName: 'Emaar Dubai Commercial Center',
        dealStage: 'closedwon',
        amount: 95000,
        summaryNote: 'توقيع المذكرة واستلام الدفعة الأولى.',
      },
      cost: 0.0175,
    },
    // Run 9: English - Auto Synced
    {
      id: 'run_demo_09',
      daysAgo: 15,
      workflowName: 'omnichannel-to-hubspot-v1',
      externalDealId: 'deal_8809',
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.AUTO_SYNCED,
      confidenceScore: 96,
      decidedByRepId: 'rep_alex',
      senderPhone: '+14155552671',
      transcript:
        'Great news, Summit Financial signed the SaaS contract today for $72k annually. Moving deal to closedwon.',
      extractedData: {
        dealName: 'Summit Financial Enterprise SaaS',
        dealStage: 'closedwon',
        amount: 72000,
        summaryNote: 'Annual subscription contract executed for $72,000.',
      },
      cost: 0.019,
    },
    // Run 10: Egyptian Arabic - Approved with Override
    {
      id: 'run_demo_10',
      daysAgo: 18,
      workflowName: 'omnichannel-to-hubspot-v1',
      externalDealId: 'deal_8810',
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.APPROVED_WITH_OVERRIDE,
      confidenceScore: 84,
      decidedByRepId: 'rep_tamer',
      senderPhone: '+201012345678',
      transcript:
        'مساء الفل، قابلت أحمد في الدقي واتفقنا على ترقية باقة الفنادق لـ 20 ألف، انقل المرحلة لمرحلة العرض المقدم.',
      extractedData: {
        dealName: 'Dokki Hospitality Suite',
        dealStage: 'presentationscheduled',
        amount: 20000,
        summaryNote: 'ترقية الباقة لفرع الفندق الجديد.',
      },
      overriddenFields: {
        amount: { from: 18000, to: 20000 },
      },
      cost: 0.014,
    },
    // Run 11: English - Rejected by Rep
    {
      id: 'run_demo_11',
      daysAgo: 22,
      workflowName: 'omnichannel-to-hubspot-v1',
      externalDealId: 'deal_8811',
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.REJECTED,
      confidenceScore: 78,
      decidedByRepId: 'rep_alex',
      senderPhone: '+14155552671',
      transcript:
        'Prospect requested cancellation of Q4 discussions due to budget freeze.',
      extractedData: {
        dealName: 'Zenith Retail Hardware Pilot',
        dealStage: 'closedlost',
      },
      cost: 0.011,
    },
    // Run 12: Gulf Arabic - Auto Synced
    {
      id: 'run_demo_12',
      daysAgo: 25,
      workflowName: 'omnichannel-to-hubspot-v1',
      externalDealId: 'deal_8812',
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.AUTO_SYNCED,
      confidenceScore: 92,
      decidedByRepId: 'rep_ahmed',
      senderPhone: '+966501234567',
      transcript:
        'تم الاتفاق مع شركة سابك على بدء المرحلة التجريبية للنظام بقيمة 50 ألف دولار.',
      extractedData: {
        dealName: 'SABIC Operations Pilot',
        dealStage: 'qualifiedtobuy',
        amount: 50000,
      },
      cost: 0.016,
    },
  ];

  return { tenant, users, reps, runsToCreate };
}

export async function seedDemoTenant() {
  console.log('🌱 Starting Vexel MENA Demo Seeding...');

  const { tenant: tenantData, users, reps: repsData, runsToCreate } = getDemoSeedDataset();
  const tenantId = tenantData.id;

  // 1. Create or Update Demo Tenant
  const tenant = await prisma.tenant.upsert({
    where: { id: tenantId },
    update: tenantData,
    create: tenantData,
  });

  console.log(`✅ Tenant upserted: ${tenant.name} (${tenant.id})`);

  // 2. Demo Users & Memberships
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, locale: u.locale },
      create: { id: u.id, email: u.email, name: u.name, locale: u.locale },
    });

    await prisma.membership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId } },
      update: { role: u.role },
      create: { userId: user.id, tenantId, role: u.role },
    });
  }

  console.log('✅ Demo Users and Memberships provisioned');

  // 3. Sales Reps (Bilingual MENA Sales Team)
  const reps: any[] = [];
  for (const r of repsData) {
    const rep = await prisma.tenantRep.upsert({
      where: { id: r.id },
      update: {
        fullName: r.fullName,
        email: r.email,
        whatsappPhone: r.whatsappPhone,
        isActive: true,
      },
      create: {
        id: r.id,
        tenantId,
        hubspotOwnerId: r.hubspotOwnerId,
        fullName: r.fullName,
        email: r.email,
        whatsappPhone: r.whatsappPhone,
        isActive: true,
      },
    });
    reps.push(rep);
  }

  console.log(`✅ ${reps.length} Sales Representatives created`);

  // Clean old demo runs & usage for idempotency
  await prisma.workflowStep.deleteMany({
    where: { tenantId },
  });
  await prisma.workflowRun.deleteMany({ where: { tenantId } });
  await prisma.usageLedger.deleteMany({ where: { tenantId } });

  // 4. Realistic Arabic and English Workflow Runs
  const now = new Date();
  const dayMs = 24 * 3600 * 1000;

  for (const r of runsToCreate) {
    const createdAt = new Date(now.getTime() - r.daysAgo * dayMs);
    const completedAt = new Date(createdAt.getTime() + 4500); // 4.5s duration

    const run = await prisma.workflowRun.create({
      data: {
        id: r.id,
        tenantId,
        idempotencyKey: `demo_idem_${r.id}`,
        workflowName: r.workflowName,
        externalDealId: r.externalDealId,
        status: r.status,
        outcome: r.outcome,
        confidenceScore: r.confidenceScore,
        decidedByRepId: r.decidedByRepId,
        inputPayload: {
          senderPhone: r.senderPhone,
          text: r.transcript,
          messages: [{ text: r.transcript }],
        },
        extractedData: r.extractedData as any,
        overriddenFields: (r as any).overriddenFields ?? null,
        errorMessage: (r as any).errorMessage ?? null,
        undoneAt: r.outcome === RunOutcome.UNDONE ? new Date(completedAt.getTime() + 300000) : null,
        createdAt,
        startedAt: createdAt,
        completedAt,
      },
    });

    // Create execution steps
    await prisma.workflowStep.createMany({
      data: [
        {
          tenantId,
          runId: run.id,
          stepKey: 'step-1-transcribe-window',
          status: 'COMPLETED',
          durationMs: 420,
          executedAt: new Date(createdAt.getTime() + 420),
          outputData: { transcript: r.transcript },
        },
        {
          tenantId,
          runId: run.id,
          stepKey: 'step-2-extract-entities',
          status: 'COMPLETED',
          durationMs: 780,
          executedAt: new Date(createdAt.getTime() + 1200),
          outputData: r.extractedData as any,
        },
        {
          tenantId,
          runId: run.id,
          stepKey: 'step-5-sync-hubspot-v4',
          status: r.status === RunStatus.FAILED ? 'FAILED' : 'COMPLETED',
          durationMs: 650,
          executedAt: completedAt,
          outputData: r.externalDealId ? { dealId: r.externalDealId } : undefined,
          errorLog: (r as any).errorMessage ?? null,
        },
      ],
    });

    // Create UsageLedger record
    await prisma.usageLedger.create({
      data: {
        tenantId,
        runId: run.id,
        provider: `anthropic:${process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'}`,
        promptTokens: 850,
        completionTokens: 240,
        audioSeconds: 18,
        estimatedCostUsd: r.cost,
        recordedAt: createdAt,
      },
    });
  }

  console.log(`✅ ${runsToCreate.length} Realistic Arabic/English workflow runs seeded`);
  console.log('🎉 Seeding completed successfully!');
  console.log('Demo Login credentials:');
  console.log('  Admin User:   karim@vexel-demo.com');
  console.log('  Manager User: sarah@vexel-demo.com');
  console.log('  Workspace ID: tenant_demo_mena');
}

// Allow direct execution: `node --experimental-strip-types packages/database/prisma/seed-demo.ts`
if (process.argv[1]?.includes('seed-demo')) {
  seedDemoTenant()
    .catch((err) => {
      console.error('❌ Seeding failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
