# ADR 0005: The Interstate category is dropped

Date: 2026-09-14
Status: Accepted. In this fork, removes Interstate from ADR 0001's Destination Categories; grocery and gas stand. An earlier one-city version of the project keeps it.

## Context

ADR 0001 set three Destination Categories: grocery, gas and Interstate. An Interstate trip ended at the Interstate Entrance, where an on-ramp merges onto an OSM `motorway` with an `I` ref, on the premise that interstate mainlines carry no ALPR Cameras.

The category was a stand-in for a short trip, the way out of the neighbourhood onto the through network (user, 2026-09-14). It was never meant to measure highway driving. Nationwide, it stops being a short trip, and it breaks in other ways:

- **The trip isn't short.** Norfolk's longest trip to an entrance is 8.9 minutes. Across much of the Mountain West and the Great Plains, the nearest interstate is over 100 miles away.
- **Interstates aren't tagged one way.** Hawaii's carry `ref=I H1` and similar, which the `I` pattern misses. Alaska's are unsigned: its motorways carry `AK 1`, `AK 2` and `AK 3`, and only route relations tagged `network=US:I` mark them. Both states had no Interstate Entrances.
- **Mainline readers exist.** Checking sample trips found two camera sites on interstate mainlines. A count on 2026-09-14 (Overpass, current data) found, in the first four states alphabetically, 108 of 6,487 ALPR Cameras within 75 ft of an interstate mainline, and 66 (about 1%) with no other drivable road within 75 ft. Ending trips at the merge misses them.
- **It was the most quotable figure.** Norfolk's mean Interstate Exposure, 2.48, was its highest category, ahead of grocery's 1.45 and gas's 0.87. The figure most likely to be quoted was the least like an everyday errand.

## Decision

**Drop the Interstate category.** The Destination Categories are grocery and gas. No replacement category.

## Considered options

- **Keep ending trips at the merge,** say so plainly on the page, and fix the Hawaii and Alaska tagging. It keeps a category that no longer measures what it stood for.
- **Continue trips along the interstate to an exit.** The errand model defines no exit.
- **Replace it with another short everyday errand OSM maps nationally,** such as a pharmacy or post office. Possible later; nothing in the nationwide build needs it.

## Consequences

- **`src/interstate.js`, the Interstate tab, the `interstate` option of `npm run trip`, `INTERSTATE` in `config.js`, and its test are removed.** `exposure.csv` loses its three `interstate_` columns. The Interstate Entrance term leaves `CONTEXT.md`.
- **Grocery and gas Exposures are unchanged.** The categories are scored independently.
- **A grocery or gas trip that drives along an interstate counts the mainline cameras it passes,** like any other road. No category ends a trip at a merge any more.
- **The map still has long rural trips to show,** from grocery and gas, but no 100-mile trips to an interstate.
