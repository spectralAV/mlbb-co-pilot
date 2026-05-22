# Hero Recognition Notes

Hero detection should be reference-driven. The app already has official/mlbb.io hero icon URLs in `data/cache/heroes.json` and semantic hero metadata in `data/cache/compiled-heroes.json`.

## Runtime Manifest

- Endpoint: `/api/vision/heroes/manifest`
- Source cache: `data/cache/compiled-heroes.json`, falling back to `data/cache/heroes.json`
- Every hero exposes two required reference variants:
  - `normal`
  - `mirror-x`

Enemy-side portraits, draft slots, loading cards, and some panel portraits can be horizontally inverted. The matcher must compare against both variants and preserve which variant won.

## Matching Strategy

1. Classify the scene: `draft_pick`, `loading_screen`, `equipment_panel`, `attributes_panel`, or `live_hud`.
2. Crop scene-specific portrait slots.
3. Apply the slot mask: circular portrait, card portrait, or minimap portrait.
4. Resize and color-normalize the crop.
5. Compare against hero reference embeddings/templates for both `normal` and `mirror-x`.
6. Validate with nearby OCR when available, such as hero name in equipment/attributes/loading screens.

Hero names are helpful validation, not the primary signal. The primary signal is the official hero icon/portrait reference set.
