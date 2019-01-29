const express = require('express');
const app = express();
const httpServer = require('http').Server(app);
const WebSocket = require('ws');
const ws_server = new WebSocket.Server({ server: httpServer });
const path = require('path');
const uuidv4 = require('uuid/v4');

const config = require('./config');

app.use(express.static(path.join(__dirname, './client')));

const PORT = process.env.PORT || config.PORT;
httpServer.listen(PORT, function () {
    console.log('listening on port ' + PORT);
});

function notify_all_clients(data, exception = null) {
    ws_server.clients.forEach(client => {
        if (client !== exception && client.readyState === WebSocket.OPEN)
            client.send(data);
    });
}

ws_server.on('connection', (websocket) => {
    websocket.binaryType = 'arraybuffer';
    websocket.isAlive = true; // create this property for the sake of implementing ping-pong heartbeats

    websocket.player = game.addPlayer();

    websocket.on('message', (message) => {
        let arraybuffer, server_dataview;

        if (typeof message === 'string') {
            const data = JSON.parse(message);

            if (data.type === 'join') {
                let players_list = [];
                game.players.forEach(user => {
                    players_list.push({
                        id: user.id,
                        x: user.x,
                        y: user.y,
                        direction: user.direction
                    });
                });
                websocket.send(JSON.stringify({
                    type: 'welcome',
                    id: websocket.player.id,
                    player_list: players_list,
                    spells: game.spells
                }));
                // notify the rest of the room of the new player
                notify_all_clients(JSON.stringify({
                    type: 'new_player',
                    id: websocket.player.id,
                    x: websocket.player.x,
                    y: websocket.player.y,
                    direction: websocket.player.direction
                }), websocket);
            }
        }

        if (message instanceof ArrayBuffer) {
            const client_dataview = new DataView(message);

            if (client_dataview.getUint8(0) === 1) { // player movement
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

            if (client_dataview.getUint8(0) === 3) { // player is attacking someone or something
                const player = websocket.player;
                const target = client_dataview.getUint32(1); // player ID or mob ID
                const attack = client_dataview.getUint8(5); // attack type or ID, an unsigned byte
                const player_spell = player.spells.find(spell => spell.attackNumber === attack);
                if (player_spell.amount > 0) {
                    player_spell.amount--;
                    game.combat.attacks.push({ attacker: player.id, target: target, attack: attack });
                }
            }
        }
    });

    websocket.on('close', () => {
        game.players.splice(game.players.indexOf(websocket.player), 1);
        notify_all_clients(JSON.stringify({
            type: 'player_disconnect',
            id: websocket.player.id
        }), websocket);
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

        // spawn ten spell attack 1 consumables
        this.spells = [];
        for (let i = 0; i < 10; i++) {
            this.spells.push({
                x: Math.floor(Math.random() * (this.mapSize + 1)),
                y: Math.floor(Math.random() * (this.mapSize + 1)),

                //collision
                width: 3,
                height: 3,

                attackNumber: 1,
                id: i // for now
            });
        }
    }

    addPlayer() {
        let id = new Uint32Array(uuidv4(null, Buffer.from(new Uint32Array(1)), 0).buffer, 0, 1)[0];
        while (this.players.find(player => player.id === id)) {
            id = new Uint32Array(uuidv4(null, Buffer.from(new Uint32Array(1)), 0).buffer, 0, 1)[0];
        }
        const player = {
            id: id,

            // physics movement and initial starting position
            x: Math.floor(Math.random() * (this.mapSize + 1)),
            y: Math.floor(Math.random() * (this.mapSize + 1)),
            movement_speed: config.player.defaultMovementSpeed,

            // collision
            width: config.player.collisionWidth,
            height: config.player.collisionHeight,

            direction: 0, // direction for attacking and avatar facing, in radians

            // for click-to-move
            velocityX: 0,
            velocityY: 0,
            targetX: 0,
            targetY: 0,
            isMoving: false,

            // Int32Array, 4 bytes, 32-bit two's complement signed integer
            // won't be sent to the player for now
            health: 100,

            isAlive: true,
            deathTime: 0,

            spells: [{ attackNumber: 0, amount: 0 }, { attackNumber: 0, amount: 0 }, { attackNumber: 0, amount: 0 }]
        };
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
                if (this.isColliding(player, spell)) {
                    const player_spell = player.spells.find(s => s.attackNumber === spell.attackNumber);
                    if (player_spell) {
                        player_spell.amount++;
                    } else {
                        player.spells.push({ attackNumber: spell.attackNumber, amount: 1 });
                    }
                    this.spells.splice(this.spells.indexOf(spell), 1);
                    ws_server.clients.forEach(client => {
                        if (client.player === player && client.readyState === WebSocket.OPEN)
                            client.send(JSON.stringify({ type: 'new_spell', attackNumber: spell.attackNumber }));
                    });
                    notify_all_clients(JSON.stringify({ type: 'spell_collected', id: spell.id }));
                }
            });
        });

        // combat attacks
        this.combat.attacks.forEach(attack => {
            this.networkUpdates.combat.attacks.push(attack);
            this.combat.attacks.splice(this.combat.attacks.indexOf(attack), 1);
        });
    }

    sendNetworkUpdates() {
        let arraybuffer, dataview;

        // send player orientations
        arraybuffer = new ArrayBuffer(1 + 1 + this.players.length * (4 + 4 + 4 + 4));
        dataview = new DataView(arraybuffer);
        dataview.setUint8(0, 1); // one byte unsigned event/message type
        dataview.setUint8(1, this.players.length); // number of player binary data structures
        this.players.forEach((player, index) => {
            dataview.setUint32(2 + index * 16, player.id);
            dataview.setFloat32(6 + index * 16, player.x);
            dataview.setFloat32(10 + index * 16, player.y);
            dataview.setFloat32(14 + index * 16, player.direction);
        });
        notify_all_clients(dataview);

        this.networkUpdates.combat.attacks.forEach(attack => {
            arraybuffer = new ArrayBuffer(1 + 4 + 4 + 1);
            dataview = new DataView(arraybuffer);
            dataview.setUint8(0, 2);
            dataview.setUint32(1, attack.attacker);
            dataview.setUint32(5, attack.target);
            dataview.setUint8(9, attack.attack);
            notify_all_clients(dataview);
            this.networkUpdates.combat.attacks.splice(this.networkUpdates.combat.attacks.indexOf(attack), 1);
        });
    }

    isColliding(object1, object2) {
        if (object1.x < object2.x + object2.width &&
            object1.x + object1.width > object2.x &&
            object1.y < object2.y + object2.height &&
            object1.y + object1.height > object2.y) {
            return true;
        } else {
            return false;
        }
    }
}

const game = new Game();

setInterval(() => {
    game.physicsLoop();
}, 1000 / config.physicsTickRate);
setInterval(() => {
    game.gameLogicLoop();
}, 1000 / config.physicsTickRate);
setInterval(() => {
    game.sendNetworkUpdates();
}, 1000 / config.networkUpdatePulseRate);

// ping-pong heartbeat
setInterval(() => {
    ws_server.clients.forEach(websocket => {
        if (websocket.isAlive === false) {
            game.players.splice(game.players.indexOf(websocket.player), 1);
            notify_all_clients(JSON.stringify({
                type: 'player_disconnect',
                id: websocket.player.id
            }), websocket);
            return websocket.terminate();
        }

        websocket.isAlive = false;
        websocket.ping(); // show stopping error can occur here
    });
}, 40000);