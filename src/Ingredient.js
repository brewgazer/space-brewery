/**
 * Brew-house ingredient definitions (pickups, mill slots, recipe matching).
 * ids are stable keys; name is player-facing text.
 */
export const INGREDIENTS = [
    { id: 'paleMalt', name: 'Pale Malt', color: 0xc4a574 },
    { id: 'crystalMalt', name: 'Crystal Malt', color: 0x8b4513 },
    { id: 'roastedBarley', name: 'Roasted Barley', color: 0x3d2914 },
    { id: 'wheat', name: 'Wheat', color: 0xe8dcc8 },
    { id: 'hopsA', name: 'Hops A', color: 0x6b8c42 },
    { id: 'hopsB', name: 'Hops B', color: 0x4a6b32 },
    { id: 'honeyMalt', name: 'Honey Malt', color: 0xd4a84b },
];

const _byId = new Map(INGREDIENTS.map((d) => [d.id, d]));

export function getIngredientById(id) {
    return _byId.get(id) || null;
}

export function getIngredientDisplayName(id) {
    return _byId.get(id)?.name || id;
}
