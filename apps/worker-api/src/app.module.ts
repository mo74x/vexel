import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaService } from '@vexel/database';
import { VexelLockService } from './redis/vexel-lock.service';
import { WebhooksController } from './webhooks/webhooks.controller';
import { TenantOnboardingController } from './onboarding/tenant-onboarding.controller';
import { OpsController } from './ops/ops.controller';
import { RevOpsWorkflowProcessor } from './workflows/revops.processor';
import { AppAuthController } from './auth/app-auth.controller';
import { MagicLinkAuthService } from './auth/magic-link-auth.service';
import { AppSessionGuard } from './auth/guards/app-session.guard';
import { OperatorGuard } from './auth/guards/operator.guard';
import {
  createDefaultEmailSender,
  EMAIL_SENDER_TOKEN,
} from './auth/email-sender.interface';
import { AppRunsController } from './app-portal/app-runs.controller';
import { AppRepsController } from './app-portal/app-reps.controller';
import { AppMetricsController } from './app-portal/app-metrics.controller';
import { AppPortalService } from './app-portal/app-portal.service';

const processRole = (process.env.VEXEL_PROCESS_ROLE || 'both').toLowerCase();
const shouldRunWorker = processRole === 'worker' || processRole === 'both';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
      },
    }),
    BullModule.registerQueue({
      name: 'vexel-workflows',
    }),
  ],
  controllers: [
    WebhooksController,
    TenantOnboardingController,
    OpsController,
    AppAuthController,
    AppRunsController,
    AppRepsController,
    AppMetricsController,
  ],
  providers: [
    PrismaService,
    VexelLockService,
    {
      provide: EMAIL_SENDER_TOKEN,
      useFactory: createDefaultEmailSender,
    },
    MagicLinkAuthService,
    AppSessionGuard,
    OperatorGuard,
    AppPortalService,
    ...(shouldRunWorker ? [RevOpsWorkflowProcessor] : []),
  ],
})
export class AppModule {}

