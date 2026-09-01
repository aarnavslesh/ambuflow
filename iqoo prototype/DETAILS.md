# ambuflow — project details

Read this before writing any feature code. The decisions below were made
deliberately; do not change them without asking.

## What this is

A multi-role ambulance emergency-coordination app. One app, five roles selected at a
role-select screen:

| Role | Screen does |
| --- | --- |
| Citizen | Report an emergency, see alerts |
| Ambulance | View route on map, start journey |
| Police | See task cards, acknowledge them |
| Hospital | Watch incoming ETA countdown |
| Traffic | Monitor the whole system |

An ambulance travels a route while traffic signals, police tasks and the hospital ETA
all react to its progress. **There is no backend** — every piece of data is mock data
in `data/mockData.ts`. Current goal is a hackathon prototype: a convincing, reliable
demo, not production code.

## Runtime constraints

The prototype runs in **Expo Go on a physical Android phone over USB**. Consequences:

- **No custom native modules.** Anything needing a dev build is out.
- **No `react-native-maps`.** The map is a stylized, hand-drawn mock — no real tiles,
  no API keys. Do not suggest a real map library.
- Prefer dependency-free solutions; the dependency list is deliberately tiny.

## Locked design decisions

**Coordinates.** All positions are `Point { x: number; y: number }`, normalized 0–100
on both axes (0,0 = map top-left, 100,100 = bottom-right). The UI scales to pixels.
**Not** latitude/longitude — the map is stylized, and the geometry code uses flat
Euclidean distance (`Math.hypot`), which is invalid on real lat/lng.

**Emergency has no type/category field.** A citizen reporting an emergency is often
panicking and has no medical training, so self-classification produces bad data.
Dispatch is location-first. Never add an emergency-category picker.

**Traffic signals use a deterministic green wave keyed to route progress `p` (0–1).**
The next un-passed on-route signal is forced green and its junction's cross-traffic is
forced red. Signals already passed return to *normal green*. Signals further ahead
stay red until their turn. At most **one** junction ever holds cross-traffic red, and
it is always the one directly ahead of the ambulance; past the final junction, none do.

Why it matters: greening a signal far ahead would tell drivers *in front of* the
ambulance to move into its corridor, causing collisions at intersections. Keying to
progress rather than proximity also makes the demo behave identically every run.

**Signal trigger points are derived, not hardcoded.** `utils/gpsSimulator.ts` projects
each on-route signal's position onto the route polyline to compute when it fires.
`Signal.triggerAtProgress` exists only as an optional manual override and is unset in
seed data. This keeps triggers correct when route coordinates change.

**`Signal.state` in seed data is an at-rest snapshot for reference only.** It is never
read by `getSignalStates` — colour is always computed from progress. Editing a seed
`state` value will not change anything on screen.

**Route is a single leg**: pickup → hospital. The ambulance station is a decorative
landmark, not a route start.

**Progress `p` is the only mutable state.** Position, ETA and every signal colour must
be pure functions of `p`. Keep those functions separate from the ticker so they stay
deterministic and testable. The store decides *when* to ask; it never reimplements
green-wave logic.

## Verifying changes

`scripts/verify.ts` asserts the geometry and green-wave logic. **Re-run it after any
change to `DEMO_ROUTE` or `DEMO_SIGNALS`** — trigger points are derived from route
geometry, so moving a coordinate silently shifts when signals turn green.

Expected derived triggers for the current route (total arc length 178):

| Signal | Trigger | Arc |
| --- | --- | --- |
| A-thru | ≈ 0.2809 | 50/178 |
| B-thru | ≈ 0.5618 | 100/178 |
| C-thru | ≈ 0.8034 | 143/178 |

Always finish a change with `npx tsc --noEmit` and confirm zero errors.
