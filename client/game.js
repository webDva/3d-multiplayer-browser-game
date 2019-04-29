class Game {
    constructor() {
        this.mapSize = 50;

        this.clientNetworkPulseRate = 1000 / 15;
        this.physicsTickRate = 1000 / 15;
        this.physicsLerpFactor = 100;
        this.graphicsLerpFactor = 100;

        this.keyboardMap = {};
        this.isTouchScreen = 'ontouchstart' in document.documentElement || (window.navigator.maxTouchPoints && window.navigator.maxTouchPoints >= 1);
    }

    // keyboard mapping and input
    keyboardHandler(e) {
        e = e || event; // Apparently some IE solution
        this.keyboardMap[e.keyCode] = e.type == 'keydown';
    }

    create_character(id, x, z, angle, type, maxHealth) {
        BABYLON.SceneLoader.ImportMeshAsync(null, './assets/', 'cutie.babylon', this.scene).then((imported) => {
            const mesh = imported.meshes[0];

            if (type === 0) { // if an NPC
                mesh.material.subMaterials[0].diffuseColor = BABYLON.Color3.Red();
                mesh.material.subMaterials[1].diffuseColor = BABYLON.Color3.Yellow();
            } else {
                mesh.material.subMaterials[0].diffuseColor = BABYLON.Color3.Blue();
            }

            // animation
            mesh.skeleton.animationPropertiesOverride = new BABYLON.AnimationPropertiesOverride();
            mesh.skeleton.animationPropertiesOverride.enableBlending = true;
            mesh.skeleton.animationPropertiesOverride.blendingSpeed = 0.2;
            mesh.skeleton.animationPropertiesOverride.loopMode = 1;
            mesh.idleRange = mesh.skeleton.getAnimationRange('Idle');
            mesh.idleRange.animation = this.scene.beginAnimation(mesh.skeleton, mesh.idleRange.from, mesh.idleRange.to, true, 1);

            mesh.KGAME_TYPE = 1; // KGAME_TYPE 1 means that it is a kawaii game mesh of type 1
            const character_struct = {
                id: id,
                x: x,
                z: z,
                mesh: mesh,
                eulerY: angle,
                health: 0,
                maxHealth: maxHealth,
                type: type,
                collisionBoxSize: 3
            };
            this.characters.push(character_struct);
            mesh.position.x = x;
            mesh.position.z = z;
            mesh.rotation.y = angle;

            // for walk animation
            mesh.previousX = x;
            mesh.previousZ = z;

            // health bar above character's head

            const healthBarContainerMaterial = new BABYLON.StandardMaterial('', this.scene);
            healthBarContainerMaterial.emissiveColor = BABYLON.Color3.Black();
            healthBarContainerMaterial.diffuseColor = BABYLON.Color3.Black();
            healthBarContainerMaterial.specularColor = BABYLON.Color3.Black();
            healthBarContainerMaterial.backFaceCulling = false;

            const healthBarChildMaterial = new BABYLON.StandardMaterial('', this.scene);
            healthBarChildMaterial.emissiveColor = BABYLON.Color3.Red();
            healthBarChildMaterial.diffuseColor = BABYLON.Color3.Black();
            healthBarChildMaterial.specularColor = BABYLON.Color3.Black();
            healthBarChildMaterial.backFaceCulling = false;

            const healthbarContainer = BABYLON.MeshBuilder.CreatePlane('', { width: 5.2, height: 1.2, subdivisions: 4 }, this.scene);
            const healthbarChild = BABYLON.MeshBuilder.CreatePlane('', { width: 5, height: 1, subdivisions: 4 }, this.scene);

            healthbarContainer.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

            healthbarChild.position.z = -0.01;
            healthbarContainer.position.y = 5;

            healthbarContainer.parent = mesh;
            healthbarChild.parent = healthbarContainer;

            healthbarChild.material = healthBarChildMaterial;
            healthbarContainer.material = healthBarContainerMaterial;

            mesh.healthbar = healthbarContainer;

            // if this is the player's character

            if (this.player.id === id) {
                this.player.mesh = mesh;
                this.player.struct = character_struct;
                this.camera.lockedTarget = this.player.mesh;
                this.inventoryCamera.target = this.player.mesh;

                healthBarChildMaterial.emissiveColor = BABYLON.Color3.Green();

                this.session_started = true;
            }
        });
    }

    start(classSelection) {
        // values that will be reset
        this.player = new Player();
        this.session_started = false;
        this.characters = [];
        this.mageAttackAProjectiles = [];

        this.canvas = document.getElementById("canvas");
        this.engine = new BABYLON.Engine(this.canvas, true, { stencil: true });

        // This is really important to tell Babylon.js to use decomposeLerp and matrix interpolation
        BABYLON.Animation.AllowMatricesInterpolation = true;

        this.scene = new BABYLON.Scene(this.engine);

        // comment out when not using
        //this.scene.debugLayer.show();

        this.scene.clearColor = new BABYLON.Color3(1, 1, 1);

        this.camera = new BABYLON.FollowCamera('camera', new BABYLON.Vector3(0, 0, 0), this.scene);
        //const camera = new BABYLON.UniversalCamera('camera', new BABYLON.Vector3(0, 0, 0), scene);
        //const camera = new BABYLON.ArcRotateCamera("Camera", 1, 1, 4, new BABYLON.Vector3(-10, 10, 20), scene);
        this.camera.attachControl(this.canvas);

        // inventory camera
        this.inventoryCamera = new BABYLON.ArcRotateCamera("InventoryCamera", 1, 1, 4, new BABYLON.Vector3(-10, 10, 20), this.scene);
        this.inventoryCamera.attachControl(this.canvas);

        // ground mesh
        const groundSize = this.mapSize;
        this.ground = BABYLON.Mesh.CreateGround("ground", groundSize, groundSize, 1, this.scene);
        this.ground.setPivotMatrix(BABYLON.Matrix.Translation(groundSize / 2, 0, groundSize / 2), false);
        this.ground.material = new BABYLON.GridMaterial('groundMaterial', this.scene);
        this.ground.material.mainColor = new BABYLON.Color3(0.12, 0.56, 1);
        this.ground.material.lineColor = new BABYLON.Color3(1, 1, 1);
        this.ground.material.gridRatio = 1;
        this.ground.material.majorUnitFrequency = 2;

        // light
        this.light = new BABYLON.PointLight('light', new BABYLON.Vector3(groundSize / 2, 100, groundSize / 2), this.scene);
        this.light.diffuse = new BABYLON.Color3(1, 1, 1);
        this.light.specular = new BABYLON.Color3(1, 1, 1);

        // aggro icon sprite manager
        this.aggroIconSpriteManager = new BABYLON.SpriteManager('aggroSpriteManager', './assets/aggro_icon.png', 100, { width: 64, height: 64 }, this.scene);

        // configure WebSocket client

        this.websocket = new WebSocket(((window.location.protocol === 'https:') ? 'wss://' : 'ws://') + window.location.host);
        this.websocket.binaryType = 'arraybuffer';

        this.websocket.onmessage = (event) => {
            if (typeof event.data === 'string') {
                const data = JSON.parse(event.data);
            }

            if (event.data instanceof ArrayBuffer) {
                const dataview = new DataView(event.data);

                // welcome message id sent to the player
                if (dataview.getUint8(0) === 3) {
                    this.player.id = dataview.getUint32(1);

                    // request map data
                    this.websocket.send(JSON.stringify({ type: 'request_map_data' }));
                }

                // character orientations update
                if (dataview.getUint8(0) === 1) {
                    for (let i = 0; i < dataview.getUint16(1); i++) {
                        const character = this.characters.find(character => character.id === dataview.getUint32(3 + i * 16));
                        if (character) {
                            character.x = dataview.getFloat32(7 + i * 16);
                            character.z = dataview.getFloat32(11 + i * 16);
                            character.eulerY = dataview.getFloat32(15 + i * 16);
                        }
                    }
                }

                // the player aggroed a mob
                if (dataview.getUint8(0) === 2) {
                    const mobID = dataview.getUint32(1);
                    const mob_character = this.characters.find(character => character.id === mobID);
                    if (mob_character) {
                        const aggroIcon = new BABYLON.Sprite('aggroIcon', this.aggroIconSpriteManager);
                        aggroIcon.position = new BABYLON.Vector3(mob_character.mesh.position.x, 7, mob_character.mesh.position.z);
                        setTimeout(() => {
                            aggroIcon.dispose();
                        }, 1000);
                    }
                }

                // a new character arrives on the server
                if (dataview.getUint8(0) === 4) {
                    this.create_character(dataview.getUint32(1), dataview.getFloat32(5), dataview.getFloat32(9), dataview.getFloat32(13), dataview.getInt8(17), dataview.getUint32(18));
                }

                // new mage attack A projectiles
                if (dataview.getUint8(0) === 5) {
                    this.mageAttackAProjectiles.push({
                        particleSystem: create_particles(dataview.getFloat32(1), dataview.getFloat32(5)),
                        forwardVector: dataview.getFloat32(9),
                        creationTime: Date.now(),
                        speed: dataview.getFloat32(13),
                        owner: dataview.getUint32(17),
                        collisionBoxSize: 1,
                        x: dataview.getFloat32(1),
                        z: dataview.getFloat32(5)
                    });
                }

                // a player disconnects
                if (dataview.getUint8(0) === 6) {
                    const character = this.characters.find(character => character.id === dataview.getUint32(1));
                    if (character) {
                        character.mesh.dispose();
                        this.characters.splice(this.characters.indexOf(character), 1);
                    }
                }

                // character healths update
                if (dataview.getUint8(0) === 9) {
                    for (let i = 0; i < dataview.getUint16(1); i++) {
                        const character = this.characters.find(character => character.id === dataview.getUint32(3 + i * 8));
                        if (character) {
                            character.health = dataview.getInt32(7 + i * 8);
                        }
                    }
                }

                // damage text
                if (dataview.getUint8(0) === 7) {
                    const damage = dataview.getUint32(2);

                    const planeSize = 2;
                    const dTSize = planeSize * 60;

                    const damageTextDynamicTexture = new BABYLON.DynamicTexture('', dTSize, this.scene);
                    damageTextDynamicTexture.hasAlpha = true;

                    const ctx = damageTextDynamicTexture.getContext();
                    const size = 12;
                    const fontType = 'arial';
                    ctx.font = size + 'px ' + fontType;
                    const textWidth = ctx.measureText(damage).width;
                    const ratio = textWidth / size;
                    const fontSize = Math.floor(dTSize / ratio);
                    const font = fontSize + 'px ' + fontType;

                    const damageTextMaterial = new BABYLON.StandardMaterial('', this.scene);
                    damageTextMaterial.diffuseTexture = damageTextDynamicTexture;
                    damageTextMaterial.backFaceCulling = false;
                    damageTextMaterial.diffuseColor = BABYLON.Color3.White();
                    damageTextMaterial.specularColor = BABYLON.Color3.Black();

                    const damageTextPlane = BABYLON.MeshBuilder.CreatePlane('', { width: planeSize, height: planeSize, subdivisions: 4 }, this.scene);
                    damageTextPlane.material = damageTextMaterial;
                    damageTextPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

                    const animationText = new BABYLON.Animation('', 'position.y', 10, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_RELATIVE);
                    animationText.setKeys([{ frame: 0, value: 6 }, { frame: 20, value: 12 }]);
                    damageTextPlane.animations = [animationText];
                    this.scene.beginAnimation(damageTextPlane, 0, 20, false, 1, () => {
                        damageTextDynamicTexture.dispose();
                        damageTextPlane.dispose();
                        damageTextMaterial.dispose();
                    });

                    if (dataview.getUint8(1) === 0) { // damage done by the player
                        damageTextDynamicTexture.drawText(damage, null, null, font, 'yellow', null);
                        // this.characters.find(character => character.id === targetId) can be undefined because it gets removed. it needs a check
                        const targetId = dataview.getUint32(6);
                        const position = this.characters.find(character => character.id === targetId).mesh.position;
                        damageTextPlane.position = new BABYLON.Vector3(position.x, position.y, position.z);
                    } else if (dataview.getUint8(1) === 1) { // damage done to the player
                        damageTextDynamicTexture.drawText(damage, null, null, font, 'red', null);
                        const position = this.player.mesh.position;
                        damageTextPlane.position = new BABYLON.Vector3(position.x, position.y, position.z);
                    }
                }

                // game over
                if (dataview.getUint8(0) === 8) {
                    document.getElementById('game-over').style.display = 'block';
                }

                // no player deaths for now

                // no player respawns either
            }
        }

        // open the WebSocket connection
        this.websocket.onopen = () => {
            this.websocket.send(JSON.stringify({ type: 'join', class: classSelection }));
        };

        // display DOM user interface

        if (this.isTouchScreen) {
            // virtual d-pad
            const virtualDPad = document.getElementById('virtualDPad');
            virtualDPad.style.display = 'block';
            document.getElementById('virtualDPad-image').style.display = 'block';

            virtualDPad.onpointerdown = virtualDPad.onpointermove = (event) => {
                const bounds = event.target.getBoundingClientRect();

                // vertices coordinates
                const upperLeft = { x: bounds.left, y: bounds.top };
                const lowerLeft = { x: bounds.left, y: bounds.top + bounds.height };
                const upperRight = { x: bounds.left + bounds.width, y: bounds.top };
                const lowerRight = { x: bounds.left + bounds.width, y: bounds.top + bounds.height };
                const middle = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };

                // triangle coordinates
                const leftTriangle = { v1: upperLeft, v2: lowerLeft, v3: middle };
                const upTriangle = { v1: upperLeft, v2: upperRight, v3: middle };
                const rightTriangle = { v1: upperRight, v2: lowerRight, v3: middle };
                const downTriangle = { v1: lowerLeft, v2: lowerRight, v3: middle };

                const touchPoint = { x: event.clientX, y: event.clientY };

                if (pointInTriangle(touchPoint, upTriangle.v1, upTriangle.v2, upTriangle.v3)) {
                    this.player.touchMovement = 1;
                } else if (pointInTriangle(touchPoint, leftTriangle.v1, leftTriangle.v2, leftTriangle.v3)) {
                    this.player.touchMovement = 2;
                } else if (pointInTriangle(touchPoint, downTriangle.v1, downTriangle.v2, downTriangle.v3)) {
                    this.player.touchMovement = 3;
                } else if (pointInTriangle(touchPoint, rightTriangle.v1, rightTriangle.v2, rightTriangle.v3)) {
                    this.player.touchMovement = 4;
                }
            };

            virtualDPad.onpointerup = virtualDPad.onpointerout = () => {
                this.player.touchMovement = 0;
            };

            // attack buttons

            document.getElementById('attack-buttons-container').style.display = 'block';

            const aButton = document.getElementById('a-button');

            aButton.onpointerdown = (event) => {
                this.keyboardMap['W'.charCodeAt()] = true;
            };

            aButton.onpointerup = (event) => {
                this.keyboardMap['W'.charCodeAt()] = false;
            };

            const bButton = document.getElementById('b-button');

            bButton.onpointerdown = (event) => {
                this.keyboardMap['E'.charCodeAt()] = true;
            };

            bButton.onpointerup = (event) => {
                this.keyboardMap['E'.charCodeAt()] = false;
            };
        }

        document.addEventListener('keydown', this.keyboardHandler.bind(this));
        document.addEventListener('keyup', this.keyboardHandler.bind(this));

        // for keyboard input that can't be inside the network pulse loop
        document.addEventListener('keydown', (event) => {
            const char = String.fromCharCode(event.keyCode);

            // "I" for inventory
            if (char === 'I') {
                if (this.scene.activeCamera === this.camera) {
                    this.scene.activeCamera = this.inventoryCamera;
                } else {
                    this.scene.activeCamera = this.camera;
                }
            }
        });

        this.engine.runRenderLoop(() => {
            this.scene.render();
        });

        window.addEventListener("resize", () => {
            this.engine.resize();
        });

        this.physicsUpdate();
        this.gameUpdate();
        this.pollUserInput();
    }

    gameUpdate() {
        // mostly for game logic and animation stuff
        this.scene.registerBeforeRender(() => {
            if (this.session_started) {
                this.camera.position.x = this.player.mesh.position.x;
                this.camera.position.y = this.player.mesh.position.y + 25;
                this.camera.position.z = this.player.mesh.position.z - 25;

                // remove expired mage attack A projectiles on the client side
                this.mageAttackAProjectiles.forEach(projectile => {
                    if (Date.now() - projectile.creationTime > 3000) {
                        projectile.particleSystem.stop();
                        this.mageAttackAProjectiles.splice(this.mageAttackAProjectiles.indexOf(projectile), 1);
                    }
                });

                // character health bars
                this.characters.forEach(character => {
                    const healthbar = character.mesh.healthbar.getChildren()[0];
                    healthbar.scaling.x = character.health / character.maxHealth;
                    healthbar.position.x = (1 - (character.health / character.maxHealth)) * -5 / 2;
                });

                // movement animations
                // self.characters.forEach(character => {
                //     if (character.mesh.previousX != character.mesh.position.x || character.mesh.previousZ != character.mesh.position.z) {
                //         if (!character.mesh.walkRange.isRunning) {
                //             character.mesh.walkRange.isRunning = true;
                //             character.mesh.idleRange.isRunning = false;
                //             character.mesh.idleRange.animation.stop();
                //             character.mesh.walkRange.animation = scene.beginAnimation(character.mesh.skeleton, character.mesh.walkRange.from, character.mesh.walkRange.to, true, 1);
                //         }
                //     } else {
                //         if (!character.mesh.idleRange.isRunning) {
                //             character.mesh.idleRange.isRunning = true;
                //             character.mesh.walkRange.isRunning = false;
                //             if (character.mesh.walkRange.animation)
                //                 character.mesh.walkRange.animation.stop();
                //             character.mesh.idleRange.animation = scene.beginAnimation(character.mesh.skeleton, character.mesh.idleRange.from, character.mesh.idleRange.to, true, 1);
                //         }
                //     }

                //     const deltaTime = engine.getDeltaTime();
                //     const lerpFactor = 40;
                //     if (deltaTime <= lerpFactor) {
                //         character.mesh.previousX = lerp(character.mesh.previousX, character.mesh.position.x, deltaTime / lerpFactor);
                //         character.mesh.previousZ = lerp(character.mesh.previousZ, character.mesh.position.z, deltaTime / lerpFactor);
                //     } else {
                //         character.mesh.previousX = character.mesh.position.x;
                //         character.mesh.previousZ = character.mesh.position.z;
                //     }
                // });
            }
        });
    }

    physicsUpdate() {
        // client-side physics tick
        let lastUpdateTime = Date.now();
        setInterval(() => {
            const deltaTime = Date.now() - lastUpdateTime;

            if (this.session_started) {
                // player orientations
                if (deltaTime <= this.physicsLerpFactor) { // lerp
                    this.characters.forEach(character => {
                        character.mesh.position.x = lerp(character.mesh.position.x, character.x, deltaTime / this.physicsLerpFactor);
                        character.mesh.position.z = lerp(character.mesh.position.z, character.z, deltaTime / this.physicsLerpFactor);

                        character.mesh.rotation.y = character.eulerY; // do not lerp the direction
                    });
                } else { // don't lerp
                    this.characters.forEach(character => {
                        character.mesh.position.x = character.x;
                        character.mesh.position.z = character.z;

                        character.mesh.rotation.y = character.eulerY;
                    });
                }

                // mage projectile attack A-player collisions
                this.mageAttackAProjectiles.forEach(projectile => {
                    this.characters.forEach(character => {
                        if (projectile.owner !== character.id && AABBCollision(projectile, character)) {
                            projectile.particleSystem.stop();
                            this.mageAttackAProjectiles.splice(this.mageAttackAProjectiles.indexOf(projectile), 1);
                        }
                    });
                });

                // mage projectile attack A and projectile particle systems movement
                this.mageAttackAProjectiles.forEach(projectile => {
                    projectile.x += Math.sin(projectile.forwardVector) * projectile.speed;
                    projectile.z += Math.cos(projectile.forwardVector) * projectile.speed;

                    projectile.particleSystem.emitter.x += Math.sin(projectile.forwardVector) * projectile.speed;
                    projectile.particleSystem.emitter.z += Math.cos(projectile.forwardVector) * projectile.speed;
                });
            }

            lastUpdateTime = Date.now();
        }, this.physicsTickRate);
    }

    pollUserInput() {
        // client network update pulse
        setInterval(() => {
            // player wants to attack
            if (this.keyboardMap['W'.charCodeAt()]) {
                const arraybuffer = new ArrayBuffer(2);
                const dataview = new DataView(arraybuffer);
                dataview.setUint8(0, 2);
                dataview.setUint8(1, 1);
                this.websocket.send(dataview);
            }

            // arrow keys movement
            if (this.keyboardMap[38] || this.player.touchMovement == 1) {
                this.player.movement = 1;
            } else if (this.keyboardMap[37] || this.player.touchMovement == 2) {
                this.player.movement = 2;
            } else if (this.keyboardMap[40] || this.player.touchMovement == 3) {
                this.player.movement = 3;
            } else if (this.keyboardMap[39] || this.player.touchMovement == 4) {
                this.player.movement = 4;
            } else {
                this.player.movement = 0;
            }

            // send player movement requests
            if (this.player.movement) {
                const arraybuffer = new ArrayBuffer(2);
                const dataview = new DataView(arraybuffer);
                dataview.setUint8(0, 3);
                dataview.setUint8(1, this.player.movement);
                this.websocket.send(dataview);
            }
        }, this.clientNetworkPulseRate);
    }
}

class Player {
    constructor() {
        this.id;
        this.mesh;
        this.struct;

        this.movement = 0;
        this.touchMovement = 0;
    }
}

// particle system handling subsystem
function create_particles(xPosition, zPosition) {
    const particleSystem = new BABYLON.ParticleSystem('', 500, this.scene);

    particleSystem.particleTexture = new BABYLON.Texture('/assets/particle_texture.png', this.scene);
    particleSystem.color1 = new BABYLON.Color4(1, 0, 0, 1);
    particleSystem.color2 = new BABYLON.Color4(1, 1, 1, 1);
    particleSystem.colorDead = new BABYLON.Color4(0, 0, 0, 0);
    particleSystem.minSize = 0.1;
    particleSystem.maxSize = 1.2;
    particleSystem.minLifeTime = 0.1;
    particleSystem.maxLifeTime = 0.7;
    particleSystem.emitRate = 400;
    particleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_MULTIPLYADD;
    particleSystem.gravity = new BABYLON.Vector3(0, 0, 0);
    particleSystem.minEmitPower = 1;
    particleSystem.maxEmitPower = 5;
    particleSystem.updateSpeed = 0.005;
    particleSystem.emitter = new BABYLON.Vector3(xPosition, 0, zPosition);
    particleSystem.createSphereEmitter(1);

    particleSystem.start();

    return particleSystem;
}

function areaTriangle(v1, v2, v3) {
    return Math.abs((v1.x * (v2.y - v3.y) + v2.x * (v3.y - v1.y) + v3.x * (v1.y - v2.y)) / 2);
}

function pointInTriangle(p, v1, v2, v3) {
    const areaOriginal = areaTriangle(v1, v2, v3);
    const area1 = areaTriangle(p, v1, v2);
    const area2 = areaTriangle(p, v2, v3);
    const area3 = areaTriangle(p, v1, v3);

    return area1 + area2 + area3 === areaOriginal;
}

function lerp(start, end, time) {
    return start * (1 - time) + end * time;
}

/**
 * Axis-aligned bounding boxes collision detection between two objects with an optional extension prediction.
 * @param {*} a The first object to check for. Must have `.x`, `.z`, and `.collisionBoxSize` members. Can have an extension for collision prediction with the parameter `a_extension`.
 * @param {*} b The second object to check for. Must have `.x`, `.z`, and `.collisionBoxSize` members.
 * @param {*} a_extension Used for predictions. Must have `.x` and `.z` members. If the axis has no extension, then it should be `0`.
 * @return `true` if collison has been detected, `false` otherwise.
 */
function AABBCollision(a, b, a_extension = { x: 0, z: 0 }) {
    return (a.x - (a.collisionBoxSize / 2) + a_extension.x <= b.x + (b.collisionBoxSize / 2) && a.x + (a.collisionBoxSize / 2) + a_extension.x >= b.x - (b.collisionBoxSize / 2)) &&
        (a.z - (a.collisionBoxSize / 2) + a_extension.z <= b.z + (b.collisionBoxSize / 2) && a.z + (a.collisionBoxSize / 2) + a_extension.z >= b.z - (b.collisionBoxSize / 2));
}