const express = require('express');
const app = express();
const httpServer = require('http').Server(app);
const WebSocket = require('uws');
const ws_server = new WebSocket.Server({ server: httpServer });
const path = require('path');
const crypto = require('crypto');

const config = require('./config');

app.use(express.static(path.join(__dirname, './client')));

const PORT = process.env.PORT || config.PORT;
httpServer.listen(PORT, function () {
    console.log('listening on port ' + PORT);
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
                    { type: 'Float32', value: websocket.player.direction }
                ]), websocket);
            }

            // a player has requested map data such as players and spells on the map
            if (data.type === 'request_map_data') {
                // send list of players
                game.players.forEach(player => {
                    transmit(createBinaryFrame(4, [
                        { type: 'Uint32', value: player.id },
                        { type: 'Float32', value: player.x },
                        { type: 'Float32', value: player.y },
                        { type: 'Float32', value: player.direction }
                    ]), websocket);
                });

                // send the spells of the map to the player
                game.spells.forEach(spell => {
                    transmit(createBinaryFrame(5, [
                        { type: 'Uint32', value: spell.id },
                        { type: 'Uint8', value: spell.attackNumber },
                        { type: 'Float32', value: spell.x },
                        { type: 'Float32', value: spell.y }
                    ]), websocket);
                });
            }
        }

        if (message instanceof ArrayBuffer) {
            const client_dataview = new DataView(message);

            // player movement
            if (client_dataview.getUint8(0) === 1) {
                const player = websocket.player;
                player.isMoving = true;
                // change the player's direction
                player.direction = Math.atan2(client_dataview.getFloat32(5) - player.y, client_dataview.getFloat32(1) - player.x);
                // change the player's target destination
                player.targetX = client_dataview.getFloat32(1);
                player.targetY = client_dataview.getFloat32(5);
                // change the player's velocity
                player.velocityX = Math.cos(player.direction) * player.movement_speed;
                player.velocityY = Math.sin(player.direction) * player.movement_speed;
            }

            // player is attacking someone or something
            if (client_dataview.getUint8(0) === 3) {
                const player = websocket.player;
                const target = client_dataview.getUint32(1); // player ID or mob ID
                const attack = client_dataview.getUint8(5); // attack type or ID, an unsigned byte
                const player_spell = player.spells.find(spell => spell.attackNumber === attack);
                if (player_spell && player_spell.amount > 0) {
                    player_spell.amount--;
                    game.combat.attacks.push({ attacker: player.id, target: target, attack: attack });
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
            },
            spells: {
                spawned: [],
                collected: [] // an object of the spell and the player to give them their new spell
            }
        };
        this.combat = {
            attacks: []
        };
        this.spells = [];
    }

    createSpell() {
        let id = randomUint32();
        while (this.spells.find(spell => spell.id === id)) {
            id = randomUint32();
        }
        const spell = {
            x: Math.floor(Math.random() * (this.mapSize + 1)),
            y: Math.floor(Math.random() * (this.mapSize + 1)),

            attackNumber: Math.floor(Math.random() * (2 - 1 + 1) + 1), // two spells for now
            id: id
        };

        this.spells.push(spell);
        this.networkUpdates.spells.spawned.push(spell);
    }

    addPlayer() {
        let id = randomUint32();
        while (this.players.find(player => player.id === id)) {
            id = randomUint32();
        }
        const player = {
            id: id,

            // physics movement and initial starting position
            x: Math.floor(Math.random() * (this.mapSize + 1)),
            y: Math.floor(Math.random() * (this.mapSize + 1)),
            movement_speed: config.player.defaultMovementSpeed,

            // collision
            radius: config.player.radius,

            direction: 0, // direction for attacking and avatar facing, in radians

            // for click-to-move
            velocityX: 0,
            velocityY: 0,
            targetX: 0,
            targetY: 0,
            isMoving: false,

            health: 100, // has to be a signed 32-bit integer for negative health values

            isAlive: true,
            deathTime: 0,

            spells: []
        };

        for (let i = 1; i <= 3; i++) { // three spells for now
            player.spells.push({ attackNumber: i, amount: 0 });
        }

        this.players.push(player);
        return player;
    }

    physicsLoop() {
        // player movement
        this.players.filter(player => {
            return player.isMoving;
        })
            .filter(player => { // collision detection
                // for now, there is no collision detection
                return true;
            })
            .forEach(player => {
                const threshold = 1;
                if (Math.abs(player.x - player.targetX) <= threshold && Math.abs(player.y - player.targetY) <= threshold) {
                    player.velocityX = 0;
                    player.velocityY = 0;
                    player.isMoving = false;
                } else {
                    player.x += player.movement_speed * Math.cos(player.direction);
                    player.y += player.movement_speed * Math.sin(player.direction);
                }
            });
    }

    gameLogicLoop() {
        let arraybuffer, dataview;

        // respawn players and notify the connected players
        // leaving this alone for now. it's so behind.
        this.players.filter(player => {
            if (!player.isAlive && Date.now() - player.deathTime >= 5000)
                return true;
        })
            .forEach(player => {
                player.isAlive = true;
                player.x = 0;
                player.y = 0;
                player.health = 100;

                // notify all players that the player has respawned
                arraybuffer = new ArrayBuffer(1 + 4);
                dataview = new DataView(arraybuffer);
                dataview.setUint8(0, 4);
                dataview.setUint32(1, player.id);
                ws_server.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN)
                        client.send(dataview);
                });
            });

        // player collects spell consumables
        this.players.forEach(player => {
            // is this legal checks would need to be performed here

            this.spells.forEach(spell => {
                if (pointCircleCollision(spell, player)) {
                    const player_spell = player.spells.find(s => s.attackNumber === spell.attackNumber);
                    player_spell.amount++;
                    this.spells.splice(this.spells.indexOf(spell), 1);
                    this.networkUpdates.spells.collected.push({ spell: spell, player: player });
                }
            });
        });

        // combat attacks
        this.combat.attacks.forEach(attack => {
            this.networkUpdates.combat.attacks.push(attack);
            this.combat.attacks.splice(this.combat.attacks.indexOf(attack), 1);
        });

        // spawn a spell
        if (this.spells.length < config.spellPerPlayer * this.players.length) {
            this.createSpell();
        }
    }

    sendNetworkUpdates() {
        // send player orientations
        let orientations = [];
        orientations.push({ type: 'Uint8', value: this.players.length });
        this.players.forEach(player => {
            orientations.push({ type: 'Uint32', value: player.id });
            orientations.push({ type: 'Float32', value: player.x });
            orientations.push({ type: 'Float32', value: player.y });
            orientations.push({ type: 'Float32', value: player.direction });
        });
        broadcast(createBinaryFrame(1, orientations));

        // send player healths
        let healths = [];
        healths.push({ type: 'Uint8', value: this.players.length });
        this.players.forEach(player => {
            healths.push({ type: 'Uint32', value: player.id });
            healths.push({ type: 'Int32', value: player.health });
        });
        broadcast(createBinaryFrame(9, healths));

        // send attacks that players performed
        this.networkUpdates.combat.attacks.forEach(attack => {
            broadcast(createBinaryFrame(2, [
                { type: 'Uint32', value: attack.attacker },
                { type: 'Uint32', value: attack.target },
                { type: 'Uint8', value: attack.attack }
            ]));
            this.networkUpdates.combat.attacks.splice(this.networkUpdates.combat.attacks.indexOf(attack), 1);
        });

        // send spells that have spawned
        this.networkUpdates.spells.spawned.forEach(spell => {
            broadcast(createBinaryFrame(5, [
                { type: 'Uint32', value: spell.id },
                { type: 'Uint8', value: spell.attackNumber },
                { type: 'Float32', value: spell.x },
                { type: 'Float32', value: spell.y }
            ]));
            this.networkUpdates.spells.spawned.splice(this.networkUpdates.spells.spawned.indexOf(spell), 1);
        });

        // send updates on spells that are now gone from the map
        this.networkUpdates.spells.collected.forEach(spell_object => {
            broadcast(createBinaryFrame(7, [{ type: 'Uint32', value: spell_object.spell.id }]));
            transmitPlayer(createBinaryFrame(8, [{ type: 'Uint8', value: spell_object.spell.attackNumber }]), spell_object.player);
            this.networkUpdates.spells.collected.splice(this.networkUpdates.spells.collected.indexOf(spell_object), 1);
        });
    }
}

function pointCircleCollision(point, circle) {
    if (Math.sqrt(Math.pow(point.x - circle.x, 2) + Math.pow(point.y - circle.y, 2)) <= circle.radius) {
        return true;
    } else {
        return false;
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