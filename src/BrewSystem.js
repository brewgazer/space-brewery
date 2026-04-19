import * as THREE from 'three';
import { RECIPES } from './RecipeSystem.js';
import { hasUnlockedEmptyFermenter } from './FermentUtil.js';

export class BrewSystem {
    constructor(scene, brewStations, fermenters, lagerTank, gameState, audioSystem, recipeManager) {
        this.scene = scene;
        this.stations = brewStations;
        this.fermenters = fermenters;
        /** @type {object | null} */
        this.lagerTank = lagerTank;
        this.gameState = gameState;
        this.audio = audioSystem;
        this.recipeManager = recipeManager;
        this.selectingRecipe = null;
        this.time = 0;
        this._cA = new THREE.Color();
        this._cB = new THREE.Color();
    }

    interact(stationIndex, player, animPlayer) {
        const station = this.stations[stationIndex];
        if (!station || !station.unlocked) return;

        if (station.state === 'empty') {
            if (player.carrying?.type === 'milledBatch') {
                if (station.milledIngredients) {
                    this.audio.playError();
                    return;
                }
                station.milledIngredients = [...player.carrying.ingredients];
                player.carrying = null;
                this.audio.playPickup();
                animPlayer?.playBrewerGesture?.('grabMix');
                this.selectingRecipe = stationIndex;
                return;
            }

            if (
                player.carrying?.type === 'bucket' &&
                player.carrying.milled &&
                Array.isArray(player.carrying.ingredientIds) &&
                player.carrying.ingredientIds.length === 3 &&
                player.carrying.ingredientIds.every(Boolean)
            ) {
                if (station.milledIngredients) {
                    this.audio.playError();
                    return;
                }
                station.milledIngredients = [...player.carrying.ingredientIds];
                player.carrying = { type: 'bucket', ingredientIds: [null, null, null] };
                this.audio.playPickup();
                animPlayer?.playBrewerGesture?.('grabMix');
                this.selectingRecipe = stationIndex;
                return;
            }

            if (!player.carrying && station.milledIngredients?.length === 3) {
                this.selectingRecipe = stationIndex;
                return;
            }

            if (player.carrying) {
                this.audio.playError();
            }
            return;
        }

        if (station.state === 'done' && !player.carrying) {
            if (!hasUnlockedEmptyFermenter(this.fermenters, this.lagerTank, station.recipe)) {
                this.audio.playError();
                if (typeof this.onWortBlockedNoFermenter === 'function') {
                    this.onWortBlockedNoFermenter();
                }
                return;
            }
            const valid = station.batchValid !== false;
            player.carrying = { type: 'wort', recipe: station.recipe, batchValid: valid };
            station.state = 'empty';
            station.recipe = null;
            station.progress = 0;
            station.milledIngredients = null;
            station.batchValid = true;
            station.liquid.visible = false;
            station.progressFill.visible = false;
            station.progressFill.scale.x = 0;
            this.audio.playPickup();
            animPlayer?.playBrewerGesture?.('grabWort');
            return;
        }

        if (station.state === 'brewing') {
            this.audio.playError();
        }
    }

    selectRecipe(listIndex) {
        if (this.selectingRecipe === null) return;
        const unlocked = RECIPES.filter((r) => this.gameState.unlockedRecipeIds?.includes(r.id));
        const recipe = unlocked[listIndex];
        if (!recipe) {
            this.selectingRecipe = null;
            return;
        }

        const station = this.stations[this.selectingRecipe];
        const ing = station.milledIngredients;
        if (!ing || ing.length !== 3) {
            this.selectingRecipe = null;
            return;
        }

        const match = this.recipeManager.validateBatchForRecipe(ing, recipe);
        station.batchValid = match;
        station.milledIngredients = null;

        station.state = 'brewing';
        station.recipe = recipe;
        station.progress = 0;
        station.duration = recipe.brewTime * (0.9 + Math.random() * 0.2);
        station.liquid.visible = true;
        station.liquid.material.color.setHex(match ? recipe.color : 0x4a3a28);
        station.progressFill.visible = true;

        this.audio.playBrewStart();
        this.selectingRecipe = null;
    }

    cancelSelection() {
        this.selectingRecipe = null;
    }

    update(delta) {
        this.time += delta;

        this.stations.forEach((station) => {
            if (!station.unlocked) return;
            if (station.state === 'brewing') {
                station.progress += delta / station.duration;

                if (station.progress >= 1) {
                    station.progress = 1;
                    station.state = 'done';
                    station.progressFill.material.color.setHex(
                        station.batchValid === false ? 0xaa6644 : 0x44dd44
                    );
                    station.progressFill.material.emissive.setHex(
                        station.batchValid === false ? 0x442211 : 0x115511
                    );
                    if (station.batchValid === false) {
                        station.liquid.material.color.setHex(0x3d2818);
                    }
                    this.audio.playBrewComplete();
                }

                station.progressFill.scale.x = Math.max(0.001, station.progress);
                const barWidth = 2;
                station.progressFill.position.x = -(barWidth * (1 - station.progress)) / 2;

                this._cA.set(station.batchValid === false ? 0x886644 : 0x44aa44);
                this._cB.set(0xaaaa22);
                station.progressFill.material.color.copy(
                    this._cA.lerp(this._cB, station.progress)
                );

                if (station.liquid.visible) {
                    station.liquid.position.y = 1.5 + Math.sin(this.time * 3) * 0.03;
                    station.kettle.rotation.y = Math.sin(this.time * 2) * 0.02;
                }
            }

            if (station.state === 'done') {
                const pulse = 0.5 + Math.sin(this.time * 4) * 0.5;
                if (station.batchValid === false) {
                    station.progressFill.material.emissive.setRGB(
                        0.25 + pulse * 0.15,
                        0.12,
                        0.08
                    );
                } else {
                    station.progressFill.material.emissive.setRGB(
                        0.1 + pulse * 0.2,
                        0.4 + pulse * 0.2,
                        0.1
                    );
                }
            }
        });
    }
}
