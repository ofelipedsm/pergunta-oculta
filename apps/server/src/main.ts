import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { corsOrigin } from './cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: corsOrigin() });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Servidor ouvindo na porta ${port}`);
}

void bootstrap();
