const canvas = document.getElementById("canvas");
const engine = new BABYLON.Engine(canvas, true);

// This is really important to tell Babylon.js to use decomposeLerp and matrix interpolation
BABYLON.Animation.AllowMatricesInterpolation = true;

const scene = new BABYLON.Scene(engine);
//scene.debugLayer.show();
scene.clearColor = new BABYLON.Color3(1, 1, 1);
scene.collisionsEnabled = true;

const camera = new BABYLON.FollowCamera('camera', new BABYLON.Vector3(0, 0, 0), scene);
camera.attachControl(canvas, false);

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

    movement: {
        isMoving: false,
        x: 0,
        y: 0
    },

    combat: {
        target: null,
        attack: null
    }
};
let player_list = [];
let session_started = false;

// configure WebSocket client

const websocket = new WebSocket(((window.location.protocol === 'https:') ? 'wss://' : 'ws://') + window.location.host);
websocket.binaryType = 'arraybuffer';

websocket.onmessage = (event) => {
    if (typeof event.data === 'string') {
        const data = JSON.parse(event.data);

        if (data.type === 'welcome') {
            player.id = data.id;
            data.player_list.forEach(player_data => {
                BABYLON.SceneLoader.ImportMeshAsync('', './', 'kawaii.babylon', scene).then(function (imported) {
                    const mesh = imported.meshes[0];
                    player_list.push({ id: player_data.id, x: player_data.x, y: player_data.y, mesh: mesh, direction: player_data.direction });
                    mesh.position.z = player_data.x;
                    mesh.position.x = player_data.y;

                    if (player_data.id === player.id) {
                        player.mesh = mesh;
                        camera.lockedTarget = player.mesh;

                        dummy.position.x = player.mesh.position.x;
                        dummy.position.z = player.mesh.position.z;

                        session_started = true;
                    }
                });
            });
        }

        if (data.type === 'new_player' && session_started) {
            BABYLON.SceneLoader.ImportMeshAsync('', './', 'kawaii.babylon', scene).then(function (imported) {
                const mesh = imported.meshes[0];
                player_list.push({ id: data.id, x: data.x, y: data.y, mesh: mesh, direction: data.direction });
            });
        }

        if (data.type === 'player_disconnect') {
            const player_object = player_list.find(player_object => player_object.id === data.id);
            player_object.mesh.dispose();
            player_list.splice(player_list.indexOf(player_object), 1);
        }

    }

    if (event.data instanceof ArrayBuffer && session_started) {
        const dataview = new DataView(event.data);

        if (dataview.getUint8(0) === 1) { // player orientations
            for (let i = 0; i < dataview.getUint8(1); i++) {
                const player_object = player_list.find(player_object => player_object.id === dataview.getUint32(2 + i * 16));
                player_object.x = dataview.getFloat32(6 + i * 16);
                player_object.y = dataview.getFloat32(10 + i * 16);
                player_object.direction = dataview.getFloat32(14 + i * 16);
            }
        }

        // no player deaths for now

        // no player respawns either
    }
}

// open the WebSocket connection
websocket.onopen = () => {
    websocket.send(JSON.stringify({ type: 'join' }));
};

scene.onPointerObservable.add(pointerInfo => {
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN && pointerInfo.pickInfo.pickedMesh && pointerInfo.pickInfo.pickedMesh !== ground) {
        const player_object = player_list.find(player_object => player_object.mesh === pointerInfo.pickInfo.pickedMesh);
        player.combat.target = player_object.id;
        player.combat.attack = 100;
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN && pointerInfo.pickInfo.pickedMesh === ground) {
        player.movement.isMoving = true;
        player.movement.x = pointerInfo.pickInfo.pickedPoint.z;
        player.movement.y = pointerInfo.pickInfo.pickedPoint.x;
    }
});

// client network update pulse
setInterval(() => {
    const arraybuffer = new ArrayBuffer(20);
    const dataview = new DataView(arraybuffer);

    // player wants to move
    if (player.movement.isMoving) {
        player.movement.isMoving = false;
        dataview.setUint8(0, 1);
        dataview.setFloat32(1, player.movement.x);
        dataview.setFloat32(5, player.movement.y);
        websocket.send(dataview);
    }

    if (player.combat.attack) {
        dataview.setUint8(0, 3);
        dataview.setUint32(1, player.combat.target);
        dataview.setUint8(5, player.combat.attack);
        websocket.send(dataview);
        player.combat.attack = null;
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
                player_object.mesh.position.z = lerp(player_object.mesh.position.z, player_object.x, deltaTime / lerpTime);
                player_object.mesh.position.x = lerp(player_object.mesh.position.x, player_object.y, deltaTime / lerpTime);
                player_object.mesh.rotation.y = lerp(player_object.mesh.rotation.y, player_object.direction, deltaTime / lerpTime);
            });
        } else { // don't lerp
            player_list.forEach(player_object => {
                player_object.mesh.position.z = player_object.x;
                player_object.mesh.position.x = player_object.y;
                player_object.mesh.rotation.y = player_object.direction;
            });
        }
    }

    lastUpdateTime = Date.now();
}, 1000 / 30);

// mostly for game logic
scene.registerBeforeRender(function () {
    if (session_started) {
        camera.position.x = player.mesh.position.x + 25;
        camera.position.y = player.mesh.position.y + 25;
        camera.position.z = player.mesh.position.z - 25;
    }
});

engine.runRenderLoop(function () {
    scene.render();
});

window.addEventListener("resize", function () {
    engine.resize();
});