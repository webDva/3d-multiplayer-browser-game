class Game {
    constructor() {
        this.player = new Player();
        this.session_started = false;
        this.characters = [];
        this.projectiles = [];

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

    create_character(id, x, z, angle, type, maxHealth, classNumber, string) {
        BABYLON.SceneLoader.ImportMeshAsync(null, './assets/', 'cutie.babylon', this.scene).then((imported) => {
            const mesh = imported.meshes[0];

            addOutline(mesh);

            mesh.material.subMaterials[0] = new BABYLON.StandardMaterial('', this.scene);;
            mesh.material.subMaterials[1] = new BABYLON.StandardMaterial('', this.scene);;

            if (type === 0) { // if an NPC
                mesh.material.subMaterials[0].diffuseColor = BABYLON.Color3.Red();
                mesh.material.subMaterials[1].diffuseColor = BABYLON.Color3.Yellow();
            } else {
                mesh.material.subMaterials[0].diffuseColor = BABYLON.Color3.Blue();
                mesh.material.subMaterials[1].diffuseColor = BABYLON.Color3.Green();
            }

            if (classNumber === 1) {
                BABYLON.SceneLoader.ImportMeshAsync(null, './assets/', 'staff.babylon', this.scene).then((imported) => {
                    const staffMesh = imported.meshes[0];
                    addOutline(staffMesh);
                    staffMesh.position.x = 2;
                    staffMesh.position.y = 1;
                    staffMesh.parent = mesh;
                    mesh.classWeapon = staffMesh;
                });
            } else if (classNumber === 2) {
                BABYLON.SceneLoader.ImportMeshAsync(null, './assets/', 'hammer.babylon', this.scene).then((imported) => {
                    const hammerMesh = imported.meshes[0];
                    addOutline(hammerMesh);
                    hammerMesh.position.z = -2;
                    hammerMesh.position.y = 1;
                    hammerMesh.rotation.z = Math.PI * (1 / 4);
                    hammerMesh.parent = mesh;
                    mesh.classWeapon = hammerMesh;
                });
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

            // name
            if (string) {
                const nameText = new OnscreenText(string, 0, 1.2, 0, 20, 'Arial', 'white', 1.5, this.scene);
                nameText.textPlane.parent = healthbarContainer;
            }

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
        this.canvas = document.getElementById("canvas");
        this.engine = new BABYLON.Engine(this.canvas, true, { stencil: true });

        // This is really important to tell Babylon.js to use decomposeLerp and matrix interpolation
        BABYLON.Animation.AllowMatricesInterpolation = true;

        this.scene = new BABYLON.Scene(this.engine);

        // comment out when not using
        //this.scene.debugLayer.show();

        this.scene.clearColor = new BABYLON.Color3(0.5, 0.5, 0.5);

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
        this.ground.material.lineColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        this.ground.material.gridRatio = 1;
        this.ground.material.majorUnitFrequency = 2;

        // point light
        // this.light = new BABYLON.PointLight('light', new BABYLON.Vector3(groundSize / 2, 100, groundSize / 2), this.scene);
        // this.light.diffuse = new BABYLON.Color3(1, 1, 1);
        // this.light.specular = new BABYLON.Color3(1, 1, 1);

        // hemispeheric light
        this.light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(groundSize / 2, 100, groundSize / 2), this.scene);
        this.light.diffuse = new BABYLON.Color3(1, 1, 1);
        this.light.specular = new BABYLON.Color3(0.5, 0.5, 0.5);
        this.light.groundColor = new BABYLON.Color3(0.5, 0.5, 0.5);

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
                    this.player.maxXP = dataview.getFloat32(5);
                    this.experienceBar.max = this.player.maxXP;

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
                    let string = null;
                    if (dataview.getInt8(17) === 1) {
                        const ab = new Uint8Array(dataview.getUint8(23));
                        for (let i = 0; i < dataview.getUint8(23); i++) {
                            ab[i] = dataview.getUint8(24 + i);
                        }
                        string = String.fromCharCode.apply(null, ab);
                    }
                    this.create_character(dataview.getUint32(1), dataview.getFloat32(5), dataview.getFloat32(9), dataview.getFloat32(13), dataview.getInt8(17), dataview.getUint32(18), dataview.getUint8(22), string);
                }

                // mage attack A
                if (dataview.getUint8(0) === 5 && dataview.getUint8(1) === 11) {
                    const projectile = {
                        particleSystem: create_particles(dataview.getFloat32(2), dataview.getFloat32(6), 1),
                        forwardVector: dataview.getFloat32(10),
                        creationTime: Date.now(),
                        speed: dataview.getFloat32(14),
                        owner: dataview.getUint32(18),
                        collisionBoxSize: 1,
                        x: dataview.getFloat32(2),
                        z: dataview.getFloat32(6),
                        type: null
                    };
                    this.projectiles.push(projectile);
                }

                // warrior attack A
                if (dataview.getUint8(0) === 5 && dataview.getUint8(1) === 21) {
                    const character = this.characters.find(character => character.id === dataview.getUint32(2));
                    if (character) {
                        const warriorAttackAParticleSystem = new BABYLON.ParticleSystem('', 2000, this.scene);
                        warriorAttackAParticleSystem.particleTexture = new BABYLON.Texture('/assets/particle_texture.png', this.scene);
                        warriorAttackAParticleSystem.emitter = new BABYLON.Vector3(character.mesh.position.x, 0, character.mesh.position.z);
                        warriorAttackAParticleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_MULTIPLYADD;
                        warriorAttackAParticleSystem.color1 = new BABYLON.Color4(0.7, 0.8, 0.1, 1.0);
                        warriorAttackAParticleSystem.color2 = new BABYLON.Color4(0.9, 0.5, 0.3, 1.0);
                        warriorAttackAParticleSystem.colorDead = new BABYLON.Color4(1, 0, 0.2, 0.5);
                        warriorAttackAParticleSystem.minSize = 0.1;
                        warriorAttackAParticleSystem.maxSize = 1.4;
                        warriorAttackAParticleSystem.minLifeTime = 0.3;
                        warriorAttackAParticleSystem.maxLifeTime = 1.2;
                        warriorAttackAParticleSystem.emitRate = 1000;
                        warriorAttackAParticleSystem.minEmitPower = 12;
                        warriorAttackAParticleSystem.maxEmitPower = 15;
                        warriorAttackAParticleSystem.gravity = new BABYLON.Vector3(0, -50, 0);
                        warriorAttackAParticleSystem.updateSpeed = 0.05;
                        warriorAttackAParticleSystem.createConeEmitter(10, Math.PI * (1 / 2));
                        warriorAttackAParticleSystem.start();
                        warriorAttackAParticleSystem.targetStopDuration = 1;
                    }
                }

                // archer attack A
                if (dataview.getUint8(0) === 5 && dataview.getUint8(1) === 31) {
                    const projectile = {
                        particleSystem: create_particles(dataview.getFloat32(2), dataview.getFloat32(6), 2),
                        forwardVector: dataview.getFloat32(10),
                        creationTime: Date.now(),
                        speed: dataview.getFloat32(14),
                        owner: dataview.getUint32(18),
                        collisionBoxSize: 2,
                        x: dataview.getFloat32(2),
                        z: dataview.getFloat32(6),
                        type: null
                    };
                    this.projectiles.push(projectile);
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

                    let damageText;

                    if (dataview.getUint8(1) === 0) { // damage done by the player
                        // this.characters.find(character => character.id === targetId) can be undefined because it gets removed. it needs a check
                        const targetId = dataview.getUint32(6);
                        const position = this.characters.find(character => character.id === targetId).mesh.position;
                        damageText = new OnscreenText(damage, position.x, position.y, position.z, 20, 'Arial', 'yellow', 1.5, this.scene);
                    } else if (dataview.getUint8(1) === 1) { // damage done to the player
                        const position = this.player.mesh.position;
                        damageText = new OnscreenText(damage, position.x, position.y, position.z, 20, 'Arial', 'red', 1.5, this.scene);
                    }

                    const animationText = new BABYLON.Animation('', 'position.y', 10, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_RELATIVE);
                    animationText.setKeys([{ frame: 0, value: 6 }, { frame: 20, value: 12 }]);
                    damageText.textPlane.animations = [animationText];
                    this.scene.beginAnimation(damageText.textPlane, 0, 20, false, 1, () => {
                        damageText.dispose();
                    });
                }

                // game over
                if (dataview.getUint8(0) === 8) {
                    document.getElementById('game-over').style.display = 'block';
                    this.domUIContainer.style.display = 'none';
                }

                // mob attacks
                if (dataview.getUint8(0) === 10) {
                    const mob = this.characters.find(character => character.id === dataview.getUint32(1));
                    if (mob) {
                        const mobAttackAnimationJump = new BABYLON.Animation('', 'position.y', 25, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_RELATIVE);
                        mobAttackAnimationJump.setKeys([{ frame: 0, value: 0 }, { frame: 10, value: 3 }, { frame: 20, value: 0 }]);
                        mobAttackAnimationJump.setEasingFunction(new BABYLON.CubicEase());
                        this.scene.beginDirectAnimation(mob.mesh, [mobAttackAnimationJump], 0, 20, false, 1);
                    }
                }

                // XP gain
                if (dataview.getUint8(0) === 11 && dataview.getUint8(5) === 0) {
                    const xpGain = dataview.getFloat32(1);
                    this.player.xp += xpGain;
                    this.experienceBar.value = this.player.xp;

                    const position = this.player.mesh.position;
                    const xpText = new OnscreenText(`${xpGain} XP`, position.x, position.y, position.z, 20, 'Arial', 'blue', 1.5, this.scene);
                    const xpAnimationText = new BABYLON.Animation('', 'position.y', 10, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_RELATIVE);
                    xpAnimationText.setKeys([{ frame: 0, value: 6 }, { frame: 20, value: 12 }]);
                    xpText.textPlane.animations = [xpAnimationText];
                    this.scene.beginAnimation(xpText.textPlane, 0, 20, false, 1, () => {
                        xpText.dispose();
                    });
                }

                // level up
                if (dataview.getUint8(0) === 11 && dataview.getUint8(5) !== 0) {
                    const xpGain = dataview.getFloat32(1);
                    const newLevel = dataview.getUint8(5);
                    const leftOverXP = dataview.getFloat32(6);
                    const newMaxXP = dataview.getFloat32(10);

                    this.player.level = newLevel;
                    this.player.xp = leftOverXP;
                    this.player.maxXP = newMaxXP;

                    this.experienceBar.max = this.player.maxXP;
                    this.experienceBar.value = this.player.xp;
                    this.experienceBarLevel.innerText = this.player.level;

                    const position = this.player.mesh.position;
                    const levelUpText = new OnscreenText('LEVEL UP! 🍰', position.x + 5, position.y, position.z, 20, 'monospace', 'yellow', 1.5, this.scene);
                    const levelUpTextAnimation = new BABYLON.Animation('', 'position.y', 10, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_RELATIVE);
                    levelUpTextAnimation.setKeys([{ frame: 0, value: 6 }, { frame: 20, value: 12 }]);
                    levelUpText.textPlane.animations = [levelUpTextAnimation];
                    this.scene.beginAnimation(levelUpText.textPlane, 0, 20, false, 1, () => {
                        levelUpText.dispose();
                    });

                    const xpText = new OnscreenText(`${xpGain} XP`, position.x, position.y, position.z, 20, 'Arial', 'blue', 1.5, this.scene);
                    const xpAnimationText = new BABYLON.Animation('', 'position.y', 10, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_RELATIVE);
                    xpAnimationText.setKeys([{ frame: 0, value: 6 }, { frame: 20, value: 12 }]);
                    xpText.textPlane.animations = [xpAnimationText];
                    this.scene.beginAnimation(xpText.textPlane, 0, 20, false, 1, () => {
                        xpText.dispose();
                    });
                }
            }
        }

        // open the WebSocket connection
        this.websocket.onopen = () => {
            this.websocket.send(JSON.stringify({ type: 'join', class: classSelection }));
        };

        // display DOM user interface

        this.domUIContainer = document.getElementById('dom-ui-container');
        this.domUIContainer.style.display = 'block';

        // experience bar and level
        this.experienceBar = document.getElementById('experience-bar');
        this.experienceBar.value = 0;
        this.experienceBarLevel = document.getElementById('level-number');
        this.experienceBarLevel.innerText = 1;

        // touch screen
        this.touchScreenContainer = document.getElementById('touch-screen-container');

        if (this.isTouchScreen) {
            this.touchScreenContainer.style.display = 'block';

            // virtual d-pad
            const virtualDPad = document.getElementById('virtualDPad');

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

                // remove expired projectiles on the client side
                this.projectiles.forEach(projectile => {
                    if (Date.now() - projectile.creationTime > 3000) {
                        projectile.particleSystem.stop();
                        this.projectiles.splice(this.projectiles.indexOf(projectile), 1);
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

                // projectile-player collisions
                this.projectiles.forEach(projectile => {
                    this.characters.forEach(character => {
                        if (projectile.owner !== character.id && util.AABBCollision(projectile, character)) {
                            projectile.particleSystem.stop();
                            this.projectiles.splice(this.projectiles.indexOf(projectile), 1);
                        }
                    });
                });

                // projectile and projectile particle systems movement
                this.projectiles.forEach(projectile => {
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
                this.websocket.send(util.createBinaryFrame(2, [{ type: 'Uint8', value: 1 }]));
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
                this.websocket.send(util.createBinaryFrame(3, [{ type: 'Uint8', value: this.player.movement }]));
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

        this.level = 1;
        this.maxXP;
        this.xp = 0;
    }
}

// particle system handling subsystem
function create_particles(xPosition, zPosition, attackType) {
    const particleSystem = new BABYLON.ParticleSystem('', 500, this.scene);

    particleSystem.particleTexture = new BABYLON.Texture('/assets/particle_texture.png', this.scene);

    switch (attackType) {
        case 1: // mage attack A
            particleSystem.color1 = new BABYLON.Color4(1, 0, 0, 1);
            particleSystem.color2 = new BABYLON.Color4(1, 1, 1, 1);
            particleSystem.colorDead = new BABYLON.Color4(0, 0, 0, 0);
            break;
        case 2: // archer attack A
            particleSystem.color1 = new BABYLON.Color4(0, 1, 0, 1);
            particleSystem.color2 = new BABYLON.Color4(1, 1, 1, 1);
            particleSystem.colorDead = new BABYLON.Color4(0, 0.5, 0.5, 1);
            break;
    }

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

class OnscreenText {
    constructor(text, x, y, z, fontSize, fontType, color, planeHeight, babylonScene) {
        const font = fontSize + 'px ' + fontType;
        const DTHeight = 1.5 * fontSize;
        const ratio = planeHeight / DTHeight;

        //Use a temporay dynamic texture to calculate the length of the text on the dynamic texture canvas
        const tempDynamicTexture = new BABYLON.DynamicTexture("DynamicTexture", 64, this.scene);
        const tmpctx = tempDynamicTexture.getContext();
        tmpctx.font = font;
        const DTWidth = tmpctx.measureText(text).width + 8;
        tempDynamicTexture.dispose();

        const planeWidth = DTWidth * ratio;

        this.textDynamicTexture = new BABYLON.DynamicTexture('', { width: DTWidth, height: DTHeight }, this.scene);
        this.textDynamicTexture.hasAlpha = true;

        this.textMaterial = new BABYLON.StandardMaterial('', this.scene);
        this.textMaterial.diffuseTexture = this.textDynamicTexture;
        this.textMaterial.backFaceCulling = false;
        this.textMaterial.emissiveColor = BABYLON.Color3.White();
        this.textMaterial.diffuseColor = BABYLON.Color3.Black();
        this.textMaterial.specularColor = BABYLON.Color3.Black();

        this.textPlane = BABYLON.MeshBuilder.CreatePlane('', { width: planeWidth, height: planeHeight, subdivisions: 4 }, babylonScene);
        this.textPlane.material = this.textMaterial;
        this.textPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        this.textPlane.position = new BABYLON.Vector3(x, y, z);

        this.textDynamicTexture.drawText(text, null, null, font, color, null);
    }

    dispose() {
        this.textDynamicTexture.dispose();
        this.textPlane.dispose();
        this.textMaterial.dispose();
    }
}

function addOutline(mesh) {
    mesh.renderOutline = true;
    mesh.outlineColor = new BABYLON.Color3(0, 0, 0);
    mesh.outlineWidth = 0.08;
}