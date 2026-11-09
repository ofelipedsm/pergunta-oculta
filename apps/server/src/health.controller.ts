import { Controller, Get, Inject } from '@nestjs/common';
import { QUESTIONS } from '@po/question-bank';
import { RoomsService } from './rooms/rooms.service';

@Controller('health')
export class HealthController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

  @Get()
  health() {
    return { ok: true, questions: QUESTIONS.length, rooms: this.rooms.roomCount };
  }
}
