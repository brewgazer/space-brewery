import { INGREDIENTS } from './Ingredient.js';

/** Testing / easy mode: keep full recipes on sidebar and cravings panel. */
export const SHOW_RECIPES_ALWAYS = false;

/** Seconds the day-start chalkboard shows full recipes (ignored if SHOW_RECIPES_ALWAYS). */
export const CHALKBOARD_RECIPE_SECONDS = 16;

/**
 * Required ingredient ids per beer recipe (order-independent at brew time).
 * Every playable beer style should have exactly three ingredients.
 */
export const RECIPE_INGREDIENTS = {
    ipa: ['paleMalt', 'hopsA', 'hopsB'],
    stout: ['roastedBarley', 'crystalMalt', 'hopsB'],
    wheat: ['wheat', 'paleMalt', 'hopsA'],
    lager: ['paleMalt', 'hopsB', 'honeyMalt'],
    paleale: ['paleMalt', 'crystalMalt', 'hopsA'],
    porter: ['roastedBarley', 'crystalMalt', 'hopsA'],
    pilsner: ['paleMalt', 'hopsA', 'honeyMalt'],
    amber: ['crystalMalt', 'paleMalt', 'hopsB'],
    saison: ['wheat', 'hopsB', 'honeyMalt'],
    redale: ['crystalMalt', 'roastedBarley', 'hopsA'],
};

/** Sorted tuple for multiset compare */
function sortedKey(arr) {
    return [...arr].sort().join('\0');
}

export function batchMatchesRecipe(ingredientIds, recipeId) {
    const need = RECIPE_INGREDIENTS[recipeId];
    if (!need || need.length !== 3) return false;
    return sortedKey(ingredientIds) === sortedKey(need);
}

export function getRecipeIngredientList(recipeId) {
    const ids = RECIPE_INGREDIENTS[recipeId];
    if (!ids) return [];
    return ids.map((id) => {
        const d = INGREDIENTS.find((x) => x.id === id);
        return d ? d.name : id;
    });
}

export class RecipeManager {
    constructor() {
        this.showRecipesAlways = SHOW_RECIPES_ALWAYS;
        this.chalkboardSeconds = CHALKBOARD_RECIPE_SECONDS;
    }

    validateBatchForRecipe(ingredientIds, recipe) {
        if (!recipe || !ingredientIds || ingredientIds.length !== 3) return false;
        return batchMatchesRecipe(ingredientIds, recipe.id);
    }

    formatCravingsWithRecipes(cravings) {
        if (!cravings?.length) return '';
        const blocks = cravings.map((r) => {
            const lines = getRecipeIngredientList(r.id)
                .map((n) => `- ${n}`)
                .join('<br>');
            return `<div style="margin-bottom:10px;text-align:left;"><span style="color:#ffd700;">${r.name}</span><br>${lines}</div>`;
        });
        return blocks.join('');
    }

    formatCravingsSidebar(cravings, revealIngredients) {
        if (!cravings?.length) return '';
        if (!revealIngredients) {
            return cravings
                .map((r) => `<span style="color:#ffd700;">${r.name}</span>`)
                .join('<br>');
        }
        return cravings
            .map((r) => {
                const ing = getRecipeIngredientList(r.id).join(', ');
                return `<span style="color:#ffd700;">${r.name}</span><br><span style="color:#9aa;font-size:11px;">${ing}</span>`;
            })
            .join('<br><br>');
    }
}
