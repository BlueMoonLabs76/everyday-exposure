# ADR 0008: Hospital and Waffle House categories; grocery is seven chains

Date: 2026-09-15
Status: Accepted. Adds two Destination Categories to ADR 0005's grocery and gas, and narrows grocery.

## Context

The user asked for two more destinations, the hospital and Waffle House, and for grocery to mean these stores: Kroger, Walmart, Harps, Aldi, Brookshire's, Piggly Wiggly and Super 1 Foods. Until now grocery was any `shop=supermarket` or `shop=grocery`, which took in dollar stores, food pantries tagged as supermarkets ("Blessing Box") and mistagged shops such as Virginia's Hubbard Peanut Company.

## Decision

- **Grocery** is a feature tagged `shop=supermarket`, `grocery` or `department_store` whose `brand` or `name` names one of the seven chains. Several of them run fuel centers under the same brand; those carry `amenity=fuel` and no `shop`, so they stay gas and never become grocery. "Brookshire's" does not match Brookshire Brothers, a separate company.
- **Hospital** is `amenity=hospital` or `healthcare=hospital`.
- **Waffle House** is `amenity=restaurant` or `fast_food` whose `brand` is Waffle House or whose `name` starts with it.

Every input is still OSM.

## Consequences

- **`exposure.csv` gains `hospital_` and `waffle_house_` columns, and the map gains two tabs.** Every state must be fetched, scored and drawn again: a map refuses states whose categories differ.
- **Grocery Exposures change** wherever the nearest supermarket was not one of the chains. Virginia's read, which takes in stores in nearby states, went from 2,980 grocery destinations to 628. Inside Virginia: 1,242 to 278, and mean grocery Exposure rose from 0.45 to 1.10; 6,877 grocery trips now run past 40 km.
- **Waffle Houses are sparse.** In Virginia, 8,846 of 322,965 Origins (2.7%) are unproven for Waffle House: the nearest one is past the widest piece buffer, 60 km, and they are drawn gray. Hospital has 16. In a state with fewer Waffle Houses the share is far higher (18% in the first state rebuilt).
- **The chain list is regional.** Harps, Brookshire's, Super 1 Foods and most Piggly Wigglys are in the South. Much of the country is served only by Kroger, Walmart and Aldi, and its grocery trips will run longer than its real ones.
- **OSM's hospital tag is broad.** It includes psychiatric, rehabilitation and long-term care hospitals with no emergency room.

## Amendment, 2026-11-19: the chain list is widened

The seven chains missed the big grocers of Virginia and the Mid-Atlantic, so grocery trips there ran to distant stores. Twelve chain names were added: Food Lion, Giant, Martin's (Giant's sister brand), Harris Teeter, Lidl, Safeway, Food City, Publix, Wegmans and Weis, plus IGA and Save-A-Lot for rural areas. The full list is `GROCERY_CHAIN` in `src/config.js`. Dollar stores stay out on purpose: they get many quick trips but a small share of food spending. Virginia's mean grocery Exposure fell from 1.10 to 0.52.
