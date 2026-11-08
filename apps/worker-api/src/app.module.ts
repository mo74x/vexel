import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaService } from '@vexel/database';
import { VexelLockService } from './redis/vexel-lock.service';
import { WebhooksController } from './webhooks/webhooks.controller';
import { TenantOnboardingController } from './onboarding/tenant-onboarding.controller';
import { RevOpsWorkflowProcessor } from './workflows/revops.processor';

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
  controllers: [WebhooksController, TenantOnboardingController],
  providers: [PrismaService, VexelLockService, RevOpsWorkflowProcessor],
})
export class AppModule {}

