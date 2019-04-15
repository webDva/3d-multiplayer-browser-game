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
const groundSize = 100;
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

const player = {
    id: null,
    mesh: null,
    struct: null,

    movement: 0,

    combat: {
        attack: false
    }
};
const player_list = [];
let session_started = false;
const projectile_list = [];

function create_character(id, x, z, angle, type) {
    BABYLON.SceneLoader.ImportMeshAsync(null, './assets/', 'circle2.babylon', scene).then(function (imported) {
        const mesh = imported.meshes[0];
        mesh.material = new BABYLON.StandardMaterial('', scene);
        mesh.material.diffuseColor = BABYLON.Color3.Blue();

        if (type === 0) { // if an NPC
            mesh.material.diffuseColor = BABYLON.Color3.Red();
        }

        // add weapon and attach it
        BABYLON.SceneLoader.ImportMeshAsync(null, './assets/', 'staff.babylon', scene).then(function (meshes) {
            const weaponMesh = meshes.meshes[0];
            weaponMesh.attachToBone(mesh.skeleton.bones[mesh.skeleton.getBoneIndexByName('WeaponGrip')], mesh);
        });

        // animation
        mesh.skeleton.animationPropertiesOverride = new BABYLON.AnimationPropertiesOverride();
        mesh.skeleton.animationPropertiesOverride.enableBlending = true;
        mesh.skeleton.animationPropertiesOverride.blendingSpeed = 0.2;
        mesh.skeleton.animationPropertiesOverride.loopMode = 1;
        mesh.idleRange = mesh.skeleton.getAnimationRange('IdleAnimation');
        mesh.walkRange = mesh.skeleton.getAnimationRange('Walk');
        mesh.idleRange.animation = scene.beginAnimation(mesh.skeleton, mesh.idleRange.from, mesh.idleRange.to, true, 0.5);

        mesh.KGAME_TYPE = 1; // KGAME_TYPE 1 means that it is a kawaii game mesh of type 1
        const player_struct = {
            id: id,
            x: x,
            z: z,
            mesh: mesh,
            eulerY: angle,
            health: 0,
            type: type
        };
        player_list.push(player_struct);
        mesh.position.x = x;
        mesh.position.z = z;
        mesh.rotation.y = angle;

        // for walk animation
        mesh.previousX = x;
        mesh.previousZ = z;

        if (player.id === id) {
            player.mesh = mesh;
            player.struct = player_struct;
            camera.lockedTarget = player.mesh;
            inventoryCamera.target = player.mesh;

            session_started = true;
        }
    });
}

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
            player.id = dataview.getUint32(1);

            // request map data
            websocket.send(JSON.stringify({ type: 'request_map_data' }));
        }

        // player orientations
        if (dataview.getUint8(0) === 1) {
            for (let i = 0; i < dataview.getUint16(1); i++) {
                const player_object = player_list.find(player_object => player_object.id === dataview.getUint32(3 + i * 16));
                if (player_object) {
                    player_object.x = dataview.getFloat32(7 + i * 16);
                    player_object.z = dataview.getFloat32(11 + i * 16);
                    player_object.eulerY = dataview.getFloat32(15 + i * 16);
                }
            }
        }

        // player aggroed a mob
        if (dataview.getUint8(0) === 2) {
            const mobID = dataview.getUint32(1);
            const mobObject = player_list.find(player_object => player_object.id === mobID);
            const aggroIcon = new BABYLON.Sprite('aggroIcon', aggroIconSpriteManager);
            aggroIcon.position = new BABYLON.Vector3(mobObject.mesh.position.x, 5, mobObject.mesh.position.z);
            setTimeout(function () {
                aggroIcon.dispose();
            }, 1000);
        }

        // new player joins
        if (dataview.getUint8(0) === 4) {
            create_character(dataview.getUint32(1), dataview.getFloat32(5), dataview.getFloat32(9), dataview.getFloat32(13), dataview.getInt8(17));
        }

        // new projectiles
        if (dataview.getUint8(0) === 5) {
            for (let i = 0; i < dataview.getUint16(1); i++) {
                const projectile = {
                    particleSystem: create_particles(dataview.getFloat32(3 + i * 20), dataview.getFloat32(7 + i * 20)),
                    forwardVector: dataview.getFloat32(11 + i * 20),
                    creationTime: Date.now(),
                    speed: dataview.getFloat32(15 + i * 20),
                    owner: dataview.getUint32(19 + i * 20)
                };
                projectile_list.push(projectile);
            }
        }

        // player disconnect
        if (dataview.getUint8(0) === 6) {
            // player objects can be duplicated too,so this would actually need an array from Array.filter
            const player_object = player_list.find(player_object => player_object.id === dataview.getUint32(1));
            player_object.mesh.dispose();
            player_list.splice(player_list.indexOf(player_object), 1);
        }

        // player healths update
        if (dataview.getUint8(0) === 9) {
            for (let i = 0; i < dataview.getUint16(1); i++) {
                const player_object = player_list.find(player_object => player_object.id === dataview.getUint32(3 + i * 8));
                if (player_object) {
                    player_object.health = dataview.getInt32(7 + i * 8);
                }
            }
        }

        // no player deaths for now

        // no player respawns either
    }
}

// display DOM user interface


// open the WebSocket connection
websocket.onopen = () => {
    websocket.send(JSON.stringify({ type: 'join' }));
};

// movement controls
document.addEventListener('keydown', function (event) {
    const char = String.fromCharCode(event.keyCode);

    // arrow keys
    if (event.keyCode === 38) {
        player.movement = 1;
    }
    if (event.keyCode === 37) {
        player.movement = 2;
    }
    if (event.keyCode === 40) {
        player.movement = 3;
    }
    if (event.keyCode === 39) {
        player.movement = 4;
    }

    // combat attacks/spells
    if (char === '1') {
        player.combat.attack = true;
    }

    // "I" for inventory
    if (char === 'I') {
        if (scene.activeCamera === camera) {
            scene.activeCamera = inventoryCamera;
        } else {
            scene.activeCamera = camera;
        }
    }
});

// client network update pulse
setInterval(() => {
    // player wants to attack
    if (player.combat.attack) {
        const arraybuffer = new ArrayBuffer(1);
        const dataview = new DataView(arraybuffer);
        dataview.setUint8(0, 2);
        websocket.send(dataview);
        player.combat.attack = false;
    }

    // send player movement requests
    if (player.movement) {
        const arraybuffer = new ArrayBuffer(2);
        const dataview = new DataView(arraybuffer);
        dataview.setUint8(0, 3);
        dataview.setUint8(1, player.movement);
        websocket.send(dataview);
        player.movement = 0;
    }
}, 1000 / 20);

function lerp(start, end, time) {
    return start * (1 - time) + end * time;
}

// client-side physics tick
let lastUpdateTime = Date.now();
setInterval(() => {
    const deltaTime = Date.now() - lastUpdateTime;
    const lerpTime = 60;

    if (session_started) {
        // player orientations
        if (deltaTime <= lerpTime) { // lerp
            player_list.forEach(player_object => {
                player_object.mesh.position.x = lerp(player_object.mesh.position.x, player_object.x, deltaTime / lerpTime);
                player_object.mesh.position.z = lerp(player_object.mesh.position.z, player_object.z, deltaTime / lerpTime);

                player_object.mesh.rotation.y = player_object.eulerY; // do not lerp the direction
            });
        } else { // don't lerp
            player_list.forEach(player_object => {
                player_object.mesh.position.x = player_object.x;
                player_object.mesh.position.z = player_object.z;

                player_object.mesh.rotation.y = player_object.eulerY;
            });
        }

        // projectile particle systems movement
        projectile_list.forEach(projectile => {
            projectile.particleSystem.emitter.x += Math.sin(projectile.forwardVector) * projectile.speed;
            projectile.particleSystem.emitter.z += Math.cos(projectile.forwardVector) * projectile.speed;
        });
    }

    lastUpdateTime = Date.now();
}, 1000 / 30);

// mostly for game logic and animation stuff
scene.registerBeforeRender(function () {
    if (session_started) {
        camera.position.x = player.mesh.position.x;
        camera.position.y = player.mesh.position.y + 25;
        camera.position.z = player.mesh.position.z - 25;

        // remove expired projectiles on the client side
        projectile_list.forEach(projectile => {
            if (Date.now() - projectile.creationTime > 10000) {
                projectile.particleSystem.stop();
                projectile_list.splice(projectile_list.indexOf(projectile), 1);
            }
        });

        // movement animations
        player_list.forEach(player_object => {
            if (player_object.mesh.previousX != player_object.mesh.position.x || player_object.mesh.previousZ != player_object.mesh.position.z) {
                if (!player_object.mesh.walkRange.isRunning) {
                    player_object.mesh.walkRange.isRunning = true;
                    player_object.mesh.idleRange.isRunning = false;
                    player_object.mesh.idleRange.animation.stop();
                    player_object.mesh.walkRange.animation = scene.beginAnimation(player_object.mesh.skeleton, player_object.mesh.walkRange.from, player_object.mesh.walkRange.to, true, 1);
                }
            } else {
                if (!player_object.mesh.idleRange.isRunning) {
                    player_object.mesh.idleRange.isRunning = true;
                    player_object.mesh.walkRange.isRunning = false;
                    if (player_object.mesh.walkRange.animation)
                        player_object.mesh.walkRange.animation.stop();
                    player_object.mesh.idleRange.animation = scene.beginAnimation(player_object.mesh.skeleton, player_object.mesh.idleRange.from, player_object.mesh.idleRange.to, true, 1);
                }
            }

            const deltaTime = engine.getDeltaTime();
            const lerpFactor = 40;
            if (deltaTime <= lerpFactor) {
                player_object.mesh.previousX = lerp(player_object.mesh.previousX, player_object.mesh.position.x, deltaTime / lerpFactor);
                player_object.mesh.previousZ = lerp(player_object.mesh.previousZ, player_object.mesh.position.z, deltaTime / lerpFactor);
            } else {
                player_object.mesh.previousX = player_object.mesh.position.x;
                player_object.mesh.previousZ = player_object.mesh.position.z;
            }
        });
    }
});

engine.runRenderLoop(function () {
    scene.render();
});

window.addEventListener("resize", function () {
    engine.resize();
});