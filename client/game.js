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
camera.attachControl(canvas, false);

// ground mesh
const groundSize = 100;
const ground = BABYLON.Mesh.CreateGround("ground", groundSize, groundSize, 1, scene);
ground.setPivotMatrix(BABYLON.Matrix.Translation(groundSize / 2, 0, groundSize / 2), false);
ground.position.y = -1;
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
    const mesh = BABYLON.MeshBuilder.CreateCylinder('', { diameterTop: 0, tessellation: 32 }, scene);
    mesh.rotation.x = Math.PI * (1 / 2);
    mesh.material = new BABYLON.StandardMaterial('', scene);
    mesh.material.diffuseColor = BABYLON.Color3.Blue();

    if (type === 0) { // if an NPC
        mesh.material.diffuseColor = BABYLON.Color3.Red();
    }

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

    if (player.id === id) {
        player.mesh = mesh;
        player.struct = player_struct;
        camera.lockedTarget = player.mesh;
        //camera.target = player.mesh;

        session_started = true;
    }
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

        // new player joins
        if (dataview.getUint8(0) === 4) {
            create_character(dataview.getUint32(1), dataview.getFloat32(5), dataview.getFloat32(9), dataview.getFloat32(13), dataview.getInt8(17));
        }

        // new projectiles
        if (dataview.getUint8(0) === 5) {
            const projectile = {
                particleSystem: create_particles(dataview.getFloat32(1), dataview.getFloat32(5)),
                forwardVector: dataview.getFloat32(9),
                creationTime: Date.now(),
                speed: dataview.getFloat32(13),
                owner: dataview.getUint32(17)
            };
            projectile_list.push(projectile);
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
    if (char === 'W') {
        player.movement = 1;
    }
    if (char === 'A') {
        player.movement = 2;
    }
    if (char === 'S') {
        player.movement = 3;
    }
    if (char === 'D') {
        player.movement = 4;
    }
});

document.onpointerdown = function () {
    const pickResult = scene.pick(scene.pointerX, scene.pointerY);
    if (pickResult.hit) {
        player.combat.attack = true;
    }
};

document.onpointerup = function () {
    player.combat.attack = false;
};

// client network update pulse
setInterval(() => {
    // player wants to attack
    if (player.combat.attack) {
        const arraybuffer = new ArrayBuffer(1);
        const dataview = new DataView(arraybuffer);
        dataview.setUint8(0, 2);
        websocket.send(dataview);
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
            projectile.particleSystem.emitter.x += Math.cos(projectile.forwardVector) * projectile.speed;
            projectile.particleSystem.emitter.z += Math.sin(projectile.forwardVector) * projectile.speed;
        });
    }

    lastUpdateTime = Date.now();
}, 1000 / 30);

// mostly for game logic and animation stuff
scene.registerBeforeRender(function () {
    if (session_started) {
        camera.position.x = player.mesh.position.x - 25;
        camera.position.y = player.mesh.position.y + 25;
        camera.position.z = player.mesh.position.z;

        // remove expired projectiles on the client side
        projectile_list.forEach(projectile => {
            if (Date.now() - projectile.creationTime > 10000) {
                projectile.particleSystem.stop();
                projectile_list.splice(projectile_list.indexOf(projectile), 1);
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