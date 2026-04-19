/**
 * Purchasable tools / equipment from the supply terminal (not recipes).
 * ids are stable for save/persistence.
 */
export const LAGER_TANK_STORE_ID = 'lager_tank';

export const STORE_OBJECT_DEFS = [
    {
        id: 'grainBucket',
        name: 'Ingredient bucket',
        cost: 150,
        blurb: 'Hit each ingredient bin to load all three into the bucket, carry to the grain mill, and dump — faster than three separate trips.',
    },
    {
        id: 'fermenter_slot_1',
        name: 'Bio-Tank 2',
        cost: 100,
        blurb: 'Second fermentation tank — appears in the brewery when purchased.',
        equipment: 'fermenter',
        slotIndex: 1,
    },
    {
        id: 'fermenter_slot_2',
        name: 'Bio-Tank 3',
        cost: 200,
        blurb: 'Third fermentation tank — appears in the brewery when purchased.',
        equipment: 'fermenter',
        slotIndex: 2,
    },
    {
        id: 'fermenter_slot_3',
        name: 'Bio-Tank 4',
        cost: 350,
        blurb: 'Fourth fermentation tank — appears in the brewery when purchased.',
        equipment: 'fermenter',
        slotIndex: 3,
    },
    {
        id: 'fermenter_slot_4',
        name: 'Bio-Tank 5',
        cost: 500,
        blurb: 'Fifth fermentation tank — appears in the brewery when purchased.',
        equipment: 'fermenter',
        slotIndex: 4,
    },
    {
        id: 'tap_slot_2',
        name: 'Tap 3',
        cost: 75,
        blurb: 'Extra bar tap — appears on the rail when purchased.',
        equipment: 'tap',
        slotIndex: 2,
    },
    {
        id: 'tap_slot_3',
        name: 'Tap 4',
        cost: 150,
        blurb: 'Extra bar tap — appears on the rail when purchased.',
        equipment: 'tap',
        slotIndex: 3,
    },
    {
        id: 'tap_slot_4',
        name: 'Tap 5',
        cost: 250,
        blurb: 'Extra bar tap — appears on the rail when purchased.',
        equipment: 'tap',
        slotIndex: 4,
    },
    {
        id: 'tap_slot_5',
        name: 'Tap 6',
        cost: 400,
        blurb: 'Extra bar tap — appears on the rail when purchased.',
        equipment: 'tap',
        slotIndex: 5,
    },
    {
        id: LAGER_TANK_STORE_ID,
        name: 'Lager conditioning tank',
        cost: 550,
        blurb: 'Premium lagering vessel on the brewery floor — load lager wort for higher tap payouts (does not use a bio-tank slot).',
        equipment: 'lagerTank',
    },
];

export function getStoreObjectDef(id) {
    return STORE_OBJECT_DEFS.find((d) => d.id === id) || null;
}
