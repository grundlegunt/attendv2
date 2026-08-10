# Opening-night load test

`pnpm test:load` exercises the deployed API through normal HTTP boundaries. It concurrently sells every available seat in one showtime in each of three auditoriums, then sends a configurable restaurant-order burst across all three rooms. The run fails on double/missing ticket issuance, seats left held or available after sellout, unsent restaurant orders, any HTTP error, or a breached workload-specific p95 latency budget. Ticket-sale and restaurant timings are measured and enforced separately so the higher-volume restaurant burst cannot hide a checkout regression.

Run only against an isolated load-test environment. The test creates real cash sales and restaurant tabs.

Required configuration:

- `LOAD_API_URL`
- `LOAD_SHOWTIME_IDS`: exactly three comma-separated, empty on-sale showtimes in distinct auditoriums
- `LOAD_TICKET_TYPE_ID`: an active ticket type at that location
- `LOAD_STAFF_EMAIL` and `LOAD_STAFF_PASSWORD` (defaults match the development seed only)

Optional tuning:

- `LOAD_RESTAURANT_ORDERS_PER_AUDITORIUM` (default `30`, for 90 simultaneous orders)
- `LOAD_TICKET_SALES_P95_BUDGET_MS` (default `2500`)
- `LOAD_RESTAURANT_P95_BUDGET_MS` (default `2500`)
- Raise `CHECKOUT_RATE_LIMIT_ATTEMPTS` only in the isolated load environment if the chosen auditoriums require more than 30 ten-seat checkout groups per cashier.
