class Game {
    constructor() {
        this.player = new Player();

        this.session_started = false;

        this.characters = [];
        this.projectiles = [];

        this.mapSize = 50;

        this.clientNetworkPulseRate = 1000 / 20;
        this.physicsTickRate = 1000 / 30;
        this.lerpFactor = 60;

        this.keyboardMap = {};
        this.isTouchScreen = 'ontouchstart' in document.documentElement || (window.navigator.maxTouchPoints && window.navigator.maxTouchPoints >= 1);
    }

    create_character(id, x, z, angle, type) {
        const self = this;
        BABYLON.SceneLoader.ImportMeshAsync(null, './assets/', 'cutie.babylon', scene).then(function (imported) {
            const mesh = imported.meshes[0];
            mesh.material = new BABYLON.StandardMaterial('', scene);
            mesh.material.diffuseColor = BABYLON.Color3.Blue();
            // eye color
            imported.meshes[1].material.diffuseColor = BABYLON.Color3.Green();

            if (type === 0) { // if an NPC
                mesh.material.diffuseColor = BABYLON.Color3.Red();
            }

            // animation
            mesh.skeleton.animationPropertiesOverride = new BABYLON.AnimationPropertiesOverride();
            mesh.skeleton.animationPropertiesOverride.enableBlending = true;
            mesh.skeleton.animationPropertiesOverride.blendingSpeed = 0.2;
            mesh.skeleton.animationPropertiesOverride.loopMode = 1;
            mesh.idleRange = mesh.skeleton.getAnimationRange('Idle');
            mesh.idleRange.animation = scene.beginAnimation(mesh.skeleton, mesh.idleRange.from, mesh.idleRange.to, true, 1);

            mesh.KGAME_TYPE = 1; // KGAME_TYPE 1 means that it is a kawaii game mesh of type 1
            const character_struct = {
                id: id,
                x: x,
                z: z,
                mesh: mesh,
                eulerY: angle,
                health: 0,
                type: type
            };
            self.characters.push(character_struct);
            mesh.position.x = x;
            mesh.position.z = z;
            mesh.rotation.y = angle;

            // for walk animation
            mesh.previousX = x;
            mesh.previousZ = z;

            // health bar above character's head

            const healthBarContainerMaterial = new BABYLON.StandardMaterial('', scene);
            healthBarContainerMaterial.emissiveColor = BABYLON.Color3.Black();
            healthBarContainerMaterial.diffuseColor = BABYLON.Color3.Black();
            healthBarContainerMaterial.specularColor = BABYLON.Color3.Black();
            healthBarContainerMaterial.backFaceCulling = false;

            const healthBarChildMaterial = new BABYLON.StandardMaterial('', scene);
            healthBarChildMaterial.emissiveColor = BABYLON.Color3.Red();
            healthBarChildMaterial.diffuseColor = BABYLON.Color3.Black();
            healthBarChildMaterial.specularColor = BABYLON.Color3.Black();
            healthBarChildMaterial.backFaceCulling = false;

            const healthbarContainer = BABYLON.MeshBuilder.CreatePlane('', { width: 5, height: 1, subdivisions: 4 }, scene);
            const healthbarChild = BABYLON.MeshBuilder.CreatePlane('', { width: 5, height: 1, subdivisions: 4 }, scene);

            healthbarContainer.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

            healthbarChild.renderingGroupId = 1;
            healthbarContainer.renderingGroupId = 1;

            healthbarChild.position.z = -0.01;
            healthbarContainer.position.y = 5;

            healthbarContainer.parent = mesh;
            healthbarChild.parent = healthbarContainer;

            healthbarChild.material = healthBarChildMaterial;
            healthbarContainer.material = healthBarContainerMaterial;

            mesh.healthbar = healthbarContainer;

            // if this is the player's character

            if (self.player.id === id) {
                self.player.mesh = mesh;
                self.player.struct = character_struct;
                camera.lockedTarget = self.player.mesh;
                inventoryCamera.target = self.player.mesh;

                healthBarChildMaterial.emissiveColor = BABYLON.Color3.Green();

                self.session_started = true;
            }
        });
    }

    // keyboard mapping and input
    keyboardHandler(e) {
        e = e || event; // Apparently some IE solution
        this.keyboardMap[e.keyCode] = e.type == 'keydown';
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

const game = new Game();

const canvas = document.getElementById("canvas");
const engine = new BABYLON.Engine(canvas, true, { stencil: true });

// This is really important to tell Babylon.js to use decomposeLerp and matrix interpolation
BABYLON.Animation.AllowMatricesInterpolation = true;

const scene = new BABYLON.Scene(engine);

// comment out when not using
//scene.debugLayer.show();

scene.clearColor = new BABYLON.Color3(1, 1, 1);

const camera = new BABYLON.FollowCamera('camera', new BABYLON.Vector3(0, 0, 0), scene);
//const camera = new BABYLON.UniversalCamera('camera', new BABYLON.Vector3(0, 0, 0), scene);
//const camera = new BABYLON.ArcRotateCamera("Camera", 1, 1, 4, new BABYLON.Vector3(-10, 10, 20), scene);
camera.attachControl(canvas);

// inventory camera
const inventoryCamera = new BABYLON.ArcRotateCamera("InventoryCamera", 1, 1, 4, new BABYLON.Vector3(-10, 10, 20), scene);
inventoryCamera.attachControl(canvas);

// ground mesh
const groundSize = game.mapSize;
const ground = BABYLON.Mesh.CreateGround("ground", groundSize, groundSize, 1, scene);
ground.setPivotMatrix(BABYLON.Matrix.Translation(groundSize / 2, 0, groundSize / 2), false);
ground.material = new BABYLON.GridMaterial('groundMaterial', scene);
ground.material.mainColor = new BABYLON.Color3(0.75, 0.75, 0.75);
ground.material.lineColor = new BABYLON.Color3(0.5, 0.5, 0.5);
ground.material.gridRatio = 1;
ground.material.majorUnitFrequency = 2;

// light
const light = new BABYLON.PointLight('light', new BABYLON.Vector3(groundSize / 2, 100, groundSize / 2), scene);
light.diffuse = new BABYLON.Color3(1, 1, 1);
light.specular = new BABYLON.Color3(1, 1, 1);

// particle system handling subsystem
function create_particles(xPosition, zPosition) {
    const particleSystem = new BABYLON.ParticleSystem('', 500, scene);

    particleSystem.particleTexture = new BABYLON.Texture('/assets/particle_texture.png', scene);
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

// aggro icon sprite manager
const aggroIconSpriteManager = new BABYLON.SpriteManager('aggroSpriteManager', './assets/aggro_icon.png', 100, { width: 64, height: 64 }, scene);

// configure WebSocket client

const websocket = new WebSocket(((window.location.protocol === 'https:') ? 'wss://' : 'ws://') + window.location.host);
websocket.binaryType = 'arraybuffer';

websocket.onmessage = (event) => {
    if (typeof event.data === 'string') {
        const data = JSON.parse(event.data);
    }

    if (event.data instanceof ArrayBuffer) {
        const dataview = new DataView(event.data);

        // welcome message id sent to the player
        if (dataview.getUint8(0) === 3) {
            game.player.id = dataview.getUint32(1);

            // request map data
            websocket.send(JSON.stringify({ type: 'request_map_data' }));
        }

        // character orientations update
        if (dataview.getUint8(0) === 1) {
            for (let i = 0; i < dataview.getUint16(1); i++) {
                const character = game.characters.find(character => character.id === dataview.getUint32(3 + i * 16));
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
            const mob_character = game.characters.find(character => character.id === mobID);
            const aggroIcon = new BABYLON.Sprite('aggroIcon', aggroIconSpriteManager);
            aggroIcon.position = new BABYLON.Vector3(mob_character.mesh.position.x, 7, mob_character.mesh.position.z);
            setTimeout(function () {
                aggroIcon.dispose();
            }, 1000);
        }

        // a new character arrives on the server
        if (dataview.getUint8(0) === 4) {
            game.create_character(dataview.getUint32(1), dataview.getFloat32(5), dataview.getFloat32(9), dataview.getFloat32(13), dataview.getInt8(17));
        }

        // new projectiles
        if (dataview.getUint8(0) === 5) {
            game.projectiles.push({
                particleSystem: create_particles(dataview.getFloat32(1), dataview.getFloat32(5)),
                forwardVector: dataview.getFloat32(9),
                creationTime: Date.now(),
                speed: dataview.getFloat32(13),
                owner: dataview.getUint32(17)
            });
        }

        // a player disconnects
        if (dataview.getUint8(0) === 6) {
            // player objects can be duplicated too,so this would actually need an array from Array.filter
            const character = game.characters.find(character => character.id === dataview.getUint32(1));
            character.mesh.dispose();
            game.characters.splice(game.characters.indexOf(character), 1);
        }

        // character healths update
        if (dataview.getUint8(0) === 9) {
            for (let i = 0; i < dataview.getUint16(1); i++) {
                const character = game.characters.find(character => character.id === dataview.getUint32(3 + i * 8));
                if (character) {
                    character.health = dataview.getInt32(7 + i * 8);
                }
            }
        }

        // no player deaths for now

        // no player respawns either
    }
}

// display DOM user interface

if (game.isTouchScreen) {
    displayOnscreenControls();
}

function displayOnscreenControls() {
    // virtual d-pad
    const virtualDPad = document.getElementById('virtualDPad');
    virtualDPad.style.display = 'block';
    document.getElementById('virtualDPad-image').style.display = 'block';

    virtualDPad.onpointerdown = virtualDPad.onpointermove = function (event) {
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
            game.player.touchMovement = 1;
        } else if (pointInTriangle(touchPoint, leftTriangle.v1, leftTriangle.v2, leftTriangle.v3)) {
            game.player.touchMovement = 2;
        } else if (pointInTriangle(touchPoint, downTriangle.v1, downTriangle.v2, downTriangle.v3)) {
            game.player.touchMovement = 3;
        } else if (pointInTriangle(touchPoint, rightTriangle.v1, rightTriangle.v2, rightTriangle.v3)) {
            game.player.touchMovement = 4;
        }
    };

    virtualDPad.onpointerup = virtualDPad.onpointerout = function () {
        game.player.touchMovement = 0;
    };

    // ability button
    const abilityButton = document.getElementById('ability-button');
    abilityButton.style.display = 'block';
    document.getElementById('ability-button-image').style.display = 'block';

    abilityButton.onpointerdown = function (event) {
        game.keyboardMap['W'.charCodeAt()] = true;
    };

    abilityButton.onpointerup = function (event) {
        game.keyboardMap['W'.charCodeAt()] = false;
    };
}

function areaTriangle(v1, v2, v3) {
    return Math.abs((v1.x * (v2.y - v3.y) + v2.x * (v3.y - v1.y) + v3.x * (v1.y - v2.y)) / 2);
}

function pointInTriangle(p, v1, v2, v3) {
    const areaOriginal = areaTriangle(v1, v2, v3);
    const area1 = areaTriangle(p, v1, v2);
    const area2 = areaTriangle(p, v2, v3);
    const area3 = areaTriangle(p, v1, v3);

    if (area1 + area2 + area3 === areaOriginal) {
        return true;
    } else {
        return false;
    }
}

document.addEventListener('keydown', game.keyboardHandler.bind(game));
document.addEventListener('keyup', game.keyboardHandler.bind(game));

// for keyboard input that can't be inside the network pulse loop
document.addEventListener('keydown', function (event) {
    const char = String.fromCharCode(event.keyCode);

    // "I" for inventory
    if (char === 'I') {
        if (scene.activeCamera === camera) {
            scene.activeCamera = inventoryCamera;
        } else {
            scene.activeCamera = camera;
        }
    }
});

// open the WebSocket connection
websocket.onopen = () => {
    websocket.send(JSON.stringify({ type: 'join' }));
};

// client network update pulse
setInterval(() => {
    // player wants to attack
    if (game.keyboardMap['W'.charCodeAt()]) {
        const arraybuffer = new ArrayBuffer(1);
        const dataview = new DataView(arraybuffer);
        dataview.setUint8(0, 2);
        websocket.send(dataview);
    }

    // arrow keys movement
    if (game.keyboardMap[38] || game.player.touchMovement == 1) {
        game.player.movement = 1;
    } else if (game.keyboardMap[37] || game.player.touchMovement == 2) {
        game.player.movement = 2;
    } else if (game.keyboardMap[40] || game.player.touchMovement == 3) {
        game.player.movement = 3;
    } else if (game.keyboardMap[39] || game.player.touchMovement == 4) {
        game.player.movement = 4;
    } else {
        game.player.movement = 0;
    }

    // send player movement requests
    if (game.player.movement) {
        const arraybuffer = new ArrayBuffer(2);
        const dataview = new DataView(arraybuffer);
        dataview.setUint8(0, 3);
        dataview.setUint8(1, game.player.movement);
        websocket.send(dataview);
    }
}, game.clientNetworkPulseRate);

function lerp(start, end, time) {
    return start * (1 - time) + end * time;
}

// client-side physics tick
let lastUpdateTime = Date.now();
setInterval(() => {
    const deltaTime = Date.now() - lastUpdateTime;

    if (game.session_started) {
        // player orientations
        if (deltaTime <= game.lerpFactor) { // lerp
            game.characters.forEach(character => {
                character.mesh.position.x = lerp(character.mesh.position.x, character.x, deltaTime / game.lerpFactor);
                character.mesh.position.z = lerp(character.mesh.position.z, character.z, deltaTime / game.lerpFactor);

                character.mesh.rotation.y = character.eulerY; // do not lerp the direction
            });
        } else { // don't lerp
            game.characters.forEach(character => {
                character.mesh.position.x = character.x;
                character.mesh.position.z = character.z;

                character.mesh.rotation.y = character.eulerY;
            });
        }

        // projectile particle systems movement
        game.projectiles.forEach(projectile => {
            projectile.particleSystem.emitter.x += Math.sin(projectile.forwardVector) * projectile.speed;
            projectile.particleSystem.emitter.z += Math.cos(projectile.forwardVector) * projectile.speed;
        });
    }

    lastUpdateTime = Date.now();
}, game.physicsTickRate);

// mostly for game logic and animation stuff
scene.registerBeforeRender(function () {
    if (game.session_started) {
        camera.position.x = game.player.mesh.position.x;
        camera.position.y = game.player.mesh.position.y + 25;
        camera.position.z = game.player.mesh.position.z - 25;

        // remove expired projectiles on the client side
        game.projectiles.forEach(projectile => {
            if (Date.now() - projectile.creationTime > 10000) {
                projectile.particleSystem.stop();
                game.projectiles.splice(game.projectiles.indexOf(projectile), 1);
            }
        });

        // character health bars
        game.characters.forEach(character => {
            const healthbar = character.mesh.healthbar.getChildren()[0];
            healthbar.scaling.x = character.health / 100;
            healthbar.position.x = (1 - (character.health / 100)) * -5 / 2;
        });

        // movement animations
        // game.characters.forEach(character => {
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

engine.runRenderLoop(function () {
    scene.render();
});

window.addEventListener("resize", function () {
    engine.resize();
});