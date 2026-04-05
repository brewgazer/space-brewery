export const RECIPES = [
    {
        id: 'ipa',
        name: 'IPA',
        color: 0xd4a017,
        foamColor: 0xfff8e7,
        description: 'Hoppy & Bitter',
        brewTime: 18,
        fermentTime: 45,
        price: 8
    },
    {
        id: 'stout',
        name: 'Stout',
        color: 0x1a0f0a,
        foamColor: 0xd4c5a9,
        description: 'Dark & Heavy',
        brewTime: 22,
        fermentTime: 55,
        price: 10
    },
    {
        id: 'lager',
        name: 'Lager',
        color: 0xf5d442,
        foamColor: 0xffffff,
        description: 'Light & Crisp',
        brewTime: 14,
        fermentTime: 35,
        price: 6
    },
    {
        id: 'wheat',
        name: 'Wheat Beer',
        color: 0xe8c547,
        foamColor: 0xfff5d4,
        description: 'Cloudy & Smooth',
        brewTime: 15,
        fermentTime: 38,
        price: 7
    },
    {
        id: 'paleale',
        name: 'Pale Ale',
        color: 0xc17f3a,
        foamColor: 0xfff0dd,
        description: 'Balanced & Malty',
        brewTime: 16,
        fermentTime: 40,
        price: 7
    },
    {
        id: 'porter',
        name: 'Porter',
        color: 0x2c1a0e,
        foamColor: 0xddd0b8,
        description: 'Rich & Roasty',
        brewTime: 20,
        fermentTime: 50,
        price: 9
    },
    {
        id: 'pilsner',
        name: 'Pilsner',
        color: 0xebd534,
        foamColor: 0xffffff,
        description: 'Clean & Refreshing',
        brewTime: 13,
        fermentTime: 32,
        price: 6
    },
    {
        id: 'amber',
        name: 'Amber Ale',
        color: 0xa0522d,
        foamColor: 0xffe8cc,
        description: 'Toasty & Caramel',
        brewTime: 17,
        fermentTime: 42,
        price: 8
    },
    {
        id: 'saison',
        name: 'Saison',
        color: 0xe0c050,
        foamColor: 0xfff8e0,
        description: 'Fruity & Spicy',
        brewTime: 19,
        fermentTime: 48,
        price: 9
    },
    {
        id: 'redale',
        name: 'Red Ale',
        color: 0x8b2500,
        foamColor: 0xffddc0,
        description: 'Malty & Smooth',
        brewTime: 17,
        fermentTime: 43,
        price: 8
    }
];

export class RecipeSystem {
    constructor() {
        this.recipes = RECIPES;
    }

    generateDailyCravings(dayNumber = 1) {
        const shuffled = [...this.recipes].sort(() => Math.random() - 0.5);
        // Day 1-2: 2 cravings, Day 3-4: 3, Day 5+: 3-4
        let count;
        if (dayNumber <= 2) count = 2;
        else if (dayNumber <= 4) count = 3;
        else count = 3 + (Math.random() < 0.5 ? 1 : 0);
        return shuffled.slice(0, count);
    }

    getRecipeById(id) {
        return this.recipes.find(r => r.id === id);
    }

    getRecipeByIndex(index) {
        return this.recipes[index] || null;
    }
}
