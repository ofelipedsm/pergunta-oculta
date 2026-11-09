import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origin = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? true;
  app.enableCors({ origin });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Servidor ouvindo na porta ${port}`);
}

void bootstrap();
