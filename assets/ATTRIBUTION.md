# Asset credits (free / permissive use)

## 3D models (`assets/models/`)

- **Soldier.glb** — from the [three.js](https://github.com/mrdoob/three.js) repository `examples/models/gltf/` (MIT project). Standard demo asset with Idle / Walk / Run used for animated patrons.
- **Fox.glb** (optional, fetched by script) — [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) (CC-BY 4.0 / permissive sample license per asset page).

## Textures (`assets/textures/`)

- **wood_floor_worn**, **concrete_floor_worn**, **metal_grate_rusty** — [Poly Haven](https://polyhaven.com), **CC0** (public domain).

## Runtime IBL

- **Room environment** — generated in-engine via Three.js `RoomEnvironment` (no external file), used as image-based lighting for metal/wood materials.

Download everything with:

```bash
npm run fetch-assets
```
