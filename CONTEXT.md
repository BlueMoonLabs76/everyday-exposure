# Everyday Exposure

Measures how much automated license plate reader (ALPR) surveillance a person driving from home to an everyday destination is subject to, and maps that exposure across the country.

## Language

**ALPR Camera**:
A single automated license plate reader at a known location, sourced from OpenStreetMap as a node tagged `man_made=surveillance` with `surveillance:type=ALPR`. Every node is its own camera, even when two share a pole: cameras are often installed back to back to cover both directions.
_Avoid_: Flock camera, plate reader, CCTV, surveillance camera

**Observation**:
One instance of an ALPR Camera recording a passing vehicle, modeled as the traveled path coming within the Observation Radius of the camera. The camera's bearing is deliberately not considered.
_Avoid_: Hit, scan, read, detection, sighting

**Observation Radius**:
The distance from an ALPR Camera within which a passing path is counted as an Observation. 75 feet.
_Avoid_: Range, buffer, field of view, detection radius

**Exposure**:
The number of Observations accumulated along one specific path, counting only its first 40 km (25 miles): Observations past that point are not counted, and a path with none in its first 40 km has Exposure 0. The path itself, and the destination it reaches, are unchanged by the cap. A property of a path, not of a place. An address's Exposure to a Destination Category is the Exposure of its route to that category: one per category, never a single overall figure. The headline metric of every map.
_Avoid_: Exposure score, Flock Score, camera count, hits

**Destination Category**:
A kind of everyday errand destination that Exposure is measured against: grocery, gas, hospital and the state's local icon. Grocery is a store of one of 26 chains, listed in `src/config.js` (ADR 0008 and its 2026-11-19 and 2026-11-23 amendments). The local icon is Waffle House, except where `src/config.js` names another for the state: Starbucks in Washington (2026-11-23), which has no Waffle House within reach. Each category produces its own independent map.
_Avoid_: Destination type, POI type, trip purpose

**Study Area**:
The land whose Origins are scored: the 50 US states and the District of Columbia, identical for every Destination Category. Every Origin in it is scored once, from one OSM snapshot, and its Exposure is the one a single build of the whole country would give.
_Avoid_: Extent, bbox, coverage, area

**Selection**:
A named part of the Study Area that someone picks to look at, such as a state, county, city, metropolitan area, or ZIP code area. It filters the map and its summary figures and never changes any Origin's Exposure.
_Avoid_: Area, region, study area, zone

**Local Road**:
A road of the kind people live on rather than travel through, currently `highway=residential`, `unclassified`, or `living_street`. The exact membership is pending.
_Avoid_: Minor road, side street, neighborhood street

**Origin**:
The midpoint of one surface street way inside the Study Area, standing in for the residences along it: a Local Road, or a `tertiary`, `secondary`, or `primary` road. Interstates, ramps, and service roads give none. Origins are what the pipeline computes Exposure for.
_Avoid_: Address, start point, source, house

**Exit Node**:
The last node on a route that lies on a Local Road, before the route first enters a higher road class. The point at which a driver leaves the neighborhood and joins the through network.
_Avoid_: Choke point, gateway, egress, portal

**Exit Group**:
The set of Origins sharing both an Exit Node and a destination instance, for one Destination Category. The unit a displayed score is taken from: each member's Local Road way is drawn in the group's score color. Because members share the whole route after the Exit Node, they share an Exposure.
_Avoid_: Cluster, block, zone, neighborhood, region
