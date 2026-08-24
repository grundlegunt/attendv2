# Staff POS Deployment and Menu Layout — Shipped

This document records the disposition of the original Staff POS deployment and
menu-layout brief. Both independent workstreams are complete.

## Deployment

Staff POS and KDS are deployed as their own Vercel projects alongside the other
Attend applications:

- `attend-staff-pos`
- `attendv2-kds`

Both projects participate in the repository's pull-request preview checks. Their
browser clients use the same API and authentication boundary as the rest of the
staff applications; physical terminals therefore only need a supported browser.

Environment configuration remains deployment-owned. In particular,
`NEXT_PUBLIC_API_URL` and the API's allowed origins must include the deployed
application URLs in each environment.

## Server POS menu

The requested dense ordering layout is implemented in
`apps/staff-pos/app/restaurant-pos.tsx` and its styles:

- one menu category is displayed at a time;
- sticky category tabs switch the visible item grid;
- compact tiles keep item names and prices visible;
- descriptions and modifier controls expand only for the selected item;
- required modifier validation remains part of the add-item flow; and
- a sticky current-check sidebar keeps draft items and the subtotal visible while
  the server browses the menu.

The change retained the existing menu data, station routing, ordering flow, and
required-modifier behavior.

## Status

No remaining implementation work is tracked by this brief. Future POS interaction
changes should be based on new operator feedback rather than the superseded layout
description.
