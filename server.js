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
                        y: user.y
                    });
                });
                websocket.send(JSON.stringify({
                    type: 'welcome',
                    id: websocket.player.id,
                    player_list: players_list
                }));
                // notify the rest of the room of the new player
                ws_server.clients.forEach(client => {
                    if (client !== websocket && client.readyState === WebSocket.OPEN)
                        client.send(JSON.stringify({
                            type: 'new_player',
                            id: websocket.player.id,
                            x: websocket.player.x,
                            y: websocket.player.y
                        }));
                });
            }
        }

        if (message instanceof ArrayBuffer) {
            const client_dataview = new DataView(message);

            if (client_dataview.getUint8(0) === 1) { // player movement
                const direction = client_dataview.getUint8(1); // direction to move in (left:1, up:2, right:3, down:4)
                const player = websocket.player;
                if (direction === 1) {
                    player.isMoving = direction;
                } else if (direction === 2) {
                    player.isMoving = direction;
                } else if (direction === 3) {
                    player.isMoving = direction;
                } else if (direction === 4) {
                    player.isMoving = direction;
                }
            }

            if (client_dataview.getUint8(0) === 2) { // player shoots a projectile
                const player = websocket.player;
                const direction = client_dataview.getFloat32(1);
                if (player.isAlive) {
                    const projectile = {
                        x: player.x,
                        y: player.y,
                        direction: direction,
                        movement_speed: config.projectile.defaultMovementSpeed,
                        width: config.projectile.defaultWidth,
                        height: config.projectile.defaultHeight,
                        creation_time: Date.now(),
                        owner: player.id
                    };
                    game.projectiles.push(projectile);
                    game.new_projectiles.push(projectile);
                }
            }
        }
    });

    websocket.on('close', () => {
        game.players.splice(game.players.indexOf(websocket.player), 1);
        ws_server.clients.forEach(client => {
            if (client !== websocket && client.readyState === WebSocket.OPEN)
                client.send(JSON.stringify({
                    type: 'player_disconnect',
                    id: websocket.player.id
                }));
        });
    });

    websocket.on('pong', () => websocket.isAlive = true);
});

class Game {
    constructor() {
        this.players = [];
        this.projectiles = [];
        this.new_projectiles = [];
        this.mapSize = 100; // width and height
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

            // false for not moving, 1 for left, 2 for up, 3 for right, 4 for down
            // can be changed to binary bits
            isMoving: false,

            direction: 0, // direction for shooting and avatar facing, in radians

            // Int32Array, 4 bytes, 32-bit two's complement signed integer
            // won't be sent to the player for now
            health: 100,

            isAlive: true,
            deathTime: 0
        };
        this.players.push(player);
        return player;
    }

    physicsLoop() {
        // projectile movement
        this.projectiles.forEach(projectile => {
            projectile.x += projectile.movement_speed * Math.cos(projectile.direction);
            projectile.y += projectile.movement_speed * Math.sin(projectile.direction);
        });

        // player movement
        this.players.filter(player => {
            return player.isMoving;
        })
            .filter(player => { // collision detection
                // for now, there is no collision detection
                return true;
            })
            .forEach(player => {
                if (player.isMoving === 1) {
                    player.x -= player.movement_speed;
                } else if (player.isMoving === 2) {
                    player.y -= player.movement_speed;
                } else if (player.isMoving === 3) {
                    player.x += player.movement_speed;
                } else if (player.isMoving === 4) {
                    player.y += player.movement_speed;
                }
                player.isMoving = false;
            });
    }

    gameLogicLoop() {
        let arraybuffer, dataview;

        // remove projectiles that have exceeded their lifetime of 3000 milliseconds
        this.projectiles.forEach(projectile => {
            if (Date.now() - projectile.creation_time >= config.projectile.defaultLifetime) {
                this.projectiles.splice(this.projectiles.indexOf(projectile), 1);
            }
        });

        // projectile-player collisions
        this.projectiles.forEach(projectile => {
            this.players.filter(player => {
                if (projectile.owner !== player.id && player.isAlive === true)
                    return true;
            })
                .forEach(player => {
                    // no collision for now
                });
        });

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
    }

    sendNetworkUpdates() {
        let arraybuffer, dataview;

        // send player positions
        arraybuffer = new ArrayBuffer(1 + 1 + this.players.length * (4 + 4 + 4));
        dataview = new DataView(arraybuffer);
        dataview.setUint8(0, 1); // one byte unsigned event/message type
        dataview.setUint8(1, this.players.length); // number of player binary data structures
        this.players.forEach((player, index) => {
            dataview.setUint32(2 + index * 12, player.id);
            dataview.setFloat32(6 + index * 12, player.x);
            dataview.setFloat32(10 + index * 12, player.y);

        });
        ws_server.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN)
                client.send(dataview);
        });

        // send newly created projectiles
        let new_projectiles = [];
        this.new_projectiles.forEach(projectile => {
            new_projectiles.push(projectile);
            this.new_projectiles.splice(this.new_projectiles.indexOf(projectile), 1);
        });
        arraybuffer = new ArrayBuffer(1 + 2 + new_projectiles.length * (4 + 4 + 4 + 4 + 4));
        dataview = new DataView(arraybuffer);
        dataview.setUint8(0, 2);
        dataview.setUint16(1, new_projectiles.length);
        new_projectiles.forEach((projectile, index) => {
            dataview.setFloat32(3 + index * 20, projectile.x);
            dataview.setFloat32(7 + index * 20, projectile.y);
            dataview.setFloat32(11 + index * 20, projectile.direction);
            dataview.setUint32(15 + index * 20, projectile.movement_speed);
            dataview.setUint32(19 + index * 20, projectile.owner);
        });
        if (new_projectiles.length > 0) {
            ws_server.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN)
                    client.send(dataview);
            });
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
            ws_server.clients.forEach(client => {
                if (client !== websocket && client.readyState === WebSocket.OPEN)
                    client.send(JSON.stringify({
                        type: 'player_disconnect',
                        id: websocket.player.id
                    }));
            });
            return websocket.terminate();
        }

        websocket.isAlive = false;
        websocket.ping();
    });
}, 40000);