import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaService } from '@vexel/database';
import { VexelLockService } from './redis/vexel-lock.service';
import { WebhooksController } from './webhooks/webhooks.controller';
import { TenantOnboardingController } from './onboarding/tenant-onboarding.controller';
import { OpsController } from './ops/ops.controller';
import { RevOpsWorkflowProcessor } from './workflows/revops.processor';

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
  controllers: [WebhooksController, TenantOnboardingController, OpsController],
  providers: [
    PrismaService,
    VexelLockService,
    ...(shouldRunWorker ? [RevOpsWorkflowProcessor] : []),
  ],
})
export class AppModule {}

