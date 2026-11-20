# ADR 0006: Only the first 40 km of a trip counts

Date: 2026-09-15
Status: Accepted. Amends the Exposure definition in `CONTEXT.md`; ADR 0004's Study Area and proof stand.

## Context

Nationwide, some everyday trips are long. In Virginia, Origins in the far southwest drive 27 minutes to the nearest grocery store. California's desert has Origins whose nearest store is so far that their trip is not proven even in a piece widened by 60 km. A camera 50 km down the road is not part of what "everyday exposure" means for the street a trip starts from.

## Decision

**Exposure counts the Observations on a trip's first 40 km (25 miles), measured along the drive.** If the trip passes no camera in that distance, its Exposure is 0. The trip itself is unchanged: it is still the fastest route to the nearest destination in its Destination Category, and the destination and the trip's minutes are reported as before. The user set the rule on 2026-09-15.

**Origins with no reachable destination stay apart** (user, 2026-09-15). They are reported as having no destination rather than scored 0, because for a gated community behind a private road, 0 would read as "no cameras" when the cause is the routing rule.

## Considered options

- **Long trips score 0.** A trip longer than 40 km gets Exposure 0 and none of its cameras count. It would also prove every trip in a 40 km piece, since a route leaving such a piece is longer than 40 km. Rejected: it drops the cameras near home on a long rural trip, which are the everyday ones.
- **Only destinations within 40 km.** Route to the fastest destination reachable in 40 km or less, else 0. The closest to "a short errand", but it is a length-constrained route search, slower and new code.
- **No cap** (as before). Counts cameras anywhere on the trip, however far.

## Consequences

- **The proof is unchanged.** Which route a trip takes still needs the whole route, so an Origin whose trip leaves its piece is still recomputed in a wider one, and far-desert Origins can still be unproven.
- **Exposure can only fall.** A trip of 40 km or less scores as before; a longer one loses the cameras past 40 km. In Virginia (snapshot `2026-09-14T20:21:51Z`), 90 grocery trips and 1 gas trip are longer than 40 km. 24 grocery Exposures fell, 13 of them to 0, all on 28-39 minute trips south of Petersburg. No destination or route changed, and the state's mean Exposure is unchanged to two decimals (grocery 0.45, gas 0.25). Rural California and other long-trip states will change more.
- **The CSV and the page say so.** `<category>_minutes` is still the whole trip's time. The page marks trips longer than 40 km, and `npm run trip` and `npm run query` count the first 40 km and print where the counting stops.
