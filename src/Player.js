import * as THREE from 'three';

export class Player {
    constructor(camera, scene, colliders) {
        this.camera = camera;
        this.scene = scene;
        this.colliders = colliders;

        this.height = 1.6;
        this.radius = 0.35;
        this.speed = 5.0;

        this.camera.position.set(0, this.height, 0);
        this.camera.rotation.order = 'YXZ';

        this.velocity = new THREE.Vector3();
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');

        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;

        this.isLocked = false;
        this.sensitivity = 0.002;

        this._direction = new THREE.Vector3();
        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._newPos = new THREE.Vector3();
        this._up = new THREE.Vector3(0, 1, 0);

        this._setupPointerLock();
        this._setupKeyboard();
    }

    _setupPointerLock() {
        document.addEventListener('pointerlockchange', () => {
            this.isLocked = !!document.pointerLockElement;
            if (window.gameState) {
                window.gameState.paused = !this.isLocked && window.gameState.started;
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isLocked) return;
            this.euler.setFromQuaternion(this.camera.quaternion);
            this.euler.y -= e.movementX * this.sensitivity;
            this.euler.x -= e.movementY * this.sensitivity;
            this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
            this.camera.quaternion.setFromEuler(this.euler);
        });
    }

    _setupKeyboard() {
        document.addEventListener('keydown', (e) => {
            switch (e.code) {
                case 'KeyW': this.moveForward = true; break;
                case 'KeyS': this.moveBackward = true; break;
                case 'KeyA': this.moveLeft = true; break;
                case 'KeyD': this.moveRight = true; break;
            }
        });
        document.addEventListener('keyup', (e) => {
            switch (e.code) {
                case 'KeyW': this.moveForward = false; break;
                case 'KeyS': this.moveBackward = false; break;
                case 'KeyA': this.moveLeft = false; break;
                case 'KeyD': this.moveRight = false; break;
            }
        });
    }

    lock() {
        document.body.requestPointerLock();
    }

    update(delta) {
        if (!this.isLocked) return;

        const direction = this._direction;
        const forward = this._forward;
        const right = this._right;

        this.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        right.crossVectors(forward, this._up).normalize();

        direction.set(0, 0, 0);
        if (this.moveForward) direction.add(forward);
        if (this.moveBackward) direction.sub(forward);
        if (this.moveLeft) direction.sub(right);
        if (this.moveRight) direction.add(right);

        if (direction.lengthSq() > 0) direction.normalize();

        const moveX = direction.x * this.speed * delta;
        const moveZ = direction.z * this.speed * delta;

        const newPos = this._newPos;
        newPos.copy(this.camera.position);
        newPos.x += moveX;
        newPos.z += moveZ;
        newPos.y = this.height;

        if (!this._checkCollision(newPos)) {
            this.camera.position.copy(newPos);
        } else {
            newPos.copy(this.camera.position);
            newPos.x += moveX;
            newPos.y = this.height;
            if (!this._checkCollision(newPos)) {
                this.camera.position.x = newPos.x;
            }
            newPos.copy(this.camera.position);
            newPos.z += moveZ;
            newPos.y = this.height;
            if (!this._checkCollision(newPos)) {
                this.camera.position.z = newPos.z;
            }
        }
    }

    _checkCollision(pos) {
        for (const col of this.colliders) {
            const box = col.box;
            const closest = new THREE.Vector3(
                Math.max(box.min.x, Math.min(pos.x, box.max.x)),
                pos.y,
                Math.max(box.min.z, Math.min(pos.z, box.max.z))
            );
            const dist = new THREE.Vector2(pos.x - closest.x, pos.z - closest.z).length();
            if (dist < this.radius) return true;
        }
        return false;
    }
}
