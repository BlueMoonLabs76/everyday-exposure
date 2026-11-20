# ADR 0002: The Study Area can be a union of boundaries

Date: 2026-09-13
Status: Accepted. Extends ADR 0001; its use of OSM administrative boundaries and its Destination Categories stand. ADR 0003 replaces its 2-day Overpass guard, and, by rebuilding `data/` on every run, its refusals to keep data for different relations or a different extent. In this fork, ADR 0004 supersedes it: the Study Area is the country.

## Context

ADR 0001 made the Study Area one boundary relation. Neighbouring cities in one metro are often split by nothing a driver notices: trips from one routinely end in the other, and both share the same road network, cameras, and destinations. Two separate maps would need separate data directories and would say nothing a single map can't.

## Decision

**The Study Area is the union of the boundary relations given to `fetch-data`** (`npm run fetch-data -- <relation id> …`), on one map. Run without ids, it keeps the area already in `data/`, or falls back to the example in `DEFAULT_RELATIONS`.

- **Holes belong to their own area.** An enclave one boundary does not contain is excluded only if no other boundary in the union covers it. `data/boundary.json` holds `areas`, one per relation, each with its own outer and inner rings.
- **The extent is the union's bounding box plus 1 mile.** Every input is fetched from it.
- **The place name is the areas' names joined** ("A, B and C"). It appears in the page subtitle, the search's no-match text, and the CSV notice.
- **`fetch-data` refuses** a `boundary.json` for different relations, and refuses to keep data fetched for a different extent. The run must be `--refresh`.
- **`fetch-data` also refuses an Overpass response more than 2 days behind.** Overpass mirrors have been seen answering during main-server timeouts with snapshots months old. Without the guard, a build silently mixes stale inputs with current ones.
- **`build-heatmap` prints Origins and mean Exposure per area** as well as the total, so a change in one area can be told apart from the others.

## Consequences

- **Adding a neighbour is one more relation id and a `--refresh`**, as long as it is near enough to share one extent.
- **Distant areas are not handled.** Two far-apart boundaries would share one bounding box with everything between them. Separate areas still need separate data directories.
- **A union within one metro is not an independent replication.** Differences between its parts are differences to look at, not results: the volunteer-mapping caveat applies across a city line as much as within one.
