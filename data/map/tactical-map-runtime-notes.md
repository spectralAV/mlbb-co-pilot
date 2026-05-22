# Tactical Map Runtime Notes

The full tactical map is a reference and semantic coordinate space. During a live MLBB match, the app should not expect to monitor the full tactical map view continuously. Live state must come from the minimap and HUD, then be projected onto this tactical map.

## Runtime Rule

- Use full tactical-map captures as the base visual/reference for Map Trainer and semantic-zone editing.
- Use live minimap frames for real-time detection.
- Project minimap detections into tactical-map coordinates using a calibrated minimap-to-tactical mapping.
- Render inferred hero positions, danger zones, objective pressure, and rotation paths on the tactical map.

## Required Mapping Layers

- `tactical_map_reference`: full battlefield coordinate space, normalized `[x,y]` from `0..1`.
- `minimap_reference`: live minimap coordinate space, normalized `[x,y]` from `0..1`.
- `minimap_to_tactical_transform`: calibrated projection from minimap points to tactical-map points.
- `semantic_zones`: editable polygons for bushes, broken walls, rivers, objectives, lanes, jungle camps, and special seasonal mechanics.
- `path_graph`: directed and weighted movement edges for rotations, cloud routes, river current routes, and passability changes.

## Minimap Projection

The minimap is treated as a normalized square, but the tactical-map reference is a skewed battlefield rhombus. Live detections must go through the projection layer before semantic-zone lookup:

1. Normalize the detected minimap point to `[x,y]` from `0..1`.
2. Load `data/map/minimap_projection.json` or the default tactical quad.
3. Bilinearly project the square point into the tactical quad.
4. Resolve the projected tactical point against semantic zones.

This avoids naive x/y scaling, which drifts badly near side lanes, bases, river edges, and seasonal map mechanics such as broken walls, dangerous grass, flying clouds, and expanding rivers. The default projection is only a bootstrap; calibration should tune the four tactical corners from real captured reference frames.

## Current Reference Sample

- Source: `samples/mlbb_live/tactical_map/tactical-map-reference-20260522-133734.png`
- Resolution: `2856x1280`
- Capture source: Pixel native screencap
