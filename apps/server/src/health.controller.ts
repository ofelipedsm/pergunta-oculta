import { Controller, Get } from '@nestjs/common';
import { QUESTIONS } from '@po/question-bank';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { ok: true, questions: QUESTIONS.length };
  }
}
