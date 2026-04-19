# Asset credits (free / permissive use)

## 3D models (`assets/models/`)

- **Patron.glb** — [RobotExpressive](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive) from the [three.js](https://github.com/mrdoob/three.js) examples (MIT project). Low-poly character with Idle, Walking, Sitting, Wave, Yes/No, etc. Downloaded via `npm run fetch-assets` as `Patron.glb`.
- **Soldier.glb** (optional legacy file) — same three.js examples tree; used only if `Patron.glb` is absent.
- **Fox.glb** (optional, fetched by script) — [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) (CC-BY 4.0 / permissive sample license per asset page).
- **FurnitureChair.glb** — [SheenChair](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) from the [three.js](https://github.com/mrdoob/three.js) examples (MIT project). Used as the taproom chair mesh; materials are replaced in code for a consistent sci-fi look. Downloaded via `npm run fetch-assets`.

## Textures (`assets/textures/`)

- **wood_floor_worn**, **concrete_floor_worn**, **metal_grate_rusty** — [Poly Haven](https://polyhaven.com), **CC0** (public domain).

## Runtime IBL

- **Room environment** — generated in-engine via Three.js `RoomEnvironment` (no external file), used as image-based lighting for metal/wood materials.

Download everything with:

```bash
npm run fetch-assets
```
