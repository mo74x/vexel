import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('VexelWorkerApi');
  const app = await NestFactory.create(AppModule);

  const port = Number(process.env.PORT || 3001);
  await app.listen(port);
  logger.log(`Vexel Worker API listening on port ${port}`);
}

bootstrap();

