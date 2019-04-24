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
        sync: true,
        input: './client/index.html',
        output: './minified/index.html'
    });

    minify({
        compressor: cleanCSS,
        sync: true,
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

const config = {
    PORT: 3000,
    networkUpdatePulseRate: 1000 / 15,
    physicsTickRate: 1000 / 15,
    character: {
        defaultMovementSpeed: 1,
        collisionBoxSize: 3 // a square
    },
    mapSize: 50,
    pingTime: 1000 * 40
};

const CONSTANTS = {
    DIRECTIONS: {
        UP: Math.PI * (0 / 2),
        LEFT: -Math.PI * (1 / 2),
        DOWN: Math.PI * (2 / 2),
        RIGHT: -Math.PI * (3 / 2)
    },
    MOVEMENT: {
        UP: 1,
        LEFT: 2,
        DOWN: 3,
        RIGHT: 4
    }
};

app.use(express.static(__dirname + '/client'));

const PORT = process.env.PORT || config.PORT;
httpServer.listen(PORT, function () {
    console.log(`HTTP server started on port ${PORT}.`);
});

function randomUint32ID(listOfObjects, usedIDsList) {
    // the items in the first array must have an .id property for this to work
    let newID = crypto.randomBytes(4).readUInt32BE(0, true);
    while (listOfObjects.find(object => object.id === newID) && usedIDsList.find(id => id === newID)) {
        newID = crypto.randomBytes(4).readUInt32BE(0, true);
    }

    usedIDsList.push(newID);
    return newID;
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

    websocket.player = game.createHumanPlayer();

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
                    { type: 'Float32', value: websocket.player.z },
                    { type: 'Float32', value: websocket.player.angle },
                    { type: 'Int8', value: 1 } // player type and not an NPC type
                ]), websocket);
            }

            // a player has requested map data such as players
            if (data.type === 'request_map_data') {
                // send list of players and NPCs
                game.characters.forEach(character => {
                    transmit(createBinaryFrame(4, [
                        { type: 'Uint32', value: character.id },
                        { type: 'Float32', value: character.x },
                        { type: 'Float32', value: character.z },
                        { type: 'Float32', value: character.angle },
                        { type: 'Int8', value: character.isHumanPlayer ? 1 : 0 } // 1 if is a player and 0 if an NPC
                    ]), websocket);
                });
            }
        }

        if (message instanceof ArrayBuffer) {
            const client_dataview = new DataView(message);

            // player wants to shoot a projectile
            if (client_dataview.getUint8(0) === 2) {
                const player = websocket.player;
                if (player.isAlive) {
                    const projectile = {
                        x: player.x,
                        z: player.z,
                        angle: player.angle,
                        speed: 3,
                        creationTime: Date.now(),
                        owner: player.id,
                        collisionBoxSize: 3
                    };
                    game.projectiles.push(projectile);
                    game.addDelayedBroadcast(createBinaryFrame(5, [
                        { type: 'Float32', value: projectile.x },
                        { type: 'Float32', value: projectile.z },
                        { type: 'Float32', value: projectile.angle },
                        { type: 'Float32', value: projectile.speed },
                        { type: 'Uint32', value: projectile.owner }
                    ]));
                }
            }

            // player wants to move
            if (client_dataview.getUint8(0) === 3) {
                const player = websocket.player;
                player.move(client_dataview.getUint8(1));
            }
        }
    });

    websocket.on('close', () => {
        game.characters.splice(game.characters.indexOf(websocket.player), 1);
        broadcast(createBinaryFrame(6, [{ type: 'Uint32', value: websocket.player.id }]), websocket);
    });

    websocket.on('pong', () => websocket.isAlive = true);
});

class Game {
    constructor() {
        this.characters = [];
        this.mapSize = config.mapSize; // width and height
        this.delayedBroadcasts = [];
        this.delayedTransmitPlayers = [];
        this.combat = {
            attacks: []
        };
        this.npcs = []; // can create a retrieve NPCs Game class method
        this.projectiles = [];
        // used IDs
        this.usedCharacterIDs = [];
        this.usedCollectibleIDs = [];

        for (let i = 0; i < 3; i++) {
            this.createNPC();
        }
    }

    createHumanPlayer() {
        return new Player(this);
    }

    createNPC() {
        return new NPC(this);
    }

    physicsLoop() {
        // projectile movement
        this.projectiles.forEach(projectile => {
            projectile.x += Math.sin(projectile.angle) * projectile.speed;
            projectile.z += Math.cos(projectile.angle) * projectile.speed;
        });

        // player and NPC movement
        this.characters.filter(character => {
            return character.isMoving;
        })
            .filter(character => { // collision detection with the map boundary
                if (character.angle === CONSTANTS.DIRECTIONS.UP) {
                    if (character.z + (character.collisionBoxSize / 2) + character.movement_speed > this.mapSize) {
                        character.isMoving = false;
                        return false;
                    }
                } else if (character.angle === CONSTANTS.DIRECTIONS.LEFT) {
                    if (character.x - (character.collisionBoxSize / 2) - character.movement_speed < 0) {
                        character.isMoving = false;
                        return false;
                    }
                } else if (character.angle === CONSTANTS.DIRECTIONS.DOWN) {
                    if (character.z - (character.collisionBoxSize / 2) - character.movement_speed < 0) {
                        character.isMoving = false;
                        return false;
                    }
                } else if (character.angle === CONSTANTS.DIRECTIONS.RIGHT) {
                    if (character.x + (character.collisionBoxSize / 2) + character.movement_speed > this.mapSize) {
                        character.isMoving = false;
                        return false;
                    }
                }

                return true;
            })
            .forEach(character => {
                character.x += Math.sin(character.angle) * character.movement_speed;
                character.z += Math.cos(character.angle) * character.movement_speed;
                character.isMoving = false;
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
        this.projectiles.forEach(projectile => {
            this.characters.forEach(character => {
                if (projectile.owner !== character.id && character.isAlive === true && AABBCollision(projectile, character)) {
                    character.health -= 1;

                    this.projectiles.splice(this.projectiles.indexOf(projectile), 1);
                }
            });
        });

        // NPC loop
        this.characters.filter(character => {
            return (!character.isHumanPlayer && character.isAlive);
        })
            .forEach(npc => {
                npc.run();
            });
    }

    sendNetworkUpdates() {
        // send player and NPC orientations
        const orientations = [];
        orientations.push({ type: 'Uint16', value: this.characters.length });
        this.characters.forEach(character => {
            orientations.push({ type: 'Uint32', value: character.id });
            orientations.push({ type: 'Float32', value: character.x });
            orientations.push({ type: 'Float32', value: character.z });
            orientations.push({ type: 'Float32', value: character.angle });
        });
        broadcast(createBinaryFrame(1, orientations));

        // send character healths
        const healths = [];
        healths.push({ type: 'Uint16', value: this.characters.length });
        this.characters.forEach(character => {
            healths.push({ type: 'Uint32', value: character.id });
            healths.push({ type: 'Int32', value: character.health });
        });
        broadcast(createBinaryFrame(9, healths));

        // delayed broadcasts
        this.delayedBroadcasts.forEach(delayedMessage => {
            this.delayedBroadcasts.splice(this.delayedBroadcasts.indexOf(delayedMessage), 1);
            broadcast(delayedMessage.data, delayedMessage.exception);
        });

        // delayed transmitPlayers
        this.delayedTransmitPlayers.forEach(delayedMessage => {
            this.delayedTransmitPlayers.splice(this.delayedTransmitPlayers.indexOf(delayedMessage), 1);
            transmitPlayer(delayedMessage.data, delayedMessage.player);
        });
    }

    addDelayedBroadcast(data, exception = null) {
        this.delayedBroadcasts.push({ data: data, exception: exception });
    }

    addDelayedTransmitPlayer(data, player) {
        this.delayedTransmitPlayers.push({ data: data, player: player });
    }
}

class Character {
    /**
     * Base class for characters, human and NPC.
     * @param {Game} game Game instance
     * @param {boolean} isHumanPlayer true for human player and false for NPC
     */
    constructor(game, isHumanPlayer) {
        this.game = game;
        this.id = randomUint32ID(game.characters, game.usedCharacterIDs);
        this.isHumanPlayer = isHumanPlayer;

        // collision
        this.collisionBoxSize = config.character.collisionBoxSize;

        // initial orientation
        this.x = Math.random() * (game.mapSize - this.collisionBoxSize);
        this.z = Math.random() * (game.mapSize - this.collisionBoxSize);
        this.angle = CONSTANTS.DIRECTIONS.DOWN; // facing south. it doesn't have to be zero

        // movement
        this.movement_speed = config.character.defaultMovementSpeed;
        this.isMoving = false;

        this.health = 100; // has to be a signed 32-bit integer for negative health values

        this.isAlive = true;
        this.deathTime = 0;

        this.combat = {}; // cooldowns, etc.

        this.level = 1;

        game.characters.push(this);
    }

    /**
     * moves up, left, down, or right
     * @param {Number} direction 1 = up, 2 = left, 3 = down, 4 = right
     */
    move(direction) {
        if (this.isAlive) { // will need to do additional checks for stuff like stuns. collision detection will be handled outside this function and thus by the collision detection routine
            switch (direction) {
                case CONSTANTS.MOVEMENT.UP:
                    this.angle = CONSTANTS.DIRECTIONS.UP;
                    break;
                case CONSTANTS.MOVEMENT.LEFT:
                    this.angle = CONSTANTS.DIRECTIONS.LEFT;
                    break;
                case CONSTANTS.MOVEMENT.DOWN:
                    this.angle = CONSTANTS.DIRECTIONS.DOWN;
                    break;
                case CONSTANTS.MOVEMENT.RIGHT:
                    this.angle = CONSTANTS.DIRECTIONS.RIGHT;
                    break;
            }

            this.isMoving = true;
        }
    }

    /**
     * moves to a specific location. will need to add collision checking that accounts for collision box sizes on collision
     * @param {Number} x The target location's x coordinate
     * @param {Number} z The target location's z coordinate
     * @param {Number} distanceThreshold how far from the target
     */
    moveTo(x, z, distanceThreshold = 3) {
        const movementDistanceThreshold = this.movement_speed; // how far from an axis
        if (Math.abs(x - this.x) > distanceThreshold || Math.abs(z - this.z) > distanceThreshold) { // has not yet arrived at target location
            if (Math.abs(x - this.x) > movementDistanceThreshold) {
                if (this.x - x > 0) {
                    this.move(CONSTANTS.MOVEMENT.LEFT);
                } else {
                    this.move(CONSTANTS.MOVEMENT.RIGHT);
                }
            } else if (Math.abs(z - this.z) > movementDistanceThreshold) {
                if (this.z - z > 0) {
                    this.move(CONSTANTS.MOVEMENT.DOWN);
                } else {
                    this.move(CONSTANTS.MOVEMENT.UP);
                }
            }
        }
    }
}

class NPC extends Character {
    constructor(game) {
        super(game, false);

        this.aggroTable = []; // a list of player-aggro pairs (.player and .aggro object names)
        this.aggroRadius = 10;
        this.movement_speed = 0.9;

        this.leashLocation = { x: this.x, z: this.z };
        this.leashRadius = 40;
        this.isReseting = false;
    }

    // NPC aggro initiation/human player detection by NPC
    aggroScan() {
        if (this.aggroTable.length === 0) { // if not aggroed already
            this.game.characters.filter(character => {
                return (character.isHumanPlayer && character.isAlive);
            })
                .forEach(humanPlayer => {
                    if (pointInCircleCollision(humanPlayer, this, this.aggroRadius)) {
                        this.aggroTable.push({ player: humanPlayer, aggro: 10 });
                        this.game.addDelayedTransmitPlayer(createBinaryFrame(2, [{ type: 'Uint32', value: this.id }]), humanPlayer); // only display the aggro icon on detection and not when the player initiates the fight
                    }
                });
        }
    }

    // NPC chases a target
    pursue() {
        // determine who has the highest aggro
        let maximumAggro = 0;
        let target = this.aggroTable[0].player; // would need to deal with players who decreased their enemity
        this.aggroTable.forEach(aggroPair => {
            if (aggroPair.aggro > maximumAggro) {
                maximumAggro = aggroPair.aggro;
                target = aggroPair.player;
            }
        });

        // chase the target with the highest aggro
        this.moveTo(target.x, target.z);
    }

    // loop function
    run() {
        // if the NPC is outside its leashing bounds, reset
        if (!pointInCircleCollision(this, this.leashLocation, this.leashRadius)) {
            this.isReseting = true;
            this.aggroTable = [];
            this.movement_speed = 3;
        }

        if (!this.isReseting) {
            // remove players that are dead or don't exist anymore
            this.aggroTable.forEach(aggroPair => {
                if (!this.game.characters.includes(aggroPair.player) || !aggroPair.player.isAlive) {
                    this.aggroTable.splice(this.aggroTable.indexOf(aggroPair), 1);
                }
            });

            if (this.aggroTable.length !== 0) { // if aggroed
                // pursue players with aggro
                this.pursue();
            } else { // else if not aggroed
                this.aggroScan();
            }
        } else {
            if (!pointInCircleCollision(this, this.leashLocation, this.leashRadius * (1 / 10))) {
                this.moveTo(this.leashLocation.x, this.leashLocation.z);
            } else {
                this.isReseting = false;

                // have to find a way to organize this for specific mobs
                this.movement_speed = 0.9;
                this.health = 100;
            }
        }
    }
}

class Player extends Character {
    constructor(game) {
        super(game, true);

        this.score = 0;
    }
}

/**
 * Performs point in cicle collision detection. `point` and `circle` can be a character or other type of object. Each must have `.x` and `.z` member variables.
 * @param {*} point The point to check for. Must have `.x` and `.z` coordinate members.
 * @param {*} circle Provides the center of the circle. Must have `.x` and `.z` coordinate members.
 * @param {Number} circleRadius The radius of the circle.
 * @return `true` if the point collides with the circle, `false` otherwise. 
 */
function pointInCircleCollision(point, circle, circleRadius) {
    if (Math.sqrt(Math.pow(point.x - circle.x, 2) + Math.pow(point.z - circle.z, 2)) <= circleRadius) {
        return true;
    } else {
        return false;
    }
}

/**
 * Axis-aligned bounding boxes collision detection between two objects with an optional extension prediction.
 * @param {*} a The first object to check for. Must have `.x`, `.z`, and `.collisionBoxSize` members. Can have an extension for collision prediction with the parameter `a_extension`.
 * @param {*} b The second object to check for. Must have `.x`, `.z`, and `.collisionBoxSize` members.
 * @param {*} a_extension Used for predictions. Must have `.x` and `.z` members. If the axis has no extension, then it should be `0`.
 * @return `true` if collison has been detected, `false` otherwise.
 */
function AABBCollision(a, b, a_extension = { x: 0, z: 0 }) {
    return (a.x - (a.collisionBoxSize / 2) + a_extension.x <= b.x + (b.collisionBoxSize / 2) && a.x + (a.collisionBoxSize / 2) + a_extension.x >= b.x - (b.collisionBoxSize / 2)) &&
        (a.z - (a.collisionBoxSize / 2) + a_extension.z <= b.z + (b.collisionBoxSize / 2) && a.z + (a.collisionBoxSize / 2) + a_extension.z >= b.z - (b.collisionBoxSize / 2));
}

const game = new Game();

setInterval(function () {
    game.physicsLoop();
}, config.physicsTickRate);
setInterval(function () {
    game.gameLogicLoop();
}, config.physicsTickRate);
setInterval(function () {
    game.sendNetworkUpdates();
}, config.networkUpdatePulseRate);

// ping-pong heartbeat
setInterval(function () {
    ws_server.clients.forEach(websocket => {
        if (websocket.isAlive === false) {
            game.characters.splice(game.characters.indexOf(websocket.player), 1);
            broadcast(createBinaryFrame(6, [{ type: 'Uint32', value: websocket.player.id }]), websocket);
            return websocket.terminate();
        }

        websocket.isAlive = false;
        if (websocket.readyState === WebSocket.OPEN) {
            websocket.ping();
        }
    });
}, config.pingTime);