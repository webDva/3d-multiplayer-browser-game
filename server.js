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

    websocket.player = game.addPlayer();

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
                    { type: 'Float32', value: websocket.player.eulerZ },
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
                        { type: 'Float32', value: character.eulerZ },
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
                if (client_dataview.getUint8(1) === 1) {
                    player.isMoving = true;
                    let transposedViewMatrix = transposeMatrix(player.viewMatrix, 4, 4);
                    const normalized = normalize([player.eulerX, player.eulerY, player.eulerZ]);
                    transposedViewMatrix[0][2] = normalized[0];
                    transposedViewMatrix[1][2] = normalized[1];
                    transposedViewMatrix[2][2] = normalized[2];
                    player.viewMatrix = transposeMatrix(transposedViewMatrix, 4, 4);
                } else if (client_dataview.getUint8(1) === 0) {
                    player.isMoving = false;
                }
            }

            // player is attacking someone or something
            if (client_dataview.getUint8(0) === 3) {
                const player = websocket.player;
                const target = client_dataview.getUint32(1); // player ID or mob ID
                if (true) { // will do move legality processing here
                    game.combat.attacks.push({ attacker: player.id, target: target });
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
                attacks: [],
                deaths: [],
                respawns: [] // or joins
            }
        };
        this.combat = {
            attacks: []
        };
        this.npcs = [];
        //const npc = this.addNPC();
    }

    addPlayer() {
        let id = randomUint32();
        while (this.players.concat(this.npcs).find(character => character.id === id)) {
            id = randomUint32();
        }
        const x = Math.floor(Math.random() * (this.mapSize + 1));
        const y = Math.floor(Math.random() * (this.mapSize + 1));
        const z = Math.floor(Math.random() * (this.mapSize + 1));
        let viewMatrix = createMatrix(4, 4);
        const positionVector = [x, y, z, 1];
        for (let i = 0; i < 4; i++) {
            viewMatrix[3][i] = positionVector[i];
        }
        const eulerX = (Math.random() * (Math.PI * 2)).toFixed(4);
        const eulerY = (Math.random() * (Math.PI * 2)).toFixed(4);
        const eulerZ = (Math.random() * (Math.PI * 2)).toFixed(4);
        const player = {
            id: id,
            type: true, // true for player and not NPC

            viewMatrix: viewMatrix, // camera view matrix

            // initial orientation
            x: x,
            y: y,
            z: z,
            eulerX: eulerX,
            eulerY: eulerY,
            eulerZ: eulerZ,

            movement_speed: config.player.defaultMovementSpeed, // speed will be a ratio of the throttle speed and character maximum movement speed

            // collision
            radius: config.player.radius,

            throttleSetting: 0,

            isMoving: false, // will be removed later. for now, determines if the client toggled movement on or off

            health: 100, // has to be a signed 32-bit integer for negative health values

            isAlive: true,
            deathTime: 0,

            combat: {} // cooldowns, etc.
        };

        this.players.push(player);
        return player;
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
        // player and NPC movement
        this.players.concat(this.npcs).filter(character => {
            return character.isMoving;
        })
            .filter(character => { // collision detection
                // for now, there is no collision detection
                return true;
            })
            .forEach(character => {
                let viewMatrix = transposeMatrix(character.viewMatrix, 4, 4);

                const forwardVector = [viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2], viewMatrix[3][2]];
                for (let i = 0; i < 3; i++) {
                    viewMatrix[i][3] += forwardVector[i] * character.movement_speed;
                }

                const rotationMatrix = transposeMatrix(generateRotationMatrixFromEuler([character.eulerX, character.eulerY, character.eulerZ]), 4, 4);
                let transformationMatrix = multiplyMatrices(viewMatrix, 4, 4, rotationMatrix, 4, 4);

                character.x = transformationMatrix[0][3];
                character.y = transformationMatrix[1][3];
                character.z = transformationMatrix[2][3];

                // for (let i = 0; i < 3; i++) {
                //     transformationMatrix[i][2] += forwardVector[i] * character.movement_speed;
                // }

                character.viewMatrix = transposeMatrix(transformationMatrix, 4, 4);
            });
    }

    gameLogicLoop() {
        // combat attacks
        this.combat.attacks.forEach(attack => {
            this.networkUpdates.combat.attacks.push(attack);
            this.combat.attacks.splice(this.combat.attacks.indexOf(attack), 1);
        });
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
            orientations.push({ type: 'Float32', value: character.eulerZ });
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

        // send attacks that characters performed
        // since NPCs are here now, will need to send attack types
        this.networkUpdates.combat.attacks.forEach(attack => {
            broadcast(createBinaryFrame(2, [
                { type: 'Uint32', value: attack.attacker },
                { type: 'Uint32', value: attack.target }
            ]));
            this.networkUpdates.combat.attacks.splice(this.networkUpdates.combat.attacks.indexOf(attack), 1);
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

function normalize(vector) {
    const magnitude = Math.sqrt(Math.pow(vector[0], 2) + Math.pow(vector[1], 2) + Math.pow(vector[2], 2));
    if (magnitude > 0) {
        return [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude];
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
                newMatrix[i][j] = A[i][k] * B[k][j];
            }
        }
    }
    return newMatrix;
}

function generateXRotationMatrix(angle) {
    let matrix = createMatrix(4, 4);
    matrix = transposeMatrix(matrix, 4, 4);
    fillColumnVector(matrix, 0, [1, 0, 0, 0]);
    fillColumnVector(matrix, 1, [0, Math.cos(angle), Math.sin(angle), 0]);
    fillColumnVector(matrix, 2, [0, -Math.sin(angle), Math.cos(angle), 0]);
    fillColumnVector(matrix, 3, [0, 0, 0, 1]);
    matrix = transposeMatrix(matrix, 4, 4);
    return matrix;
}

function generateYRotationMatrix(angle) {
    let matrix = createMatrix(4, 4);
    matrix = transposeMatrix(matrix, 4, 4);
    fillColumnVector(matrix, 0, [Math.cos(angle), 0, -Math.sin(angle), 0]);
    fillColumnVector(matrix, 1, [0, 1, 0, 0]);
    fillColumnVector(matrix, 2, [Math.sin(angle), 0, Math.cos(angle), 0]);
    fillColumnVector(matrix, 3, [0, 0, 0, 1]);
    matrix = transposeMatrix(matrix, 4, 4);
    return matrix;
}

function generateZRotationMatrix(angle) {
    let matrix = createMatrix(4, 4);
    matrix = transposeMatrix(matrix, 4, 4);
    fillColumnVector(matrix, 0, [Math.cos(angle), Math.sin(angle), 0, 0]);
    fillColumnVector(matrix, 1, [-Math.sin(angle), Math.cos(angle), 0, 0]);
    fillColumnVector(matrix, 2, [0, 0, 1, 0]);
    fillColumnVector(matrix, 3, [0, 0, 0, 1]);
    matrix = transposeMatrix(matrix, 4, 4);
    return matrix;
}

// has to be transposed to column major
function fillColumnVector(transposedColumnMajorMatrix, column, columnVectorArray) {
    for (let i = 0; i < 4; i++) {
        transposedColumnMajorMatrix[column][i] = columnVectorArray[i];
    }
}

function generateRotationMatrixFromEuler(eulerVectorArray) {
    const xRotationMatrix = generateXRotationMatrix(eulerVectorArray[0]);
    const yRotationMatrix = generateYRotationMatrix(eulerVectorArray[1]);
    const zRotationMatrix = generateZRotationMatrix(eulerVectorArray[2]);
    const xyRotationMatrix = multiplyMatrices(xRotationMatrix, 4, 4, yRotationMatrix, 4, 4);
    const finalRotationMatrix = multiplyMatrices(xyRotationMatrix, 4, 4, zRotationMatrix, 4, 4);
    return finalRotationMatrix;
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