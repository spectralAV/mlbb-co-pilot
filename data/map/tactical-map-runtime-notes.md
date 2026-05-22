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
- `minimap_to_tactical_transform`: affine/homography transform from minimap points to tactical-map points.
- `semantic_zones`: editable polygons for bushes, broken walls, rivers, objectives, lanes, jungle camps, and special seasonal mechanics.
- `path_graph`: directed and weighted movement edges for rotations, cloud routes, river current routes, and passability changes.

## Current Reference Sample

- Source: `samples/mlbb_live/tactical_map/tactical-map-reference-20260522-133734.png`
- Resolution: `2856x1280`
- Capture source: Pixel native screencap
