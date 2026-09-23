# Spatial grounding

Final-world 2D grounding boundary. Primarily owned by Huang (黄俊越). `WorldGroundingService` accepts known final-world render views, calls a replaceable grounder, validates pixels against each view, and persists only 2D grounding. The default provider is Bailian. It never emits authoritative final 3D Anchor coordinates; Web Geometry supplies these through the Anchor persistence route.
