# Early Sales Targets — Research Notes

Status: Informal research, 2026-07-25. Not a commitment or outreach plan, just findings to work from.

## A note on what's actually provable here

Almost no theater publicly names its ticketing/POS vendor, so "who's running outdated tech" can't be answered directly from public sources. What's findable instead: broken or abandoned apps, customer complaints specifically about ordering/booking friction, and financial distress (which correlates strongly with deferred technology spend and real motivation to cut software costs). Those are real, evidence-backed signals, but they're indirect — treat this as a shortlist worth a closer look, not a confirmed list of prospects.

## Tier 1: Financially distressed dine-in chains

This is the strongest category, both because the evidence is concrete and because it's the same business model as Meridian — the pitch requires no translation.

**CMX Cinemas / CMX CinéBistro** — a premium dine-in chain (in-seat service, upscale menu) operating across AL, FL, GA, IL, MN, NC, OH, VA. Filed for Chapter 11 bankruptcy **twice** in five years, most recently July 2025. A company in a second bankruptcy in this narrow a window is under real, sustained financial pressure — exactly the profile likely to be receptive to a materially cheaper platform. Caveat, and it's a real one: an actively distressed or recently-reorganized company is also a genuinely risky sales target — limited or no discretionary budget, possible vendor lock-in from the reorganization itself, and real uncertainty about whether the business survives to close a deal at all.

**Studio Movie Grill** — Dallas-based, was the 11th largest chain in North America. Filed Chapter 11 in October 2020 (pandemic-driven), emerged in 2021, but later reporting describes a failed search for a buyer and a debt-equity swap presented to creditors — signals of continued financial fragility well past the initial bankruptcy. Same caveat as CMX applies.

**Flix Brewhouse** — smaller cinema-brewery chain; at least its El Paso location filed Chapter 11 in 2021 (~$8.2M assets vs. $17M+ liabilities), attributed to delayed SBA Shuttered Venue Operators Grant funds. Smaller scale than CMX/SMG, which may mean less bureaucratic friction to actually reach a decision-maker.

## The single best piece of concrete evidence: Movie Tavern

Movie Tavern (operated in part under Marcus Theatres, and separately by Southern Theatres) is worth calling out specifically, because the complaints found aren't vague "the website is dated" impressions — they're exactly the operational failure modes this platform is built to prevent:

- Their mobile ordering app reportedly threw "server busy" errors, then disappeared from the App Store entirely — an abandoned or failed app, not just an outdated one.
- Customer complaints describe having to physically leave the auditorium and walk to the lobby to place a food order — the seat-linked ordering promise not actually working.
- Drinks arriving halfway through the film, incomplete orders, and no follow-up service — the exact "check-drop and delivery reliability" problems already designed around in RESTAURANT_WORKFLOW.md.

This is close to a ready-made before/after pitch: here's a chain whose in-seat ordering technology is documented, by their own customers, as broken in practice.

## Broader / lower-confidence leads

A wider scan of small-to-mid regional operators (Southern Theatres' broader non-Movie-Tavern portfolio, Spotlight Theatres, Starlight Cinemas, Santikos, Southeast Cinemas) turned up normal-range complaints (online booking service fees, an app losing ticket history) rather than anything as concrete as Movie Tavern's — worth keeping on a longer list, but not headline evidence.

Also surfaced, a different and much smaller segment: cash-only discount/dollar theaters (e.g., a $3-ticket cash-only house in Northampton, PA; a discount chain in Dayton/Cincinnati, OH). Worth flagging as probably the wrong target despite the "outdated tech" signal being the most literal one found — these are deliberately ultra-low-margin operations where even a cheap SaaS platform may cost more than their existing cash-register setup, and they have no dine-in ambitions to make the seat-linked pitch land.

## Honest bottom line

The strongest opening pitch isn't necessarily "your specific system is bad" — it's cost, which is the whole thesis of this business (see PRODUCT_SPEC.md §1.1). Financial distress at CMX/Studio Movie Grill/Flix Brewhouse makes them plausible early conversations precisely because they're cost-motivated, but their scale and legal/financial complexity may make them slow, hard first customers. A smaller, healthy independent theater — not in the news for bankruptcy, just quietly paying too much for Vista or juggling three disconnected tools like Filmbot-plus-a-separate-POS-plus-a-separate-scheduler — may in practice be the easier, faster first sale, even without a dramatic story to point to.
