import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// Fase 2: registrar aqui o RoomsModule (gateway + service) que usa o núcleo em src/game.
@Module({
  controllers: [HealthController],
})
export class AppModule {}
