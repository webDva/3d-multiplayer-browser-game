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
    networkUpdatePulseRate: 10,
    physicsTickRate: 30,
    character: {
        defaultMovementSpeed: 1,
        collisionBoxSize: 3
    },
    mapSize: 100,
    pingTime: 40
};

const CONSTANTS = {
    DIRECTIONS: {
        UP: Math.PI * (0 / 2),
        LEFT: -Math.PI * (1 / 2),
        DOWN: Math.PI * (2 / 2),
        RIGHT: -Math.PI * (3 / 2)
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
                        position: {
                            x: player.x,
                            z: player.z,
                        },
                        angle: player.angle,
                        speed: 3,
                        creationTime: Date.now(),
                        owner: player.id
                    };
                    game.projectiles.push(projectile);
                    game.networkUpdates.combat.newProjectiles.push(projectile);
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
            projectile.position.x += Math.sin(projectile.angle) * projectile.speed;
            projectile.position.z += Math.cos(projectile.angle) * projectile.speed;
        });

        // player and NPC movement
        this.characters.filter(character => {
            return character.isMoving;
        })
            .filter(character => { // collision detection
                // for now, there is no collision detection
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
            this.characters.filter(character => {
                if (projectile.owner !== character.id && character.isAlive === true) return true;
            })
                .forEach(character => {
                    // no collision for now
                    //this.projectiles.splice(this.projectiles.indexOf(projectile), 1);
                });
        });

        // NPC aggro initiation/human player detection by NPC
        this.characters.filter(character => {
            return (!character.isHumanPlayer && character.isAlive);
        })
            .forEach(npc => {
                if (npc.aggroTable.length === 0) { // if not aggroed already
                    this.characters.filter(character => {
                        return (character.isHumanPlayer && character.isAlive);
                    })
                        .forEach(humanPlayer => {
                            if (Math.sqrt(Math.pow(npc.x - humanPlayer.x, 2) + Math.pow(npc.z - humanPlayer.z, 2)) <= npc.aggroRadius) {
                                npc.aggroTable.push({ player: humanPlayer, aggro: 10 });
                                transmitPlayer(createBinaryFrame(2, [{ type: 'Uint32', value: npc.id }]), humanPlayer); // only display the aggro icon on detection and not when the player initiates the fight
                            }
                        });
                }
            });

        // NPC chases a target
        this.characters.filter(character => {
            return (!character.isHumanPlayer && character.isAlive);
        })
            .filter(npc => {
                // remove players that are dead or don't exist anymore
                npc.aggroTable.forEach(aggroPair => {
                    if (!this.characters.includes(aggroPair.player) || !aggroPair.player.isAlive) {
                        npc.aggroTable.splice(npc.aggroTable.indexOf(aggroPair), 1);
                    }
                });

                return npc.aggroTable.length !== 0;
            })
            .forEach(npc => {
                // determine who has the highest aggro
                let maximumAggro = 0;
                let target = npc.aggroTable[0].player; // would need to deal with players who decreased their enemity
                npc.aggroTable.forEach(aggroPair => {
                    if (aggroPair.aggro > maximumAggro) {
                        maximumAggro = aggroPair.aggro;
                        target = aggroPair.player;
                    }
                });

                // chase the target with the highest aggro
                npc.moveTo(target.x, target.z);
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

        // new projectiles
        if (this.networkUpdates.combat.newProjectiles.length > 0) {
            const projectiles = [];
            projectiles.push({ type: 'Uint16', value: this.networkUpdates.combat.newProjectiles.length });
            this.networkUpdates.combat.newProjectiles.forEach(projectile => {
                projectiles.push({ type: 'Float32', value: projectile.position.x });
                projectiles.push({ type: 'Float32', value: projectile.position.z });
                projectiles.push({ type: 'Float32', value: projectile.angle });
                projectiles.push({ type: 'Float32', value: projectile.speed });
                projectiles.push({ type: 'Uint32', value: projectile.owner });
                this.networkUpdates.combat.newProjectiles.splice(this.networkUpdates.combat.newProjectiles.indexOf(projectile), 1);
            });
            broadcast(createBinaryFrame(5, projectiles));
        }
    }
}

class Character {
    /**
     * Base class for characters, human and NPC.
     * @param {Game} game Game instance
     * @param {boolean} isHumanPlayer true for human player and false for NPC
     */
    constructor(game, isHumanPlayer) {
        this.id = randomUint32ID(game.characters, game.usedCharacterIDs);
        this.isHumanPlayer = isHumanPlayer;

        // initial orientation
        this.x = Math.random() * game.mapSize;
        this.z = Math.random() * game.mapSize;
        this.angle = CONSTANTS.DIRECTIONS.DOWN; // facing south. it doesn't have to be zero

        // movement
        this.movement_speed = config.character.defaultMovementSpeed;
        this.isMoving = false;

        // collision
        this.box = null; // empty for now

        this.health = 100; // has to be a signed 32-bit integer for negative health values

        this.isAlive = true;
        this.deathTime = 0;

        this.combat = {}; // cooldowns, etc.   

        game.characters.push(this);
    }

    /**
     * moves up, left, down, or right
     * @param {Number} direction 1 = up, 2 = left, 3 = down, 4 = right
     */
    move(direction) {
        if (this.isAlive) { // will need to do additional checks for stuff like stuns
            switch (direction) {
                case 1:
                    this.angle = CONSTANTS.DIRECTIONS.UP;
                    break;
                case 2:
                    this.angle = CONSTANTS.DIRECTIONS.LEFT;
                    break;
                case 3:
                    this.angle = CONSTANTS.DIRECTIONS.DOWN;
                    break;
                case 4:
                    this.angle = CONSTANTS.DIRECTIONS.RIGHT;
                    break;
            }

            this.isMoving = true;
        }
    }

    /**
     * moves to a specific location. will need to add collision checking that accounts for collision box sizes on collision
     * @param {*} x 
     * @param {*} z 
     * @param {*} distanceThreshold how far from the target
     * @param {*} movementDistanceThreshold how many "pixels" from an axis
     */
    moveTo(x, z, distanceThreshold = 3, movementDistanceThreshold = 1) {
        if (Math.abs(x - this.x) > distanceThreshold || Math.abs(z - this.z) > distanceThreshold) {
            if (Math.abs(x - this.x) > movementDistanceThreshold) {
                if (this.x - x > 0) {
                    this.move(2);
                } else {
                    this.move(4);
                }
            } else if (Math.abs(z - this.z) > movementDistanceThreshold) {
                if (this.z - z > 0) {
                    this.move(3);
                } else {
                    this.move(1);
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
        this.movement_speed = 0.1;

        this.leashLocation = { x: this.x, z: this.z };
    }
}

class Player extends Character {
    constructor(game) {
        super(game, true);
    }
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
            game.characters.splice(game.characters.indexOf(websocket.player), 1);
            broadcast(createBinaryFrame(6, [{ type: 'Uint32', value: websocket.player.id }]), websocket);
            return websocket.terminate();
        }

        websocket.isAlive = false;
        if (websocket.readyState === WebSocket.OPEN) {
            websocket.ping();
        }
    });
}, 1000 * config.pingTime);