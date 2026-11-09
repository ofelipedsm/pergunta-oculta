import { Module } from '@nestjs/common';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './rooms.service';

@Module({
  providers: [{ provide: RoomsService, useFactory: () => new RoomsService() }, RoomsGateway],
  exports: [RoomsService],
})
export class RoomsModule {}
