import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { prisma } from '@vexel/database';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Ensures BullMQ workers drain active jobs before OnModuleDestroy closes Prisma & Redis
  app.enableShutdownHooks();

  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });

  await app.listen(process.env.PORT || 3001);
}
bootstrap();
