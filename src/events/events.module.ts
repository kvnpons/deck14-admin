import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { PublicEventsController } from './public-events.controller';
import { BookingLinksController } from './booking-links.controller';
import { EventsService } from './events.service';

@Module({
  controllers: [EventsController, PublicEventsController, BookingLinksController],
  providers: [EventsService],
})
export class EventsModule {}
