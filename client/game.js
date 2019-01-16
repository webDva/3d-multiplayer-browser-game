const canvas = document.getElementById("canvas");
const engine = new BABYLON.Engine(canvas, true);

// This is really important to tell Babylon.js to use decomposeLerp and matrix interpolation
BABYLON.Animation.AllowMatricesInterpolation = true;

const scene = new BABYLON.Scene(engine);
//scene.debugLayer.show();
scene.clearColor = new BABYLON.Color3(1, 1, 1);

const camera = new BABYLON.ArcRotateCamera("Camera", 1, 1, 4, new BABYLON.Vector3(-10, 10, 20), scene);
camera.attachControl(canvas, false);
scene.collisionsEnabled = true;
camera.checkCollisions = true;

const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, -100, 0), scene);
light.diffuse = new BABYLON.Color3(1, 1, 1);
light.specular = new BABYLON.Color3(0, 0, 0);
light.groundColor = new BABYLON.Color3(0, 0, 0);

scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
scene.fogStart = 50;
scene.fogEnd = 100;
scene.fogColor = new BABYLON.Color3(0.9, 0.8, 0.9);

const pipeline = new BABYLON.DefaultRenderingPipeline("default", true, scene, [scene.activeCamera]);

pipeline.samples = 4;
pipeline.fxaaEnabled = true;

pipeline.bloomEnabled = true;
pipeline.bloomThreshold = 0.8;
pipeline.bloomWeight = 0.1;
pipeline.bloomKernel = 64;
pipeline.bloomScale = 0.5;

// Ground
const ground = BABYLON.Mesh.CreateGround("ground", 1000, 1000, 1, scene);
ground.material = new BABYLON.GridMaterial('groundMaterial', scene);
ground.material.mainColor = new BABYLON.Color3(1, 1, 1);
ground.material.lineColor = new BABYLON.Color3(0, 0, 0);
ground.material.gridRatio = 1;
ground.material.majorUnitFrequency = 0;
ground.checkCollisions = true;

// dummy mesh
const dummy = BABYLON.MeshBuilder.CreateBox("box", {}, scene);
dummy.position.y = 1;
dummy.material = new BABYLON.StandardMaterial("standardmaterial", scene);

const player = {
    id: null,
    mesh: null,

    left: false,
    up: false,
    right: false,
    down: false,

    combat: {
        isShooting: false,
        direction: 0
    }
};
let player_list = [];
let projectile_list = [];
let session_started = false;

// configure WebSocket client

const websocket = new WebSocket(((window.location.protocol === 'https:') ? 'wss://' : 'ws://') + window.location.host);
websocket.binaryType = 'arraybuffer';

websocket.onmessage = (event) => {
    if (typeof event.data === 'string') {
        const data = JSON.parse(event.data);

        if (data.type === 'welcome') {
            player.id = data.id;
            data.player_list.forEach(player => {
                const mesh = BABYLON.MeshBuilder.CreateBox("box", {}, scene);
                mesh.position.y = 1;
                mesh.material = new BABYLON.StandardMaterial("standardmaterial", scene);
                mesh.material.emissiveColor = new BABYLON.Color4(1, 0, 0, 1);
                player_list.push({ id: player.id, x: player.x, y: player.y, mesh: mesh });
                mesh.position.z = player.x;
                mesh.position.x = player.y;
            });

            const player_object = player_list.find(player_object => player_object.id === player.id);
            player.mesh = player_object.mesh;
            player.mesh.material.emissiveColor = new BABYLON.Color4(0, 1, 0, 1);
            camera.target = player.mesh;

            session_started = true;
        }

        if (data.type === 'new_player' && session_started) {
            const mesh = BABYLON.MeshBuilder.CreateBox("box", {}, scene);
            mesh.position.y = 1;
            mesh.material = new BABYLON.StandardMaterial("standardmaterial", scene);
            mesh.material.emissiveColor = new BABYLON.Color4(1, 0, 0, 1);
            player_list.push({ id: data.id, x: data.x, y: data.y, mesh: mesh });
        }

        if (data.type === 'player_disconnect') {
            const player_object = player_list.find(player_object => player_object.id === data.id);
            player_object.mesh.dispose();
            player_list.splice(player_list.indexOf(player_object), 1);
        }

    }

    if (event.data instanceof ArrayBuffer && session_started) {
        const dataview = new DataView(event.data);

        if (dataview.getUint8(0) === 1) { // player positions
            for (let i = 0; i < dataview.getUint8(1); i++) {
                const player_object = player_list.find(player_object => player_object.id === dataview.getUint32(2 + i * 12));
                player_object.x = dataview.getFloat32(6 + i * 12);
                player_object.y = dataview.getFloat32(10 + i * 12);
            }
        }

        if (dataview.getUint8(0) === 2) { // newly created projectile update
            const projectile = {
                mesh: BABYLON.MeshBuilder.CreateSphere("sphere", {}, scene),
                direction: dataview.getFloat32(9),
                movement_speed: dataview.getUint32(13),
                owner: dataview.getUint32(17),
                creation_time: Date.now()
            };

            projectile.mesh.position.y = 1;
            projectile.mesh.position.z = dataview.getFloat32(1);
            projectile.mesh.position.x = dataview.getFloat32(5);
            projectile_list.push(projectile);
        }

        // no player deaths for now

        // no player respawns either
    }
}

// open the WebSocket connection
websocket.onopen = () => {
    websocket.send(JSON.stringify({ type: 'join' }));
};

// control for movement
document.addEventListener('keydown', event => {
    const char = String.fromCharCode(event.keyCode);
    switch (char) {
        case 'W':
            player.up = true;
            break;
        case 'A':
            player.left = true;
            break;
        case 'S':
            player.down = true;
            break;
        case 'D':
            player.right = true;
            break;
    }
});

// control for shooting
document.addEventListener('click', function () {
    const pickResult = scene.pick(scene.pointerX, scene.pointerY);
    player.combat.direction = Math.atan2(pickResult.pickedPoint.x - player.mesh.position.x, pickResult.pickedPoint.z - player.mesh.position.z);
    player.combat.isShooting = true;
});

// client network update pulse
setInterval(() => {
    const arraybuffer = new ArrayBuffer(20);
    const dataview = new DataView(arraybuffer);

    // player wants to move
    if (player.left) {
        dataview.setUint8(0, 1);
        dataview.setUint8(1, 1);
        websocket.send(dataview);
        player.left = false;
    }
    if (player.up) {
        dataview.setUint8(0, 1);
        dataview.setUint8(1, 2);
        websocket.send(dataview);
        player.up = false;
    }
    if (player.right) {
        dataview.setUint8(0, 1);
        dataview.setUint8(1, 3);
        websocket.send(dataview);
        player.right = false;
    }
    if (player.down) {
        dataview.setUint8(0, 1);
        dataview.setUint8(1, 4);
        websocket.send(dataview);
        player.down = false;
    }

    // player wants to shoot
    if (player.combat.isShooting) {
        dataview.setUint8(0, 2);
        dataview.setFloat32(1, player.combat.direction);
        websocket.send(dataview);
        player.combat.isShooting = false;
    }
}, 1000 / 20);

// physics
setInterval(() => {
    if (session_started) {
        // player movement
        player_list.forEach(player_object => {
            player_object.mesh.position.z = player_object.x;
            player_object.mesh.position.x = player_object.y;
        });

        // projectile movement
        projectile_list.forEach(projectile => {
            projectile.mesh.position.z += projectile.movement_speed * Math.cos(projectile.direction);
            projectile.mesh.position.x += projectile.movement_speed * Math.sin(projectile.direction);
        });
    }
}, 1000 / 30);

// mostly for game logic
scene.registerBeforeRender(function () {
    // remove projectiles that have lived for too long
    projectile_list.forEach(projectile => {
        if (Date.now() - projectile.creation_time >= 3000) {
            projectile_list.splice(projectile_list.indexOf(projectile), 1);
        }
    });
});

engine.runRenderLoop(function () {
    scene.render();
});

window.addEventListener("resize", function () {
    engine.resize();
});