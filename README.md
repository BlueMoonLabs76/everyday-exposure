# Everyday Exposure

**How often taxpayer-funded license plate readers record our daily drives.**

Search your street and see how many mapped license plate reader cameras you pass on the way to the grocery store, the gas station, the hospital and the nearest Waffle House (in Washington, Starbucks).

**Live demo:** <https://bluemoonlabs76.github.io/everyday-exposure/>, with maps of [Virginia](https://bluemoonlabs76.github.io/everyday-exposure/virginia/) and [Washington](https://bluemoonlabs76.github.io/everyday-exposure/washington/)

<!-- Screenshot or GIF of the Virginia demo goes here, for example:
![The Virginia demo map, grocery tab, zoomed in on one city](docs/screenshot.png)
Strip location metadata (EXIF) from the image before adding it. -->

## What it does

A demonstration model of how often the automated license plate readers (ALPRs) we pay for with public money record ordinary people going about their daily routine.

For every street in a US state, it finds the fastest drive to the nearest grocery store (one of 26 big chains, such as Kroger, Walmart, Food Lion, Publix, Fred Meyer or Safeway), gas station, hospital and Waffle House (Starbucks in Washington, which has none), then counts the mapped ALPR cameras each route passes within 75 feet in its first 40 km (25 miles). That count is the street's **Exposure** to that destination. Trips may cross the state line: every street is scored as one build of the whole country would score it. The result is one map of every state built so far, one tab per destination, where anyone can find their own street, and a CSV per state with a row per street.

The live demo covers two states, Virginia and Washington, each on its own map. A map of the whole country is planned as a later release.

## Method in brief

- **Cameras:** every OpenStreetMap node tagged `man_made=surveillance` + `surveillance:type=ALPR`. Two cameras on one pole count as two.
- **Streets:** each residential street, and each tertiary, secondary or primary road, is one starting point, scored from its midpoint. Interstates, ramps and service roads are not starting points.
- **Destinations:** the nearest one of each kind by driving time: one of 26 grocery chains (listed in [`src/config.js`](src/config.js)), any gas station, any hospital, any Waffle House (in Washington, any Starbucks instead).
- **Route:** the fastest drive over the OpenStreetMap road network, using an assumed speed per road type.
- **Count:** a camera counts once if the route passes within 75 feet of it, whichever way it faces. Only the first 40 km (25 miles) of the trip counts.

Every input is OpenStreetMap, read from [Geofabrik](https://download.geofabrik.de/) extracts in plain Node.js. The terms used throughout are defined in [`CONTEXT.md`](CONTEXT.md). Design decisions are recorded in [`docs/adr/`](docs/adr/).

## Limits: read this first

These are estimates, not records. The full disclaimer is on every map page (the text is in [`src/disclaimer.js`](src/disclaimer.js)). In short:

- **Counts are probably too low.** Camera locations come from volunteers who map them in OpenStreetMap. Cameras nobody has mapped are missing, so every count is a minimum, and some neighbourhoods are mapped more thoroughly than others.
- **Some counts are too high.** A camera counts if the route passes within 75 feet of it, whichever way it faces, so it can count a camera watching a cross street or the opposite lanes.
- **The route is an estimate.** Trips follow the fastest route under an assumed speed per road type, with no traffic, turn delays, or personal habits.

**Spot a missing or wrong camera?** Report it through [DeFlock](https://deflock.org/), not here. DeFlock's fixes go into OpenStreetMap, so everyone using the data gets them, and this map picks them up the next time it is rebuilt.

Not affiliated with Flock Safety, any camera operator, or any law enforcement agency.

## Requirements

- [Node.js](https://nodejs.org/) 22 or later. There are no other dependencies and nothing to install.
- An internet connection for the first data download, and disk for the OpenStreetMap extracts of the state and of every state near it: about 2.4 GB for Virginia, which reads ten. The data is OpenStreetMap, from [Geofabrik](https://download.geofabrik.de/) extracts.

## Run it

1. **Choose a state.** Any of the 50 states or DC, named as in [Geofabrik's list](https://download.geofabrik.de/north-america/us.html): `virginia`, `us/virginia`, or the postal code `VA`. The example used here is Virginia, and every command uses it when no state is given.

2. **Download the data** into `data/virginia/`:

   ```sh
   npm run fetch-data -- virginia
   ```

   A street near the state line may drive to a store in the next state, so this reads the state's Geofabrik extract and the extracts of every state near enough to matter (for Virginia, ten in all). They must share one OpenStreetMap snapshot, and the command refuses them if they don't: Geofabrik updates all of them once a day, so download them on the same day.

   Extracts are downloaded into `extracts/` and kept; add `--refresh` to download all of them again. `data/virginia/` is rebuilt from them on every run.

3. **Score the state:**

   ```sh
   npm run heatmap -- virginia
   ```

   This writes `out/virginia/results.bin` for the map, `out/virginia/exposure.csv`, and `out/virginia/exposure.NOTICE.txt`, the licence notice that must travel with the CSV. It prints a line per piece of the state as it goes, then a summary per county and independent city.

4. **Draw the map** of every state scored so far, and open it:

   ```sh
   npm run map
   npm run serve
   ```

   `npm run map` writes `out/map/`: the map's vector tiles in one file, `exposure.pmtiles`, the page `index.html`, the figures for each state, county and independent city, the street-name index "Find your street" searches, and `NOTICE.txt`, the licence notice for those data files. Name states after it (`npm run map -- virginia`) to draw only those. To draw a standalone map without replacing `out/map/`, give it its own folder: `npm run map -- --out map-virginia virginia` writes `out/map-virginia/`, and `npm run serve -- map-virginia` serves it. Every state on one map must come from one OpenStreetMap snapshot, and it refuses them if they don't. Keep `data/<state>/` until the map is built: the map reads the roads from it.

   `npm run serve` serves that folder at <http://localhost:8080/>. The page reads the tiles a piece at a time, so it has to be opened through a web server, not by double-clicking the file. It loads its map library from jsDelivr and needs a browser with WebGL.

5. **Check one street's trip** against the real world:

   ```sh
   npm run trip -- virginia <grocery|gas|hospital|waffle_house> <OSM way id of the street>
   ```

   It prints the route street by street, each counted camera with a Street View link, and cameras just missed, and writes `out/route.html`.

6. **Score any drive** between two points, as addresses or `lat,lon`:

   ```sh
   npm run query -- virginia "<from>" "<to>"
   ```

7. **Run the tests:** `npm test`.

## Licences

- **Code:** MIT. See [`LICENSE`](LICENSE).
- **Data:** any data the project produces, such as `exposure.csv` and the map's files in `out/map/`, is a Derivative Database of OpenStreetMap and is released under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). See [`LICENSE-DATA`](LICENSE-DATA). Share it with its notice file.
- **Prose and figures** (this README, `CONTEXT.md`, `docs/`): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Publishing a map on GitHub Pages

The map is a static folder (`out/map-<name>/`), so any static host that supports HTTP range requests can serve it. This repository keeps built data out of git: `out/` is ignored. Instead, [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes a map from a release:

1. Build the map (steps 2-4 above), for example `npm run map -- --out map-virginia virginia`.
2. Run `npm run zip-map -- virginia`. It writes `publish-virginia-map/map.zip` (the map folder plus `LICENSE-DATA`) and `virginia-exposure-csv.zip` (the data download), then reads each one back to check it.
   To put several states on one site, each on its own map, name them all: `npm run zip-map -- virginia washington` writes `publish-virginia-washington-map/map.zip`, with each map in its own folder (`virginia/`, `washington/`) and a page at the top linking to them, plus a CSV zip per state. Build each state's map with its own `--out map-<state>` first. A release replaces the whole site, so name every state that should stay on it.
3. On GitHub, create a release and attach `map.zip`, and optionally the CSV zips.
4. Publishing the release runs the workflow, which unzips it and deploys it to GitHub Pages. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions** once, before the first release.

A release asset can be up to 2 GB and a Pages site up to 1 GB, so neither git's 100 MB file limit nor the repository's size is touched. Attaching the zip to a release also makes the data downloadable, as its licence asks.

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the ODbL. Thanks to the volunteers who map these cameras in OpenStreetMap, including the [DeFlock](https://deflock.org/) project.

Made by [BlueMoonLabs76](https://github.com/BlueMoonLabs76).
