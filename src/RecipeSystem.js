/** New games start with only these recipe ids unlocked (kiosk sells the rest). */
export const STARTER_UNLOCKED_RECIPE_IDS = ['lager'];

export const RECIPES = [
    {
        id: 'ipa',
        name: 'IPA',
        color: 0xd4a017,
        foamColor: 0xfff8e7,
        description: 'Hoppy & Bitter',
        brewTime: 18,
        fermentTime: 45,
        price: 8,
        unlockCost: 140,
    },
    {
        id: 'stout',
        name: 'Stout',
        color: 0x1a0f0a,
        foamColor: 0xd4c5a9,
        description: 'Dark & Heavy',
        brewTime: 22,
        fermentTime: 55,
        price: 10,
        unlockCost: 175,
    },
    {
        id: 'lager',
        name: 'Lager',
        color: 0xf5d442,
        foamColor: 0xffffff,
        description: 'Light & Crisp',
        brewTime: 14,
        fermentTime: 35,
        price: 6,
        unlockCost: 0,
    },
    {
        id: 'wheat',
        name: 'Wheat Beer',
        color: 0xe8c547,
        foamColor: 0xfff5d4,
        description: 'Cloudy & Smooth',
        brewTime: 15,
        fermentTime: 38,
        price: 7,
        unlockCost: 125,
    },
    {
        id: 'paleale',
        name: 'Pale Ale',
        color: 0xc17f3a,
        foamColor: 0xfff0dd,
        description: 'Balanced & Malty',
        brewTime: 16,
        fermentTime: 40,
        price: 7,
        unlockCost: 130,
    },
    {
        id: 'porter',
        name: 'Porter',
        color: 0x2c1a0e,
        foamColor: 0xddd0b8,
        description: 'Rich & Roasty',
        brewTime: 20,
        fermentTime: 50,
        price: 9,
        unlockCost: 155,
    },
    {
        id: 'pilsner',
        name: 'Pilsner',
        color: 0xebd534,
        foamColor: 0xffffff,
        description: 'Clean & Refreshing',
        brewTime: 13,
        fermentTime: 32,
        price: 6,
        unlockCost: 110,
    },
    {
        id: 'amber',
        name: 'Amber Ale',
        color: 0xa0522d,
        foamColor: 0xffe8cc,
        description: 'Toasty & Caramel',
        brewTime: 17,
        fermentTime: 42,
        price: 8,
        unlockCost: 135,
    },
    {
        id: 'saison',
        name: 'Saison',
        color: 0xe0c050,
        foamColor: 0xfff8e0,
        description: 'Fruity & Spicy',
        brewTime: 19,
        fermentTime: 48,
        price: 9,
        unlockCost: 150,
    },
    {
        id: 'redale',
        name: 'Red Ale',
        color: 0x8b2500,
        foamColor: 0xffddc0,
        description: 'Malty & Smooth',
        brewTime: 17,
        fermentTime: 43,
        price: 8,
        unlockCost: 145,
    },
];

export class RecipeSystem {
    constructor() {
        this.recipes = RECIPES;
    }

    /**
     * Only beers the player has purchased can appear as cravings.
     * More unlocked styles → slightly more simultaneous cravings (capped).
     */
    generateDailyCravings(_dayNumber, unlockedRecipeIds) {
        const idSet = new Set(unlockedRecipeIds || []);
        const pool = this.recipes.filter((r) => idSet.has(r.id));
        if (pool.length === 0) {
            const fallback = this.getRecipeById(STARTER_UNLOCKED_RECIPE_IDS[0]) || this.recipes[0];
            return fallback ? [fallback] : [];
        }
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        const n = pool.length;
        const base = 1 + Math.floor(Math.random() * 2);
        const bonus = Math.min(3, Math.floor(n / 3));
        const count = Math.min(n, Math.max(1, base + bonus));
        return shuffled.slice(0, count);
    }

    getRecipeById(id) {
        return this.recipes.find(r => r.id === id);
    }

    getRecipeByIndex(index) {
        return this.recipes[index] || null;
    }
}
