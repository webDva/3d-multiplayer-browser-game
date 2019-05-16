const express = require('express');
const app = express();
const httpServer = require('http').Server(app);
const WebSocket = require('uws');
const crypto = require('crypto');
const fs = require('fs');

const minify = require('@node-minify/core');
const gcc = require('@node-minify/google-closure-compiler');
const htmlMinifier = require('@node-minify/html-minifier');
const cleanCSS = require('@node-minify/clean-css');

const util = require('./client/shared/util.js');

const createBinaryFrame = util.createBinaryFrame;
const AABBCollision = util.AABBCollision;

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
        defaultSpeed: 1,
        collisionBoxSize: 2, // a square
        defaultStats: {
            maxHealth: 10,
            attack: 10,
            defense: 10,
            crit: 0.1
        }
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
    },

    CLASS_NUMBERS: {
        MAGE: 1,
        WARRIOR: 2,
        ARCHER: 3
    }
};

const CLASSES = {

    MAGE: {
        number: CONSTANTS.CLASS_NUMBERS.MAGE,
        stats: {
            maxHealth: config.character.defaultStats.maxHealth * 0.5,
            attack: config.character.defaultStats.attack * 2,
            defense: config.character.defaultStats.defense * 0.9,
            crit: config.character.defaultStats.crit * 1.1
        },
        attackA: function (player) {
            if (player.isAlive && Date.now() - player.combat.attackATime > 800) {
                const projectile = {
                    x: player.x,
                    z: player.z,
                    angle: player.angle,
                    speed: 3,
                    creationTime: Date.now(),
                    owner: player.id,
                    collisionBoxSize: 1,
                    baseDamage: 10,
                    type: null
                };
                player.game.projectiles.push(projectile);
                player.combat.attackATime = Date.now();
                player.game.addDelayedBroadcast(createBinaryFrame(5, [
                    { type: 'Uint8', value: 11 }, // mage class 1 attack 1
                    { type: 'Float32', value: projectile.x },
                    { type: 'Float32', value: projectile.z },
                    { type: 'Float32', value: projectile.angle },
                    { type: 'Float32', value: projectile.speed },
                    { type: 'Uint32', value: projectile.owner }
                ]));
            }
        },
        attackB: function (player) { }
    },

    WARRIOR: {
        number: CONSTANTS.CLASS_NUMBERS.WARRIOR,
        stats: {
            maxHealth: config.character.defaultStats.maxHealth * 2.5,
            attack: config.character.defaultStats.attack * 0.3,
            defense: config.character.defaultStats.defense * 2,
            crit: config.character.defaultStats.crit * 1.2
        },
        attackA: function (player) {
            if (player.isAlive && Date.now() - player.combat.attackATime > 800) {
                player.game.characters.filter(character => {
                    return character !== player && pointInCircleCollision(character, player, 10);
                })
                    .forEach(character => {
                        character.takeDamage(calculateDamage(player.stats.attack, character.stats.defense, Math.floor(Math.random() * (8 - 1 + 1) + 1), player.stats.crit), player);
                    });

                player.combat.attackATime = Date.now();

                player.game.addDelayedBroadcast(createBinaryFrame(5, [
                    { type: 'Uint8', value: 21 }, // warrior class 2 attack 1
                    { type: 'Uint32', value: player.id }
                ]));
            }
        },
        attackB: function (player) { }
    },

    ARCHER: {
        number: CONSTANTS.CLASS_NUMBERS.ARCHER,
        stats: {
            maxHealth: config.character.defaultStats.maxHealth * 1.4,
            attack: config.character.defaultStats.attack * 1.1,
            defense: config.character.defaultStats.defense * 1.5,
            crit: config.character.defaultStats.crit * 5 + 2
        },
        attackA: function (player) {
            if (player.isAlive && Date.now() - player.combat.attackATime > 800) {
                const archerProjectiles = [];
                for (let i = 0; i < 3; i++) {
                    archerProjectiles.push({
                        x: player.x,
                        z: player.z,
                        angle: player.angle + (Math.PI * (1 / 8) * i) - (Math.PI * (1 / 8)),
                        speed: 5,
                        creationTime: Date.now(),
                        owner: player.id,
                        collisionBoxSize: 2,
                        baseDamage: 1,
                        type: null
                    });
                }

                archerProjectiles.forEach(projectile => {
                    player.game.projectiles.push(projectile);
                    player.game.addDelayedBroadcast(createBinaryFrame(5, [
                        { type: 'Uint8', value: 31 }, // archer class 1 attack 1
                        { type: 'Float32', value: projectile.x },
                        { type: 'Float32', value: projectile.z },
                        { type: 'Float32', value: projectile.angle },
                        { type: 'Float32', value: projectile.speed },
                        { type: 'Uint32', value: projectile.owner }
                    ]));
                });

                player.combat.attackATime = Date.now();
            }
        },
        attackB: function (player) { }
    }
};

app.use(express.static(__dirname + '/client'));

const PORT = process.env.PORT || config.PORT;
httpServer.listen(PORT, function () {
    console.log(`HTTP server started on port ${PORT}.`);
});

const firstNames = fs.readFileSync('./usernames/first.txt').toString().split('\n');
const secondNames = fs.readFileSync('./usernames/second.txt').toString().split('\n');

function stringToArrayBuffer(string) {
    const arraybuffer = new Uint8Array(string.length);
    for (let i = 0; i < string.length; i++) {
        arraybuffer[i] = string.charCodeAt(i);
    }
    return arraybuffer;
}

function randomUint32ID(listOfObjects, usedIDsList) {
    // the items in the first array must have an .id property for this to work
    let newID = crypto.randomBytes(4).readUInt32BE(0, true);
    while (listOfObjects.find(object => object.id === newID) && usedIDsList.find(id => id === newID)) {
        newID = crypto.randomBytes(4).readUInt32BE(0, true);
    }

    usedIDsList.push(newID);
    return newID;
}

function transmit(data, websocket) {
    if (websocket.readyState === WebSocket.OPEN)
        websocket.send(data);
}

class Game {
    constructor() {
        this.characters = [];
        this.mapSize = config.mapSize; // width and height
        this.delayedBroadcasts = [];
        this.delayedTransmitPlayers = [];
        this.combat = {
            attacks: []
        };
        this.projectiles = [];
        // used IDs
        this.usedCharacterIDs = [];
        this.usedCollectibleIDs = [];

        // begin websocket server definition

        this.ws_server = new WebSocket.Server({ server: httpServer });

        this.ws_server.on('connection', websocket => {
            websocket.isAlive = true; // create this property for the sake of implementing ping-pong heartbeats

            websocket.on('message', message => {
                if (typeof message === 'string') {
                    const data = JSON.parse(message);

                    if (data.type === 'join') {
                        websocket.player = this.createHumanPlayer(data.class);
                        websocket.player.websocket = websocket; // for removing a player when their Player object is known

                        // send welcome message. the player's id
                        transmit(createBinaryFrame(3, [
                            { type: 'Uint32', value: websocket.player.id },
                            { type: 'Float32', value: websocket.player.maxExperiencePoints }
                        ]), websocket);

                        // notify the rest of the room of the new player
                        const message = [
                            { type: 'Uint32', value: websocket.player.id },
                            { type: 'Float32', value: websocket.player.x },
                            { type: 'Float32', value: websocket.player.z },
                            { type: 'Float32', value: websocket.player.angle },
                            { type: 'Int8', value: 1 }, // player type and not an NPC type
                            { type: 'Uint32', value: websocket.player.stats.maxHealth },
                            { type: 'Uint8', value: websocket.player.class.number },
                            { type: 'Uint8', value: websocket.player.binaryName.length }
                        ];
                        for (let i = 0; i < websocket.player.binaryName.length; i++) {
                            message.push({ type: 'Uint8', value: websocket.player.binaryName[i] });
                        }
                        this.broadcast(createBinaryFrame(4, message), websocket);
                    }

                    // a player has requested map data such as players
                    if (data.type === 'request_map_data') {
                        // send list of players and NPCs
                        this.characters.forEach(character => {
                            const message = [
                                { type: 'Uint32', value: character.id },
                                { type: 'Float32', value: character.x },
                                { type: 'Float32', value: character.z },
                                { type: 'Float32', value: character.angle },
                                { type: 'Int8', value: character.isHumanPlayer ? 1 : 0 }, // 1 if is a player and 0 if an NPC
                                { type: 'Uint32', value: character.stats.maxHealth },
                                { type: 'Uint8', value: character.isHumanPlayer ? character.class.number : 0 }
                            ];
                            if (character.isHumanPlayer) {
                                message.push({ type: 'Uint8', value: character.binaryName.length });
                                for (let i = 0; i < character.binaryName.length; i++) {
                                    message.push({ type: 'Uint8', value: character.binaryName[i] });
                                }
                            }
                            transmit(createBinaryFrame(4, message), websocket);
                        });
                    }
                }

                if (message instanceof ArrayBuffer) {
                    const client_dataview = new DataView(message);

                    // player wants to shoot a projectile
                    if (client_dataview.getUint8(0) === 2) {
                        websocket.player.attack(client_dataview.getUint8(1));
                    }

                    // player wants to move
                    if (client_dataview.getUint8(0) === 3) {
                        const player = websocket.player;
                        player.move(client_dataview.getUint8(1));
                    }
                }
            });

            websocket.on('close', () => {
                if (this.characters.find(character => character === websocket.player)) {
                    this.characters.splice(this.characters.indexOf(websocket.player), 1);
                    this.broadcast(createBinaryFrame(6, [{ type: 'Uint32', value: websocket.player.id }]), websocket);
                }
            });

            websocket.on('pong', () => websocket.isAlive = true);
        });

        // end of websocket server definition

        // ping-pong heartbeat
        setInterval(() => {
            this.ws_server.clients.forEach(websocket => {
                if (websocket.isAlive === false) {
                    return websocket.terminate();
                }

                websocket.isAlive = false;
                if (websocket.readyState === WebSocket.OPEN) {
                    websocket.ping();
                }
            });
        }, config.pingTime);

        // intervals

        setInterval(() => {
            this.physicsLoop();
        }, config.physicsTickRate);

        setInterval(() => {
            this.gameLogicLoop();
        }, config.physicsTickRate);

        setInterval(() => {
            this.sendNetworkUpdates();
        }, config.networkUpdatePulseRate);

        // end intervals

        // create NPCs
        for (let i = 0; i < 3; i++) {
            this.createNPC();
        }
    }

    createHumanPlayer(classSelection) {
        switch (classSelection) {
            case CONSTANTS.CLASS_NUMBERS.MAGE:
                return new Player(this, CLASSES.MAGE);
            case CONSTANTS.CLASS_NUMBERS.WARRIOR:
                return new Player(this, CLASSES.WARRIOR);
            case CONSTANTS.CLASS_NUMBERS.ARCHER:
                return new Player(this, CLASSES.ARCHER);
            default:
                return new Player(this, CLASSES.MAGE);
        }
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
                    if (character.z + (character.collisionBoxSize / 2) + character.speed > this.mapSize) {
                        character.isMoving = false;
                        return false;
                    }
                } else if (character.angle === CONSTANTS.DIRECTIONS.LEFT) {
                    if (character.x - (character.collisionBoxSize / 2) - character.speed < 0) {
                        character.isMoving = false;
                        return false;
                    }
                } else if (character.angle === CONSTANTS.DIRECTIONS.DOWN) {
                    if (character.z - (character.collisionBoxSize / 2) - character.speed < 0) {
                        character.isMoving = false;
                        return false;
                    }
                } else if (character.angle === CONSTANTS.DIRECTIONS.RIGHT) {
                    if (character.x + (character.collisionBoxSize / 2) + character.speed > this.mapSize) {
                        character.isMoving = false;
                        return false;
                    }
                }

                return true;
            })
            .forEach(character => {
                character.x += Math.sin(character.angle) * character.speed;
                character.z += Math.cos(character.angle) * character.speed;
                character.isMoving = false;
            });
    }

    gameLogicLoop() {
        // remove expired projectiles
        this.projectiles.forEach(projectile => {
            if (Date.now() - projectile.creationTime > 3000) {
                this.projectiles.splice(this.projectiles.indexOf(projectile), 1);
            }
        });

        // projectile-player collisions
        this.projectiles.forEach(projectile => {
            this.characters.forEach(character => {
                if (projectile.owner !== character.id && character.isAlive && AABBCollision(projectile, character)) {
                    const attacker = this.characters.find(potentialAttacker => potentialAttacker.id === projectile.owner);
                    if (attacker) {
                        character.takeDamage(calculateDamage(attacker.stats.attack, character.stats.defense, projectile.baseDamage, attacker.stats.crit), attacker);
                    }

                    // should use a for loop instead
                    this.projectiles.splice(this.projectiles.indexOf(projectile), 1);
                }
            });
        });

        // dead characters handling system
        this.characters.filter(character => {
            if (character.health <= 0) {
                character.isAlive = false;
                return true;
            }
        })
            .forEach(character => {
                const totalDamage = character.damageTable.reduce((accumulator, currentPair) => accumulator + currentPair.damage, 0);
                character.damageTable.forEach(damagePair => {
                    const player = damagePair.player;
                    const rewardPercentage = damagePair.damage / totalDamage;
                    const reward = ((character.level / player.level) * ((character.isHumanPlayer) ? 1.5 : 1)) * rewardPercentage;

                    player.experiencePoints += reward;

                    if (player.experiencePoints >= player.maxExperiencePoints) {
                        const leftOverXP = player.experiencePoints - player.maxExperiencePoints;
                        player.level += 1;
                        player.experiencePoints = leftOverXP;
                        player.maxExperiencePoints = (player.level + 1) * Math.log(player.level + 1);
                        this.addDelayedTransmitPlayer(createBinaryFrame(11, [
                            { type: 'Float32', value: reward },
                            { type: 'Uint8', value: player.level },
                            { type: 'Float32', value: leftOverXP },
                            { type: 'Float32', value: player.maxExperiencePoints }
                        ]), player);
                    } else {
                        this.addDelayedTransmitPlayer(createBinaryFrame(11, [
                            { type: 'Float32', value: reward },
                            { type: 'Uint8', value: 0 },
                            { type: 'Float32', value: 0 },
                            { type: 'Float32', value: 0 }
                        ]), player);
                    }
                });

                if (character.isHumanPlayer) {
                    this.addDelayedBroadcast(createBinaryFrame(6, [{ type: 'Uint32', value: character.id }]), character.websocket);
                    this.addDelayedTransmitPlayer(createBinaryFrame(8, []), character);
                    this.characters.splice(this.characters.indexOf(character), 1);
                } else {
                    character.reset();
                }
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
        this.broadcast(createBinaryFrame(1, orientations));

        // send character healths
        const healths = [];
        healths.push({ type: 'Uint16', value: this.characters.length });
        this.characters.forEach(character => {
            healths.push({ type: 'Uint32', value: character.id });
            healths.push({ type: 'Int32', value: character.health });
        });
        this.broadcast(createBinaryFrame(9, healths));

        // delayed broadcasts
        this.delayedBroadcasts.forEach(delayedMessage => {
            this.delayedBroadcasts.splice(this.delayedBroadcasts.indexOf(delayedMessage), 1);
            this.broadcast(delayedMessage.data, delayedMessage.exception);
        });

        // delayed transmitPlayers
        this.delayedTransmitPlayers.forEach(delayedMessage => {
            this.delayedTransmitPlayers.splice(this.delayedTransmitPlayers.indexOf(delayedMessage), 1);
            transmit(delayedMessage.data, delayedMessage.player.websocket);
        });
    }

    addDelayedBroadcast(data, exception = null) {
        this.delayedBroadcasts.push({ data: data, exception: exception });
    }

    addDelayedTransmitPlayer(data, player) {
        this.delayedTransmitPlayers.push({ data: data, player: player });
    }

    broadcast(data, exception = null) {
        this.ws_server.clients.forEach(client => {
            if (client !== exception && client.readyState === WebSocket.OPEN)
                client.send(data);
        });
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
        this.x = Math.random() * (this.game.mapSize - this.collisionBoxSize);
        this.z = Math.random() * (this.game.mapSize - this.collisionBoxSize);
        this.angle = CONSTANTS.DIRECTIONS.DOWN; // facing south. it doesn't have to be zero

        // movement
        this.speed = config.character.defaultSpeed;
        this.isMoving = false;

        this.stats = config.character.defaultStats;
        this.health = this.stats.maxHealth; // has to be a signed 32-bit integer for negative health values

        this.isAlive = true;
        this.deathTime = 0;

        this.combat = {}; // cooldowns, etc.

        this.level = 1;

        // table of damage recieved by other characters. for distributing experience points and scores. a list of pairs with .player and .damage members
        this.damageTable = [];

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
     * @return {boolean} `true` if is moving, `false` if not moving
     */
    moveTo(x, z, distanceThreshold = 5) {
        const movementDistanceThreshold = this.speed; // how far from an axis
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

            return true;
        }

        return false;
    }

    reset() {
        this.angle = CONSTANTS.DIRECTIONS.DOWN;
        this.isMoving = false;
        this.speed = config.character.defaultSpeed;
        this.stats = config.character.defaultStats;
        this.health = this.stats.maxHealth;
        this.isAlive = true;
        this.combat = {};
        this.x = Math.random() * (this.game.mapSize - this.collisionBoxSize);
        this.z = Math.random() * (this.game.mapSize - this.collisionBoxSize);
        this.damageTable = [];
    }

    takeDamage(damage, attacker) {
        this.health -= damage;

        if (attacker.isHumanPlayer) {
            const damagePair = this.damageTable.find(damagePair => damagePair.player === attacker);
            if (damagePair) {
                damagePair.damage += damage;
            } else {
                this.damageTable.push({ player: attacker, damage: damage });
            }

            this.game.addDelayedTransmitPlayer(createBinaryFrame(7, [
                { type: 'Uint8', value: 0 }, // damage done by the attacking player
                { type: 'Uint32', value: damage },
                { type: 'Uint32', value: this.id } // target to display damage text above
            ]), attacker);
        }

        if (this.isHumanPlayer) {
            this.game.addDelayedTransmitPlayer(createBinaryFrame(7, [
                { type: 'Uint8', value: 1 }, // damage done to the player
                { type: 'Uint32', value: damage }
            ]), this);
        } else {
            const aggroPair = this.aggroTable.find(aggroPair => aggroPair.player === attacker);
            if (aggroPair) {
                aggroPair.aggro += damage;
            } else {
                this.aggroTable.push({ player: attacker, aggro: damage });
            }
        }
    }
}

class NPC extends Character {
    constructor(game) {
        super(game, false);

        this.aggroTable = []; // a list of player-aggro pairs (.player and .aggro object names)
        this.aggroRadius = 10;
        this.speed = 0.7;

        this.leashLocation = { x: this.x, z: this.z };
        this.leashRadius = 40;
        this.isDeaggroing = false;

        this.combat.attackTime = 0;
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
        if (this.moveTo(target.x, target.z)) {
            // NPC-NPC collision detection and anti-overlapping
            this.game.characters.filter(character => {
                return (!character.isHumanPlayer && character.isAlive && character !== this);
            })
                .forEach(fellowNPC => {
                    if (AABBCollision(this, fellowNPC, { x: this.speed, z: this.speed })) {
                        // the mobile NPC will move to the left or right of the fellow NPC
                        this.angle += (Math.random() < 0.5 ? -1 : 1) * (Math.PI * (1 / 2));
                    }
                });
        } else { // attack the player
            if (Date.now() - this.combat.attackTime > 2000) {
                this.combat.attackTime = Date.now();
                target.takeDamage(1, this);
                this.game.addDelayedBroadcast(createBinaryFrame(10, [{ type: 'Uint32', value: this.id }]));
            }
        }
    }

    // loop function
    run() {
        // if the NPC is outside its leashing bounds, reset
        if (!pointInCircleCollision(this, this.leashLocation, this.leashRadius)) {
            this.isDeaggroing = true;
            this.aggroTable = [];
            this.speed = 3;
        }

        if (!this.isDeaggroing) {
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
            if (this.moveTo(this.leashLocation.x, this.leashLocation.z)) {
                this.moveTo(this.leashLocation.x, this.leashLocation.z);
            } else {
                this.isDeaggroing = false;

                // have to find a way to organize this for specific mobs
                this.speed = 0.9;
                this.health = this.stats.maxHealth;
            }
        }
    }

    reset() {
        super.reset();

        this.aggroTable = [];
        this.speed = 0.9;
        this.leashLocation = { x: this.x, z: this.z };
        this.isDeaggroing = false;

        this.combat.attackTime = 0;
    }
}

class Player extends Character {
    constructor(game, characterClass) {
        super(game, true);

        this.score = 0;
        this.experiencePoints = 0;
        this.maxExperiencePoints = (this.level + 1) * Math.log(this.level + 1);

        this.class = characterClass;
        this.stats = this.class.stats;
        this.health = this.stats.maxHealth;
        this.combat.attackATime = this.combat.attackBTime = 0;

        let firstName = firstNames[parseInt(Math.random() * firstNames.length)];
        firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
        let secondName = secondNames[parseInt(Math.random() * secondNames.length)];
        secondName = secondName.charAt(0).toUpperCase() + secondName.slice(1);
        this.name = firstName + secondName + Math.floor(Math.random() * 9999 + 1).toString();
        this.binaryName = stringToArrayBuffer(this.name);
    }

    attack(number) { // 1 (A) or 2 (B)
        switch (number) {
            case 1:
                return this.class.attackA(this);
            case 2:
                return this.class.attackB(this);
        }
    }
}

function calculateDamage(attack, defense, baseDamage, critChance) {
    return Math.round((attack / defense) * baseDamage * ((Math.random() < critChance) ? 1.5 : 1)) || 1;
}

/**
 * Performs point in cicle collision detection. `point` and `circle` can be a character or other type of object. Each must have `.x` and `.z` member variables.
 * @param {*} point The point to check for. Must have `.x` and `.z` coordinate members.
 * @param {*} circle Provides the center of the circle. Must have `.x` and `.z` coordinate members.
 * @param {Number} circleRadius The radius of the circle.
 * @return `true` if the point collides with the circle, `false` otherwise. 
 */
function pointInCircleCollision(point, circle, circleRadius) {
    return Math.sqrt(Math.pow(point.x - circle.x, 2) + Math.pow(point.z - circle.z, 2)) <= circleRadius;
}

const game = new Game();