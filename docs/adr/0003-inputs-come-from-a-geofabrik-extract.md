# ADR 0003: Inputs come from a Geofabrik extract, read in plain Node

Date: 2026-09-14
Status: Accepted. Replaces Overpass as the source of every input (ADR 0001), and ADR 0002's 2-day staleness guard and refusals to keep data. Overpass was removed on 2026-09-15, once the Norfolk comparison below passed. ADR 0004 extends it to read neighbouring states' extracts at the same snapshot.

## Context

A nationwide build needs 13-20 million drivable ways. The public Overpass instance allows 2 concurrent queries per IP and expects bulk consumers to use extracts, so fetching roads from it at that scale would abuse a shared free service.

Geofabrik publishes a daily `.osm.pbf` extract per US state (Virginia: 407 MB, data to 2026-09-13). Ways that cross an extract's edge are kept complete.

The project runs on Windows with Node 22 and no npm dependencies. `osmium`, Docker and WSL are not installed.

## Decision

- **`fetch-data` reads the extract with a PBF reader written in plain Node.** The format is protobuf blocks compressed with zlib, which Node has built in, so there is still nothing to install.
- **Every input comes from the one extract:** roads, ALPR Cameras, destinations, and boundaries. A build has one OSM snapshot date.
- **`npm run fetch-data -- --extract <Geofabrik region> <relation id> …`** downloads the extract into `extracts/`, which is not in git, and reuses it unless run with `--refresh`.
- **`data/` keeps its shape.** The same files and fields, filtered to the same extent (the Study Area's bounding box plus 1 mile) by Overpass's rules: a way is kept if any of its nodes lies inside the extent, and a destination mapped as a way or relation is placed at the centre of its bounding box. Nothing after `fetch-data` changes.
- **The extract's snapshot date is recorded in `meta.json`, and its age is printed on every run, never refused.** The 2-day guard stopped a lagging mirror from mixing snapshots within one build. One file cannot mix, and a kept extract ages on purpose.
- **Overpass is removed once the Norfolk comparison passes.** An earlier one-city version of the project keeps it.

## Considered options

- **One npm package for PBF parsing.** The least code, but it ends "no other dependencies". Reconsider it if the Node reader takes more than about 5 minutes to read Virginia.
- **`osmium`.** Mature and fast, but on this machine it needs WSL and a Linux distribution installed first (admin rights and a reboot), and the README would need setup steps for two systems.
- **Roads from the extract, everything else from Overpass.** Less reader work, but a build would carry two snapshot dates, and a state's worth of camera and destination queries meets the same rate limit.

## Consequences

- **Choosing an area takes a region name as well as relation ids.** Picking the region from the boundary automatically, and areas that cross a state line, are left to later decisions (ADR 0004).
- **About 0.5 GB of disk per state extract**, kept between runs.
- **`data/` is rebuilt from the extract on every run.** Switching areas needs no `--refresh`, and ADR 0002's refusals to keep data fetched for different relations or a different extent no longer apply: nothing is kept to mix.
- **The reader is project code to maintain and test.** It was checked against an Overpass build of Norfolk pinned to the extract's snapshot time: every road, camera, boundary point and Exposure matched. The only difference is a destination way's centre, up to 1e-7 degrees (about 1 cm), from rounding.
- **Reading is fast enough.** Norfolk from the Virginia extract (427 MB) took 71-81 s with a peak of 304 MB of memory, on a machine with 5.9 GB.
- **A boundary relation crossing an extract's edge may arrive incomplete.** Geofabrik keeps ways and multipolygon relations complete; boundary relations are a different relation type. Norfolk lies wholly inside Virginia; building whole states (ADR 0004) meets the edge cases.
- **An extent that reaches past the extract's edge is silently short.** A boundary wholly inside the extract still errors on nothing, but roads, cameras and destinations in the part of the extent beyond the extract are missing. Washington DC shows it: its extract ends near the city line, well inside the 1-mile buffer. Choosing extracts that cover an area's whole extent is left to ADR 0004.
