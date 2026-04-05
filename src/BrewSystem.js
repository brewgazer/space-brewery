import * as THREE from 'three';
import { RECIPES } from './RecipeSystem.js';

export class BrewSystem {
    constructor(scene, brewStations, gameState, audioSystem) {
        this.scene = scene;
        this.stations = brewStations;
        this.gameState = gameState;
        this.audio = audioSystem;
        this.selectingRecipe = null; // index of station awaiting recipe selection
        this.time = 0;
        this._cA = new THREE.Color();
        this._cB = new THREE.Color();
    }

    interact(stationIndex, player) {
        const station = this.stations[stationIndex];
        if (!station || !station.unlocked) return;

        if (station.state === 'empty' && !player.carrying) {
            this.selectingRecipe = stationIndex;
            return;
        }

        if (station.state === 'done' && !player.carrying) {
            player.carrying = { type: 'wort', recipe: station.recipe };
            station.state = 'empty';
            station.recipe = null;
            station.progress = 0;
            station.liquid.visible = false;
            station.progressFill.visible = false;
            station.progressFill.scale.x = 0;
            this.audio.playPickup();
            return;
        }

        if (station.state === 'brewing') {
            this.audio.playError();
        }
    }

    selectRecipe(recipeIndex) {
        if (this.selectingRecipe === null) return;
        const recipe = RECIPES[recipeIndex];
        if (!recipe) {
            this.selectingRecipe = null;
            return;
        }

        const station = this.stations[this.selectingRecipe];
        station.state = 'brewing';
        station.recipe = recipe;
        station.progress = 0;
        // Slight randomness: ±10% brew time
        station.duration = recipe.brewTime * (0.9 + Math.random() * 0.2);
        station.liquid.visible = true;
        station.liquid.material.color.setHex(recipe.color);
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
                    station.progressFill.material.color.setHex(0x44dd44);
                    station.progressFill.material.emissive.setHex(0x115511);
                    this.audio.playBrewComplete();
                }

                // Update progress bar
                station.progressFill.scale.x = Math.max(0.001, station.progress);
                const barWidth = 2;
                station.progressFill.position.x = -(barWidth * (1 - station.progress)) / 2;

                this._cA.set(0x44aa44);
                this._cB.set(0xaaaa22);
                station.progressFill.material.color.copy(
                    this._cA.lerp(this._cB, station.progress)
                );

                // Bubbling animation for liquid
                if (station.liquid.visible) {
                    station.liquid.position.y = 1.5 + Math.sin(this.time * 3) * 0.03;
                    station.kettle.rotation.y = Math.sin(this.time * 2) * 0.02;
                }
            }

            if (station.state === 'done') {
                // Pulsing glow effect
                const pulse = 0.5 + Math.sin(this.time * 4) * 0.5;
                station.progressFill.material.emissive.setRGB(
                    0.1 + pulse * 0.2,
                    0.4 + pulse * 0.2,
                    0.1
                );
            }
        });
    }
}
