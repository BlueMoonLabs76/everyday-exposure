# ADR 0001: The Study Area is a set of OSM administrative boundaries

Date: 2026-09-12
Status: Accepted. Extended by ADR 0002, which allows a union of boundaries. ADR 0003 replaces Overpass as the source of every input. In this fork, ADR 0004 supersedes its Study Area: the Study Area is the country. Its Destination Categories stand, except Interstate, which ADR 0005 drops.

## Context

The pipeline needs a boundary that decides which Origins are scored, and every Destination Category needs destinations that can be found wherever the model runs.

Boundaries and destination rules taken from locally published datasets have two problems:

- **They churn.** Agency-drawn zones are often redrawn every year. A rebuild from a fresh OSM snapshot would silently mix a current road network with a stale set of zones, and nothing in the pipeline would notice.
- **They don't generalise.** No current, national, open, machine-readable source exists for most such zones. A model built on one could only run in the handful of places that publish it, and could not define a Study Area anywhere else.

Compute is not the constraint: scoring an area is seconds, and a nationwide run is a single-machine job. The data sources are.

## Decision

**The Study Area is the area of an OSM administrative boundary relation**, typically a city's limits. The extent everything else is fetched from is derived from the same boundary (its bounding box plus 1 mile), so the extent and the Study Area come from one source.

Enclaves the boundary does not contain arrive as `inner` members of the relation and are treated as holes: a point inside one is outside the Study Area.

**Destination Categories are limited to destinations OSM maps everywhere:** grocery, gas, and Interstate. A category that needs a locally published assignment rule is not one the pipeline can assume.

**The breakdown table is "By destination":** every street that drives to one destination, most exposed first. It needs no extra data source and changes per category.

## Consequences

- **Every input is OSM via Overpass**, under one licence, the ODbL, with no carve-outs.
- **A new area needs one number**, a boundary relation id, rather than a search for a local GIS service.
- **City limits are not where everyone lives.** Suburbs outside the boundary are not scored, and a boundary drawn for administration can split a neighbourhood.
- **What is lost:** destinations whose assignment is set by local rules rather than by distance cannot be modelled.

## Alternatives considered

- **Census Urban Area polygons.** Nationally uniform, but an Urban Area is not a city: it spills into suburbs the project makes no claim about, and it adds a second data source.
- **Locally published zones as the boundary only.** Rejected: it keeps the annual-churn dependency, and it still blocks every area that doesn't publish them.
