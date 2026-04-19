/**
 * True if the player can stash wort somewhere: any empty unlocked bio-tank,
 * or (for lager wort only) the standalone lager tank when empty.
 */
export function hasUnlockedEmptyFermenter(fermenters, lagerTank, wortRecipe) {
    if (fermenters.some((f) => f && f.unlocked && f.state === 'empty')) return true;
    if (wortRecipe?.id === 'lager' && lagerTank && lagerTank.state === 'empty') return true;
    return false;
}
