import { Injectable, MessageEvent } from "@nestjs/common";
import { filter, map, Observable, Subject } from "rxjs";

interface FulfillmentEvent {
  locationId: string;
  kitchenStationId: string;
  type: "TICKET_CREATED" | "TICKET_UPDATED";
  ticketId: string;
}

@Injectable()
export class FulfillmentEventsService {
  private readonly events = new Subject<FulfillmentEvent>();

  publish(event: FulfillmentEvent) {
    this.events.next(event);
  }

  forStation(locationId: string, kitchenStationId: string): Observable<MessageEvent> {
    return this.events.pipe(
      filter(
        (event) =>
          event.locationId === locationId &&
          event.kitchenStationId === kitchenStationId,
      ),
      map((event) => ({ type: event.type, data: event })),
    );
  }
}
