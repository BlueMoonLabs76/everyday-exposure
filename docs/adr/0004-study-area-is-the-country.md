# ADR 0004: The Study Area is the country

Date: 2026-09-14
Status: Accepted. In this fork, supersedes ADR 0001's and ADR 0002's Study Area (a union of boundary relations); ADR 0001's Destination Categories stand. Extends ADR 0003 to read neighbouring extracts.

## Context

ADR 0001 made the Study Area a city's boundary relation, and ADR 0002 a union of neighbouring ones. This fork's destination is a heat map of the whole country where anyone can find their own street. Cutting the country into areas and building each one alone gives wrong answers at every cut: a street near an area's edge whose nearest grocery lies over the edge is silently routed to a farther one inside.

One build of the whole country has no such cuts, and it is the answer this fork wants. It does not fit this machine: research §2c puts the national road network at 80-90 million nodes, several times what 5.9 GB of memory holds in today's representation, and the reader's `Map` of node ids stops at 2^24 (about 16.7 million) entries.

People still want to look at part of the map: a state, a city, a metro, a ZIP code.

## Decision

**The Study Area is the 50 US states and the District of Columbia**, read from one OSM snapshot. Territories are left for later.

**Every Origin's Exposure equals what a single build of the whole country would give.** The build runs in pieces to fit in memory, and the pieces never show in the output:

- **A piece is a state plus a buffer,** read from the state's Geofabrik extract and its neighbouring states' extracts. Extracts are cut from one daily update, so same-day downloads share a snapshot (Virginia and DC both read `2026-09-14T20:21:51Z`). The build refuses extracts whose snapshots differ.
- **Each Origin is proven to have stayed inside its piece:** its trip must take no longer than its fastest way out of the piece. Any route leaving the piece first reaches its edge, so no route through the outside can be faster. Origins that fail are counted and recomputed in a larger piece.
- **Ties are broken by OSM ids,** so two equally fast routes past different cameras resolve the same way however the country is cut.
- **The national border is a wall.** Trips stay in the US, and destinations and ALPR Cameras outside it are not part of the model. A country-wide build has the same wall, so the proof does not test against it.

Piece size is measured in the first state builds, not fixed here.

**A Selection filters the map and its summaries and never changes an Exposure.** State, county and city Selections come from OSM boundary relations, in the extract already read. Metropolitan areas (OMB delineations) and ZIP code areas (Census ZCTAs) may be added later from dated national files, each with its vintage shown. USPS ZIP codes are not used: they are mail routes rather than shapes, and they change constantly. "Every input is OSM" still holds for every input to Exposure.

**Rural streets are built.** How long rural trips are shown is decided with the map's output format (ADR 0007).

## Considered options

- **Counties** (`admin_level=6`). Automatic, all OSM, and they tile every state without crossing a state line, but each county alone is wrong at its edge, and a metro is split into many.
- **Cities and towns.** The level varies by state and within one (Virginia's independent cities are level 6, its towns level 8), and unincorporated suburbs get no Origins: Fairfax County's 1.15 million people live in no city.
- **Cities plus Census-designated places** (`boundary=census`, 462 in the Virginia extract). Covers suburbs, but gaps between places remain, and the import is not known to be national.
- **Census urban areas.** Travel-shaped, but a second input source, rejected by ADR 0001.
- **One whole-country build.** The right answer, and the one the pieces must reproduce, but it does not fit in memory here.
- **A single state extract per piece**, with Origins near a state line only flagged. Simpler, but it leaves the edge of every state short, as the Norfolk comparison found in DC.
- **The 12.1 GB US extract.** One file, but every piece would read about 28 times as much as Virginia's.

## Consequences

- **No area edges in the output.** A street's Exposure does not depend on which piece computed it.
- **Choosing an area is no longer a build input.** `fetch-data`'s relation ids and `--extract` region give way to building states, and the README's "Choose an area" changes with that code.
- **Border states need their neighbours' extracts on disk,** about 0.5 GB each, downloaded the same day.
- **Per-area summaries become per-Selection summaries,** and a build's run figures are reported per piece.
- **An Origin with no reachable destination** (an island, a disconnected road) is reported as such rather than failing its area.
- **Metro and ZIP Selections bring non-OSM files** to the output. A stale one can mislabel which streets are in a metro, never change an Exposure.
