# Ticket-buyer ZIP Reporting — Current Status

The original brief proposed capturing ZIP codes on ticket orders, aggregating them
for reporting, and displaying a ZCTA choropleth. The data and reporting foundation
shipped, but a later checkout decision changed the collection path and the map was
not implemented.

## Shipped foundation

- `TicketOrder.zipCode` is nullable and backed by an additive migration.
- Ticket checkout request validation accepts an optional five-digit ZIP or ZIP+4.
- The ticketing service normalizes and persists the value on the order rather than
  the customer.
- `GET /reports/audience-origins` aggregates completed orders by five-digit ZIP for
  the authenticated location and selected reporting range.
- The response contains only aggregate order/ticket counts, share, and coverage;
  it does not expose customer or order identities.
- Admin's Reports & Finance view displays audience-origin totals and a ZIP table.
- The reporting endpoint uses the same reporting permission boundary as the other
  management reports.

## Deliberate checkout change

The optional ZIP control was subsequently removed from customer checkout together
with other ticket controls. A customer-web regression test explicitly requires the
ZIP field and `zipCode` request property to remain absent from that checkout UI.

Consequently, the report is structurally complete but will only contain data from
sales channels or future integrations that supply `zipCode`. Reintroducing direct
customer collection is a product/privacy decision, not an unfinished mechanical
step from this brief.

## Map status

No choropleth or mapping dependency is present. The current visualization is an
aggregate table. Adding a map still requires decisions about:

- whether ZIP collection should return to customer checkout or be limited to other
  sales channels;
- the ZCTA boundary dataset and update process;
- the mapping library/provider and any associated hosting or token costs; and
- privacy language and retention expectations for this per-purchase data.

If approved later, use ZCTA polygons joined to the existing aggregate endpoint.
Do not infer ZIP codes from IP addresses or render a smoothed point-density heatmap.

## Status

The reporting foundation is shipped. Customer collection and the geographic map
are deferred pending the decisions above.
