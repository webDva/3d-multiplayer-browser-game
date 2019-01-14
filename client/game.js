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

let player = {};
let player_list = [];
let orb_list = [];
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
                player_list.push({ id: player.id, x: player.x, y: player.y, mesh: mesh });
            });

            const player_object = player_list.find(player_object => player_object.id === player.id);
            player.x = player_object.x;
            player.y = player_object.y;
            player.mesh = player_object.mesh;
            camera.target = player.mesh;

            session_started = true;
        }

        if (data.type === 'new_player' && session_started) {
            const mesh = BABYLON.MeshBuilder.CreateBox("box", {}, scene);
            mesh.position.y = 1;
            mesh.material = new BABYLON.StandardMaterial("standardmaterial", scene);
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

        if (dataview.getUint8(0) === 5) { // new orb spawning
            orb_list.push({ x: dataview.getFloat32(1), y: dataview.getFloat32(5) });
        }

        // no player deaths for now

        // no player respawns either
    }
}

// open the WebSocket connection
websocket.onopen = () => {
    websocket.send(JSON.stringify({ type: 'join' }));
};

document.addEventListener('click', function () {
    const arraybuffer = new ArrayBuffer(20);
    const dataview = new DataView(arraybuffer);

    const pickResult = scene.pick(scene.pointerX, scene.pointerY);

    dataview.setUint8(0, 1);
    dataview.setFloat32(1, pickResult.pickedPoint.z);
    dataview.setFloat32(5, pickResult.pickedPoint.x);
    websocket.send(dataview);
});

scene.registerBeforeRender(function () {
    if (session_started) {
        const arraybuffer = new ArrayBuffer(20);
        const dataview = new DataView(arraybuffer);

        player_list.forEach(player_object => {
            player_object.mesh.position.x = player_object.x;
            player_object.mesh.position.z = player_object.y;
        });
    }
});

engine.runRenderLoop(function () {
    scene.render();
});

window.addEventListener("resize", function () {
    engine.resize();
});