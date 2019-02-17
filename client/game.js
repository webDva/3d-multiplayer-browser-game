const canvas = document.getElementById("canvas");
const engine = new BABYLON.Engine(canvas, true, { stencil: true });

// This is really important to tell Babylon.js to use decomposeLerp and matrix interpolation
BABYLON.Animation.AllowMatricesInterpolation = true;

const scene = new BABYLON.Scene(engine);

// comment out when not using
//scene.debugLayer.show();

scene.clearColor = new BABYLON.Color3(1, 1, 1);

const camera = new BABYLON.UniversalCamera('camera', new BABYLON.Vector3(0, 0, 0), scene);
//const camera = new BABYLON.ArcRotateCamera("Camera", 1, 1, 4, new BABYLON.Vector3(-10, 10, 20), scene);
camera.attachControl(canvas, false);

const light = new BABYLON.PointLight("light", new BABYLON.Vector3(0, 0, 0), scene);
light.diffuse = new BABYLON.Color3(1, 1, 1);
light.specular = new BABYLON.Color3(1, 1, 1);

// highlight layer for highlighting meshes
const targetSelectionHighlightLayer = new BABYLON.HighlightLayer("highlightlayer", scene);

const player = {
    id: null,
    mesh: null,
    struct: null,

    movement: {
        isRotating: false,
        // requested orientation
        eulerX: 0,
        eulerY: 0,
        eulerZ: 0
    },

    combat: {
        target: null,
        attack: null
    }
};
let player_list = [];
let session_started = false;

function create_character(id, x, y, z, eulerX, eulerY, eulerZ, type) {
    BABYLON.SceneLoader.ImportMeshAsync(null, './assets/', 'kship.babylon', scene).then(function (imported) {
        const mesh = imported.meshes[0];

        if (type === 0) { // if an NPC
            mesh.material = new BABYLON.StandardMaterial('', scene);
            mesh.material.diffuseColor = BABYLON.Color3.Red();
        }

        mesh.KGAME_TYPE = 1; // KGAME_TYPE 1 means that it is a kawaii game mesh of type 1
        const player_struct = {
            id: id,
            x: x,
            y: y,
            z: z,
            mesh: mesh,
            eulerX: eulerX,
            eulerY: eulerY,
            eulerZ: eulerZ,
            health: 0,
            type: type
        };
        player_list.push(player_struct);
        mesh.position.z = x;
        mesh.position.x = y;
        mesh.position.z = z;
        mesh.rotation.z = eulerZ;
        mesh.rotation.x = eulerX;
        mesh.rotation.y = eulerY;

        if (player.id === id) {
            player.mesh = mesh;
            player.struct = player_struct;
            //camera.target = player.mesh;

            session_started = true;
        }
    });
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
            for (let i = 0; i < dataview.getUint8(1); i++) {
                const player_object = player_list.find(player_object => player_object.id === dataview.getUint32(2 + i * 28));
                if (player_object) {
                    player_object.x = dataview.getFloat32(6 + i * 28);
                    player_object.y = dataview.getFloat32(10 + i * 28);
                    player_object.z = dataview.getFloat32(14 + i * 28);
                    player_object.eulerX = dataview.getFloat32(18 + i * 28);
                    player_object.eulerY = dataview.getFloat32(22 + i * 28);
                    player_object.eulerZ = dataview.getFloat32(26 + i * 28);
                }
            }
        }

        // attacks
        if (dataview.getUint8(0) === 2) {
            const attacker = player_list.find(player_object => player_object.id === dataview.getUint32(1));
            const target = player_list.find(player_object => player_object.id === dataview.getUint32(5));
        }

        // new player joins
        if (dataview.getUint8(0) === 4) {
            create_character(dataview.getUint32(1), dataview.getFloat32(5), dataview.getFloat32(9), dataview.getFloat32(13), dataview.getFloat32(17), dataview.getFloat32(21), dataview.getFloat32(25), dataview.getInt8(29));
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
            for (let i = 0; i < dataview.getUint8(1); i++) {
                const player_object = player_list.find(player_object => player_object.id === dataview.getUint32(2 + i * 8));
                if (player_object) {
                    player_object.health = dataview.getInt32(6 + i * 8);
                }
            }
        }

        // no player deaths for now

        // no player respawns either
    }
}

// display DOM user interface
const uiCrosshair = document.getElementById('crosshair');
uiCrosshair.style.display = 'block';
uiCrosshair.style.left = window.innerWidth / 2 - uiCrosshair.getBoundingClientRect().width / 2 + 'px';
uiCrosshair.style.top = window.innerHeight / 2 - uiCrosshair.getBoundingClientRect().height / 2 + 'px';

const uiJoystick = document.getElementById('joystick');
uiJoystick.style.display = 'block';

function rotatePlayer(eventClientX, eventClientY) {
    const joystickPositionInfo = uiJoystick.getBoundingClientRect();
    const yawAmount = eventClientX - joystickPositionInfo.width / 2;
    const pitchAmount = eventClientY - joystickPositionInfo.height / 2;

    const controlSensitivity = 0.001;
    player.movement.eulerX = -pitchAmount * controlSensitivity;
    player.movement.eulerY = yawAmount * controlSensitivity;
    player.movement.eulerZ = 0;

    player.movement.isRotating = true;
}

uiJoystick.onmousedown = function (event) {
    const bounds = event.target.getBoundingClientRect();
    rotatePlayer(event.clientX - bounds.left, event.clientY - bounds.top);

    const thumbstick = document.getElementById('thumbstick');
    thumbstick.style.display = 'block';
    const thumbstickPositionInfo = thumbstick.getBoundingClientRect();
    thumbstick.style.left = event.clientX - thumbstickPositionInfo.width / 2 + 'px';
    thumbstick.style.top = event.clientY - thumbstickPositionInfo.height / 2 + 'px';
};

uiJoystick.onmousemove = function (event) {
    if (player.movement.isRotating) {
        const bounds = event.target.getBoundingClientRect();
        rotatePlayer(event.clientX - bounds.left, event.clientY - bounds.top);

        const thumbstick = document.getElementById('thumbstick');
        thumbstick.style.display = 'block';
        const thumbstickPositionInfo = thumbstick.getBoundingClientRect();
        thumbstick.style.left = event.clientX - thumbstickPositionInfo.width / 2 + 'px';
        thumbstick.style.top = event.clientY - thumbstickPositionInfo.height / 2 + 'px';
    }
};

uiJoystick.onmouseup = function () {
    document.getElementById('thumbstick').style.display = 'none';
    player.movement.isRotating = false;
};

// open the WebSocket connection
websocket.onopen = () => {
    websocket.send(JSON.stringify({ type: 'join' }));
};

for (let i = 0; i < 1500; i++) {
    const dummy = BABYLON.MeshBuilder.CreateBox("box", { diameter: 20 }, scene);
    dummy.position.x = Math.floor(Math.random() * (300 + 1));
    dummy.position.y = Math.floor(Math.random() * (300 + 1));
    dummy.position.z = Math.floor(Math.random() * (300 + 1));
    dummy.material = new BABYLON.StandardMaterial("standardmaterial", scene);
}

document.addEventListener('keydown', function (event) {
    const arraybuffer = new ArrayBuffer(20);
    const dataview = new DataView(arraybuffer);
    const char = String.fromCharCode(event.keyCode);
    switch (char) {
        case 'W':
            dataview.setUint8(0, 1);
            dataview.setUint8(1, 1);
            websocket.send(dataview);
            break;
        case 'F':
            dataview.setUint8(0, 1);
            dataview.setUint8(1, 0);
            websocket.send(dataview);
            break;
    }
});

// client network update pulse
setInterval(() => {
    // player wants to rotate their flying craft
    if (player.movement.isRotating) {
        const arraybuffer = new ArrayBuffer(13);
        const dataview = new DataView(arraybuffer);
        dataview.setUint8(0, 1);
        dataview.setFloat32(1, player.movement.eulerX);
        dataview.setFloat32(5, player.movement.eulerY);
        dataview.setFloat32(9, player.movement.eulerZ);
        websocket.send(dataview);
    }

    if (player.combat.attack) {
        dataview.setUint8(0, 3);
        dataview.setUint32(1, player.combat.target);
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
                player_object.mesh.position.x = lerp(player_object.mesh.position.x, player_object.x, deltaTime / lerpTime);
                player_object.mesh.position.y = lerp(player_object.mesh.position.y, player_object.y, deltaTime / lerpTime);
                player_object.mesh.position.z = lerp(player_object.mesh.position.z, player_object.z, deltaTime / lerpTime);

                player_object.mesh.rotation.x = lerp(player_object.mesh.rotation.x, player_object.eulerX, deltaTime / lerpTime);
                player_object.mesh.rotation.y = lerp(player_object.mesh.rotation.y, player_object.eulerY, deltaTime / lerpTime);
                player_object.mesh.rotation.z = lerp(player_object.mesh.rotation.z, player_object.eulerZ, deltaTime / lerpTime);
            });
        } else { // don't lerp
            player_list.forEach(player_object => {
                player_object.mesh.position.x = player_object.x;
                player_object.mesh.position.y = player_object.y;
                player_object.mesh.position.z = player_object.z;

                player_object.mesh.rotation.x = player_object.eulerX;
                player_object.mesh.rotation.y = player_object.eulerY;
                player_object.mesh.rotation.z = player_object.eulerZ;
            });
        }
    }

    lastUpdateTime = Date.now();
}, 1000 / 30);

// mostly for game logic and animation stuff
scene.registerBeforeRender(function () {
    if (session_started) {
        camera.position = player.mesh.position;
        camera.rotation = player.mesh.rotation;
    }
});

engine.runRenderLoop(function () {
    scene.render();
});

window.addEventListener("resize", function () {
    engine.resize();
    uiCrosshair.style.left = window.innerWidth / 2 - uiCrosshair.getBoundingClientRect().width / 2 + 'px';
    uiCrosshair.style.top = window.innerHeight / 2 - uiCrosshair.getBoundingClientRect().height / 2 + 'px';
});