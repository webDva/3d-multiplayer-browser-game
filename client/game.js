const canvas = document.getElementById("canvas");
const engine = new BABYLON.Engine(canvas, true, { stencil: true });

// This is really important to tell Babylon.js to use decomposeLerp and matrix interpolation
BABYLON.Animation.AllowMatricesInterpolation = true;

const scene = new BABYLON.Scene(engine);
//scene.debugLayer.show();
scene.clearColor = new BABYLON.Color3(1, 1, 1);

const camera = new BABYLON.FollowCamera('camera', new BABYLON.Vector3(0, 0, 0), scene);
//const camera = new BABYLON.ArcRotateCamera("Camera", 1, 1, 4, new BABYLON.Vector3(-10, 10, 20), scene);
camera.attachControl(canvas, false);

const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, -100, 0), scene);
light.diffuse = new BABYLON.Color3(1, 1, 1);
light.specular = new BABYLON.Color3(0, 0, 0);
light.groundColor = new BABYLON.Color3(0, 0, 0);

// ground mesh
const groundSize = 200;
const ground = BABYLON.Mesh.CreateGround("ground", groundSize, groundSize, 1, scene);
ground.setPivotMatrix(BABYLON.Matrix.Translation(groundSize / 2, 0, groundSize / 2), false);
ground.KGAME_TYPE = 2; // 2 means that it can be navigated to
ground.material = new BABYLON.GridMaterial('groundMaterial', scene);
ground.material.mainColor = new BABYLON.Color3(1, 1, 1);
ground.material.lineColor = new BABYLON.Color3(0, 0, 0);
ground.material.gridRatio = 1;
ground.material.majorUnitFrequency = 0;

// highlight layer for highlighting meshes
const targetSelectionHighlightLayer = new BABYLON.HighlightLayer("highlightlayer", scene);

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

function create_character(id, x, y, direction, type) {
    BABYLON.SceneLoader.ImportMeshAsync(null, './assets/', 'kawaii.babylon', scene).then(function (imported) {
        const mesh = imported.meshes[0];

        BABYLON.SceneLoader.ImportMeshAsync(null, './assets/', 'bat.babylon', scene).then(function (imported2) {
            const batMesh = imported2.meshes[0];
            batMesh.attachToBone(mesh.skeleton.bones[9], mesh);
            batMesh.rotation.x = -Math.PI / 2;
            batMesh.position.z += 1;
            batMesh.position.y += 2;
        });

        if (type === 0) { // if an NPC
            mesh.material = new BABYLON.StandardMaterial('', scene);
            mesh.material.diffuseColor = BABYLON.Color3.Red();
        }

        // animation
        mesh.skeleton.animationPropertiesOverride = new BABYLON.AnimationPropertiesOverride();
        mesh.skeleton.animationPropertiesOverride.enableBlending = true;
        mesh.skeleton.animationPropertiesOverride.blendingSpeed = 0.2;
        mesh.skeleton.animationPropertiesOverride.loopMode = 1;
        mesh.idleRange = mesh.skeleton.getAnimationRange('Idle');
        mesh.runRange = mesh.skeleton.getAnimationRange('Run');
        mesh.attackRange = mesh.skeleton.getAnimationRange('Attack');
        mesh.idleRange.animation = scene.beginAnimation(mesh.skeleton, mesh.idleRange.from, mesh.idleRange.to, true, 1);

        mesh.KGAME_TYPE = 1; // KGAME_TYPE 1 means that it is a kawaii game mesh of type 1
        player_list.push({
            id: id,
            x: x,
            y: y,
            mesh: mesh,
            direction: direction,
            previousX: x,
            previousY: y,
            health: 0,
            type: type
        });
        mesh.position.z = x;
        mesh.position.x = y;

        if (player.id === id) {
            player.mesh = mesh;
            camera.lockedTarget = player.mesh;
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
                const player_object = player_list.find(player_object => player_object.id === dataview.getUint32(2 + i * 16));
                if (player_object) {
                    player_object.x = dataview.getFloat32(6 + i * 16);
                    player_object.y = dataview.getFloat32(10 + i * 16);
                    player_object.direction = dataview.getFloat32(14 + i * 16);
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
            create_character(dataview.getUint32(1), dataview.getFloat32(5), dataview.getFloat32(9), dataview.getFloat32(13), dataview.getInt8(17));
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

// open the WebSocket connection
websocket.onopen = () => {
    websocket.send(JSON.stringify({ type: 'join' }));
};

scene.onPointerObservable.add(pointerInfo => {
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN && pointerInfo.pickInfo.pickedMesh && pointerInfo.pickInfo.pickedMesh.KGAME_TYPE === 1) {
        const player_object = player_list.find(player_object => player_object.mesh === pointerInfo.pickInfo.pickedMesh);
        if (targetSelectionHighlightLayer.selectedMesh === player_object.mesh) { // de-select or de-highlight if already selected
            targetSelectionHighlightLayer.removeMesh(targetSelectionHighlightLayer.selectedMesh);
            targetSelectionHighlightLayer.selectedMesh.selectionCircle.dispose();
            targetSelectionHighlightLayer.selectedMesh = null;
            player.combat.target = null;
        } else {
            if (targetSelectionHighlightLayer.selectedMesh) { // remove previous highlight and selection circle underneath
                targetSelectionHighlightLayer.selectedMesh.selectionCircle.dispose();
                targetSelectionHighlightLayer.removeMesh(targetSelectionHighlightLayer.selectedMesh);
            }
            player.combat.target = player_object.id;
            // highlight object mesh
            targetSelectionHighlightLayer.selectedMesh = player_object.mesh;
            targetSelectionHighlightLayer.addMesh(player_object.mesh, new BABYLON.Color4(1, 0, 1, 1));
            // selection circle
            targetSelectionHighlightLayer.selectedMesh.selectionCircle = BABYLON.Mesh.CreateDisc('selectionCircle', 5, 12, scene);
            targetSelectionHighlightLayer.selectedMesh.selectionCircle.material = new BABYLON.StandardMaterial('standardmaterial', scene);
            targetSelectionHighlightLayer.selectedMesh.selectionCircle.material.emissiveColor = new BABYLON.Color4(1, 0, 1, 1);
            targetSelectionHighlightLayer.selectedMesh.selectionCircle.parent = targetSelectionHighlightLayer.selectedMesh;
            targetSelectionHighlightLayer.selectedMesh.selectionCircle.position.y = 0.25;
            targetSelectionHighlightLayer.selectedMesh.selectionCircle.rotation.x = Math.PI / 2;
            // selection circle animation
            const selectionCircleAnimation = new BABYLON.Animation('selectionCircle', 'rotation.y', 1, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
            selectionCircleAnimation.setKeys([{ frame: 0, value: 0 }, { frame: 10, value: 2 * Math.PI }]);
            targetSelectionHighlightLayer.selectedMesh.selectionCircle.animations.push(selectionCircleAnimation);
            scene.beginAnimation(targetSelectionHighlightLayer.selectedMesh.selectionCircle, 0, 10, true);

            // attack the target
            scene.beginAnimation(player.mesh.skeleton, player.mesh.attackRange.from, player.mesh.attackRange.to, false, 0.25, function () {
                player.mesh.idleRange.animation = scene.beginAnimation(player.mesh.skeleton, player.mesh.idleRange.from, player.mesh.idleRange.to, true, 1);
            });
        }
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN && pointerInfo.pickInfo.pickedMesh.KGAME_TYPE === 2) {
        player.movement.isMoving = true;
        player.movement.x = pointerInfo.pickInfo.pickedPoint.z;
        player.movement.y = pointerInfo.pickInfo.pickedPoint.x;
        // destination circle
        const destinationCircle = BABYLON.Mesh.CreateDisc('destinationCircle', 0, 32, scene);
        destinationCircle.material = new BABYLON.StandardMaterial('standardmaterial', scene);
        destinationCircle.material.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        destinationCircle.position = new BABYLON.Vector3(player.movement.y, 0.25, player.movement.x);
        destinationCircle.rotation.x = Math.PI / 2;
        // animation for the destination circle
        const destinationCircleAnimation = new BABYLON.Animation('destinationCircleAnimation', 'scaling', 300, BABYLON.Animation.ANIMATIONTYPE_VECTOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
        destinationCircleAnimation.setKeys([{ frame: 0, value: new BABYLON.Vector3(0, 0, 0) }, { frame: 50, value: new BABYLON.Vector3(3, 3, 3) }, { frame: 100, value: new BABYLON.Vector3(0, 0, 0) }]);
        const destinationCircleEasingFunction = new BABYLON.BounceEase(10, 20);
        destinationCircleEasingFunction.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
        destinationCircleAnimation.setEasingFunction(destinationCircleEasingFunction);
        destinationCircle.animations.push(destinationCircleAnimation);
        scene.beginAnimation(destinationCircle, 100, 0, false, 1, function () {
            destinationCircle.dispose();
        });
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

// mostly for game logic and animation stuff
scene.registerBeforeRender(function () {
    if (session_started) {
        camera.position.x = player.mesh.position.x + 25;
        camera.position.y = player.mesh.position.y + 25;
        camera.position.z = player.mesh.position.z - 25;

        // movement animations
        player_list.forEach(player_object => {
            if (player_object.previousX != player_object.mesh.position.z || player_object.previousY != player_object.mesh.position.x) {
                if (!player_object.mesh.runRange.isRunning) {
                    player_object.mesh.runRange.isRunning = true;
                    player_object.mesh.idleRange.isRunning = false;
                    player_object.mesh.idleRange.animation.stop();
                    player_object.mesh.runRange.animation = scene.beginAnimation(player_object.mesh.skeleton, player_object.mesh.runRange.from, player_object.mesh.runRange.to, true, 1);
                }
            } else {
                if (!player_object.mesh.idleRange.isRunning) {
                    player_object.mesh.idleRange.isRunning = true;
                    player_object.mesh.runRange.isRunning = false;
                    if (player_object.mesh.runRange.animation)
                        player_object.mesh.runRange.animation.stop();
                    player_object.mesh.idleRange.animation = scene.beginAnimation(player_object.mesh.skeleton, player_object.mesh.idleRange.from, player_object.mesh.idleRange.to, true, 1);
                }
            }

            const deltaTime = engine.getDeltaTime();
            const lerpFactor = 40;
            if (deltaTime <= lerpFactor) {
                player_object.previousX = lerp(player_object.previousX, player_object.mesh.position.z, deltaTime / lerpFactor);
                player_object.previousY = lerp(player_object.previousY, player_object.mesh.position.x, deltaTime / lerpFactor);
            } else {
                player_object.previousX = player_object.mesh.position.z;
                player_object.previousY = player_object.mesh.position.x;
            }

            // combat would be processed here
        });
    }
});

engine.runRenderLoop(function () {
    scene.render();
});

window.addEventListener("resize", function () {
    engine.resize();
});