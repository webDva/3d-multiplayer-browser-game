const express = require('express');
const app = express();
const httpServer = require('http').Server(app);
const WebSocket = require('uws');
const ws_server = new WebSocket.Server({ server: httpServer });
const crypto = require('crypto');

const minify = require('@node-minify/core');
const gcc = require('@node-minify/google-closure-compiler');
const htmlMinifier = require('@node-minify/html-minifier');
const cleanCSS = require('@node-minify/clean-css');

const config = require('./config.json');
const env = require('./env.json')[process.env.NODE_ENV || 'development'];

if (env.production) {
    console.log('Server started in production mode.');

    // the minification directory's name and location is "./minified"
    console.log('Minifying the primary minification target...');
    minify({
        compressor: gcc,
        input: './client/game.js',
        output: './minified/game.js', // it overwrites the file
        sync: true,
        callback: function (err, min) {
            console.log('Primary minification complete.');
        }
    });

    minify({
        compressor: htmlMinifier,
        input: './client/index.html',
        output: './minified/index.html'
    });

    minify({
        compressor: cleanCSS,
        input: './client/styles/style.css',
        output: './minified/style.css'
    });

    app.get('/', function (req, res) {
        res.sendFile('index.html', { root: __dirname + '/minified' });
    }).get('/game.js', function (req, res) {
        res.sendFile('game.js', { root: __dirname + '/minified' });
    }).get('/styles/style.css', function (req, res) {
        res.sendFile('style.css', { root: __dirname + '/minified' });
    }).get('/babylon.custom.js', function (req, res) {
        res.sendFile('babylon.custom.min.js', { root: __dirname + '/client' });
    });
}

app.use(express.static(__dirname + '/client'));

const PORT = process.env.PORT || config.PORT;
httpServer.listen(PORT, function () {
    console.log(`HTTP server started on port ${PORT}.`);
});

function randomUint32() {
    return crypto.randomBytes(4).readUInt32BE(0, true);
}

function broadcast(data, exception = null) {
    ws_server.clients.forEach(client => {
        if (client !== exception && client.readyState === WebSocket.OPEN)
            client.send(data);
    });
}

function transmit(data, websocket) {
    if (websocket.readyState === WebSocket.OPEN)
        websocket.send(data);
}

function transmitPlayer(data, player) { // for when the player's socket is not known
    ws_server.clients.forEach(client => { // find the socket that the player belongs to
        if (client.player === player && client.readyState === WebSocket.OPEN)
            client.send(data);
    });
}

function createBinaryFrame(id, segments, id_size = true) { // segments is a list of objects with type and value properties
    let segments_length = 0;
    segments.forEach(segment => {
        switch (segment.type) {
            case 'Int8':
            case 'Uint8':
                segments_length += 1;
                break;
            case 'Int16':
            case 'Uint16':
                segments_length += 2;
                break;
            case 'Int32':
            case 'Uint32':
            case 'Float32':
                segments_length += 4;
                break;
            case 'Float64':
                segments_length += 8;
                break;
        }
    });

    // if id_size is true, the id is one byte. else the id is two bytes
    const IDSize = id_size ? 1 : 2;
    const arraybuffer = new ArrayBuffer(IDSize + segments_length);
    const dataview = new DataView(arraybuffer);

    switch (IDSize) {
        case 1:
            dataview.setUint8(0, id);
            break;
        case 2:
            dataview.setUint16(0, id);
            break;
    }

    // offsets will be automatically calculated by this function, so the user needs to establish his segments' order
    let offset = IDSize;
    segments.forEach(segment => {
        switch (segment.type) {
            case 'Int8':
                dataview.setInt8(offset, segment.value);
                offset += 1;
                break;
            case 'Uint8':
                dataview.setUint8(offset, segment.value);
                offset += 1;
                break;
            case 'Int16':
                dataview.setInt16(offset, segment.value);
                offset += 2;
                break;
            case 'Uint16':
                dataview.setUint16(offset, segment.value);
                offset += 2;
                break;
            case 'Int32':
                dataview.setInt32(offset, segment.value);
                offset += 4;
                break;
            case 'Uint32':
                dataview.setUint32(offset, segment.value);
                offset += 4;
                break;
            case 'Float32':
                dataview.setFloat32(offset, segment.value);
                offset += 4;
                break;
            case 'Float64':
                dataview.setFloat64(offset, segment.value);
                offset += 8;
                break;
        }
    });

    return dataview;
}

ws_server.on('connection', websocket => {
    websocket.isAlive = true; // create this property for the sake of implementing ping-pong heartbeats

    websocket.player = game.addCharacter();

    websocket.on('message', message => {
        if (typeof message === 'string') {
            const data = JSON.parse(message);

            if (data.type === 'join') {
                // send welcome message. the player's id
                transmit(createBinaryFrame(3, [{ type: 'Uint32', value: websocket.player.id }]), websocket);

                // notify the rest of the room of the new player
                broadcast(createBinaryFrame(4, [
                    { type: 'Uint32', value: websocket.player.id },
                    { type: 'Float32', value: websocket.player.x },
                    { type: 'Float32', value: websocket.player.y },
                    { type: 'Float32', value: websocket.player.z },
                    { type: 'Float32', value: websocket.player.eulerX },
                    { type: 'Float32', value: websocket.player.eulerY },
                    { type: 'Int8', value: 1 } // player type and not an NPC type
                ]), websocket);
            }

            // a player has requested map data such as players
            if (data.type === 'request_map_data') {
                // send list of players and NPCs
                game.players.concat(game.npcs).forEach(character => {
                    transmit(createBinaryFrame(4, [
                        { type: 'Uint32', value: character.id },
                        { type: 'Float32', value: character.x },
                        { type: 'Float32', value: character.y },
                        { type: 'Float32', value: character.z },
                        { type: 'Float32', value: character.eulerX },
                        { type: 'Float32', value: character.eulerY },
                        { type: 'Int8', value: character.type ? 1 : 0 } // 1 if is a player and 0 if an NPC
                    ]), websocket);
                });
            }
        }

        if (message instanceof ArrayBuffer) {
            const client_dataview = new DataView(message);

            // player movement
            if (client_dataview.getUint8(0) === 1) {
                const player = websocket.player;

                const xInc = client_dataview.getFloat32(1);
                const yInc = client_dataview.getFloat32(5);

                player.eulerX = preventGimbalLock(player.eulerX + xInc);
                player.eulerY += yInc;
            }

            // player is shooting a projectile
            if (client_dataview.getUint8(0) === 2) {
                const player = websocket.player;
                if (player.isAlive) {
                    const rotationMatrix = generateRotationMatrixFromEuler(player.eulerX, player.eulerY, 0);
                    const playerForwardVector = [rotationMatrix[0][2], rotationMatrix[1][2], rotationMatrix[2][2]];
                    const projectile = {
                        position: {
                            x: player.x,
                            y: player.y,
                            z: player.z,
                        },
                        forwardVector: {
                            x: playerForwardVector[0],
                            y: playerForwardVector[1],
                            z: playerForwardVector[2]
                        },
                        physicsBox: {
                            minX: player.x - 3 / 2,
                            maxX: player.x + 3 / 2,

                            minY: player.y - 3 / 2,
                            maxY: player.y + 3 / 2,

                            minZ: player.z - 3 / 2,
                            maxZ: player.z + 3 / 2
                        },
                        speed: 3,
                        creationTime: Date.now(),
                        owner: player.id
                    };

                    game.projectiles.push(projectile);
                    game.networkUpdates.combat.newProjectiles.push(projectile);
                }
            }
        }
    });

    websocket.on('close', () => {
        game.players.splice(game.players.indexOf(websocket.player), 1);
        broadcast(createBinaryFrame(6, [{ type: 'Uint32', value: websocket.player.id }]), websocket);
    });

    websocket.on('pong', () => websocket.isAlive = true);
});

class Game {
    constructor() {
        this.players = [];
        this.mapSize = config.mapSize; // width and height
        this.networkUpdates = {
            combat: {
                newProjectiles: [],
                deaths: [],
                respawns: [] // or joins
            }
        };
        this.combat = {
            attacks: []
        };
        this.npcs = [];
        //const npc = this.addNPC();
        this.projectiles = [];
    }

    addCharacter(isHumanPlayer = true) {
        let id = randomUint32();
        while (this.players.concat(this.npcs).find(character => character.id === id)) {
            id = randomUint32();
        }

        const character = {
            id: id,
            type: isHumanPlayer, // true for player and false for NPC. TODO: create additional logic for NPCs inside this function

            // initial orientation
            x: Math.random() * (this.mapSize - -this.mapSize) + -this.mapSize,
            y: Math.random() * (this.mapSize - -this.mapSize) + -this.mapSize,
            z: Math.random() * (this.mapSize - -this.mapSize) + -this.mapSize,
            // rotations have to be zero initially
            eulerX: 0,
            eulerY: 0,

            //movement_speed: config.player.defaultMovementSpeed, // speed will be a ratio of the throttle speed and character maximum movement speed
            movement_speed: 0.1,

            // collision
            radius: config.player.radius,

            throttleSetting: 0,

            health: 100, // has to be a signed 32-bit integer for negative health values

            isAlive: true,
            deathTime: 0,

            combat: {} // cooldowns, etc.
        };

        this.players.push(character); // list name will change
        return character;
    }

    addNPC() {
        let id = randomUint32();
        while (this.npcs.concat(this.players).find(character => character.id === id)) {
            id = randomUint32();
        }
        const npc = {
            id: id,
            type: false, // not a player

            // physics movement and initial starting position
            x: Math.floor(Math.random() * (this.mapSize + 1)),
            y: Math.floor(Math.random() * (this.mapSize + 1)),
            movement_speed: config.player.defaultMovementSpeed, // shares player's movement for now

            // should be shared with players--or not
            radius: config.player.radius,
            direction: Math.PI / 2,
            velocityX: 0,
            velocityY: 0,
            targetX: 0,
            targetY: 0,
            isMoving: false,
            health: 100,

            combat: {
                aggro: [] // a list of player-aggro pairs
            }
        };

        this.npcs.push(npc);
        return npc;
    }

    physicsLoop() {
        // projectile movement
        this.projectiles.forEach(projectile => {
            projectile.position.x += projectile.forwardVector.x * projectile.speed;
            projectile.position.y += projectile.forwardVector.y * projectile.speed;
            projectile.position.z += projectile.forwardVector.z * projectile.speed;

            // move the projectile's physics box as well
            projectile.physicsBox.minX = projectile.position.x - 3 / 2;
            projectile.physicsBox.maxX = projectile.position.x + 3 / 2;

            projectile.physicsBox.minY = projectile.position.y - 3 / 2;
            projectile.physicsBox.maxY = projectile.position.y + 3 / 2;

            projectile.physicsBox.minZ = projectile.position.z - 3 / 2;
            projectile.physicsBox.maxZ = projectile.position.z + 3 / 2;
        });

        // player and NPC movement
        this.players.concat(this.npcs).filter(character => { // collision detection
            // for now, there is no collision detection
            return true;
        })
            .forEach(character => {
                const rotationMatrix = generateRotationMatrixFromEuler(character.eulerX, character.eulerY, 0);

                character.x += rotationMatrix[0][2] * character.movement_speed;
                character.y += rotationMatrix[1][2] * character.movement_speed;
                character.z += rotationMatrix[2][2] * character.movement_speed;
            });
    }

    gameLogicLoop() {
        // remove expired projectiles
        this.projectiles.forEach(projectile => {
            if (Date.now() - projectile.creationTime > 10000) {
                this.projectiles.splice(this.projectiles.indexOf(projectile), 1);
            }
        });

        // projectile-player collisions
    }

    sendNetworkUpdates() {
        // send player and NPC orientations
        let orientations = [];
        orientations.push({ type: 'Uint8', value: this.players.length + this.npcs.length });
        this.players.concat(this.npcs).forEach(character => {
            orientations.push({ type: 'Uint32', value: character.id });
            orientations.push({ type: 'Float32', value: character.x });
            orientations.push({ type: 'Float32', value: character.y });
            orientations.push({ type: 'Float32', value: character.z });
            orientations.push({ type: 'Float32', value: character.eulerX });
            orientations.push({ type: 'Float32', value: character.eulerY });
        });
        broadcast(createBinaryFrame(1, orientations));

        // send character healths
        let healths = [];
        healths.push({ type: 'Uint8', value: this.players.length + this.npcs.length });
        this.players.concat(this.npcs).forEach(character => {
            healths.push({ type: 'Uint32', value: character.id });
            healths.push({ type: 'Int32', value: character.health });
        });
        broadcast(createBinaryFrame(9, healths));

        // new projectiles
        this.networkUpdates.combat.newProjectiles.forEach(projectile => {
            broadcast(createBinaryFrame(5, [
                { type: 'Float32', value: projectile.position.x },
                { type: 'Float32', value: projectile.position.y },
                { type: 'Float32', value: projectile.position.z },
                { type: 'Float32', value: projectile.forwardVector.x },
                { type: 'Float32', value: projectile.forwardVector.y },
                { type: 'Float32', value: projectile.forwardVector.z },
                { type: 'Float32', value: projectile.speed },
                { type: 'Uint32', value: projectile.owner }
            ]));
            this.networkUpdates.combat.newProjectiles.splice(this.networkUpdates.combat.newProjectiles.indexOf(projectile), 1);
        });
    }
}

function createMatrix(rows, columns) {
    let matrix = [];
    for (let i = 0; i < rows; i++) {
        matrix[i] = [];
        for (let j = 0; j < columns; j++) {
            matrix[i][j] = 0;
        }
    }
    return matrix;
}

function transposeMatrix(matrix, rows, columns) {
    let newMatrix = createMatrix(rows, columns);
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < columns; j++) {
            newMatrix[j][i] = matrix[i][j];
        }
    }
    return newMatrix;
}

function normalize(x, y, z) {
    const magnitude = Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2) + Math.pow(z, 2));
    if (magnitude > 0) {
        return [x / magnitude, y / magnitude, z / magnitude];
    } else {
        return [0, 0, 0];
    }
}

function multiplyMatrices(A, rowsA, columnsA, B, rowsB, columnsB) {
    if (columnsA !== rowsB) {
        return null;
    }
    let newMatrix = createMatrix(rowsA, columnsB);
    for (let i = 0; i < rowsA; i++) {
        for (let j = 0; j < columnsB; j++) {
            for (let k = 0; k < columnsA; k++) {
                newMatrix[i][j] += A[i][k] * B[k][j];
            }
        }
    }
    return newMatrix;
}

function generateXRotationMatrix(angle) {
    let matrix = createMatrix(4, 4);
    fillColumnVector(matrix, 0, [1, 0, 0, 0]);
    fillColumnVector(matrix, 1, [0, Math.cos(angle), Math.sin(angle), 0]);
    fillColumnVector(matrix, 2, [0, -Math.sin(angle), Math.cos(angle), 0]);
    fillColumnVector(matrix, 3, [0, 0, 0, 1]);
    return matrix;
}

function generateYRotationMatrix(angle) {
    let matrix = createMatrix(4, 4);
    fillColumnVector(matrix, 0, [Math.cos(angle), 0, -Math.sin(angle), 0]);
    fillColumnVector(matrix, 1, [0, 1, 0, 0]);
    fillColumnVector(matrix, 2, [Math.sin(angle), 0, Math.cos(angle), 0]);
    fillColumnVector(matrix, 3, [0, 0, 0, 1]);
    return matrix;
}

function generateZRotationMatrix(angle) {
    let matrix = createMatrix(4, 4);
    fillColumnVector(matrix, 0, [Math.cos(angle), Math.sin(angle), 0, 0]);
    fillColumnVector(matrix, 1, [-Math.sin(angle), Math.cos(angle), 0, 0]);
    fillColumnVector(matrix, 2, [0, 0, 1, 0]);
    fillColumnVector(matrix, 3, [0, 0, 0, 1]);
    return matrix;
}

function fillColumnVector(columnMajorMatrix, column, columnVectorArray) {
    for (let i = 0; i < 4; i++) {
        columnMajorMatrix[i][column] = columnVectorArray[i];
    }
}

/**
 * @return {[][]} Column-major rotation matrix.
 */
function generateRotationMatrixFromEuler(X, Y, Z) {
    const xRotationMatrix = generateXRotationMatrix(X);
    const yRotationMatrix = generateYRotationMatrix(Y);
    const zRotationMatrix = generateZRotationMatrix(Z);

    const yxRotationMatrix = multiplyMatrices(yRotationMatrix, 4, 4, xRotationMatrix, 4, 4);
    const finalRotationMatrix = multiplyMatrices(yxRotationMatrix, 4, 4, zRotationMatrix, 4, 4);
    return finalRotationMatrix;
}

function clampAngle(angle) {
    return angle % (Math.PI * 2);
}

function preventGimbalLock(angle) {
    const X_ANGLE_THRESHOLD = 87;
    const degrees = angle * 180 / Math.PI;
    if (degrees > X_ANGLE_THRESHOLD) {
        angle = X_ANGLE_THRESHOLD * Math.PI / 180;
    } else if (degrees < -X_ANGLE_THRESHOLD) {
        angle = -X_ANGLE_THRESHOLD * Math.PI / 180;
    }
    return angle;
}

/**
 * @return {[][]} Column-major translation matrix.
 */
function createTranslationMatrix(x, y, z) {
    let translationMatrix = createIdentityMatrix(4);
    fillColumnVector(translationMatrix, 3, [x, y, z, 1]);
    return translationMatrix;
}

function createIdentityMatrix(size) {
    let matrix = createMatrix(size, size);

    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            if (i === j) {
                matrix[i][j] = 1;
            }
        }
    }

    return matrix;
}

const game = new Game();

setInterval(function () {
    game.physicsLoop();
}, 1000 / config.physicsTickRate);
setInterval(function () {
    game.gameLogicLoop();
}, 1000 / config.physicsTickRate);
setInterval(function () {
    game.sendNetworkUpdates();
}, 1000 / config.networkUpdatePulseRate);

// ping-pong heartbeat
setInterval(function () {
    ws_server.clients.forEach(websocket => {
        if (websocket.isAlive === false) {
            game.players.splice(game.players.indexOf(websocket.player), 1);
            broadcast(createBinaryFrame(6, [{ type: 'Uint32', value: websocket.player.id }]), websocket);
            return websocket.terminate();
        }

        websocket.isAlive = false;
        if (websocket.readyState === WebSocket.OPEN) {
            websocket.ping();
        }
    });
}, 1000 * config.pingTime);