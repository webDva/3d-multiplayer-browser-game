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

            if (client_dataview.getUint8(0) === 1) { // player's movement direction
                game.processPlayerDirection(websocket.player, client_dataview.getFloat32(1), client_dataview.getFloat32(5), client_dataview.getFloat32(9), client_dataview.getFloat32(13));
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
        this.mapSize = 100; // width and height
        this.orbs = []; // array of orbs that enable a player to have new units
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
            movement_speed: 0.1,
            direction: 0, // direction to move in, in radians

            // Int32Array, 4 bytes, 32-bit two's complement signed integer
            // won't be sent to the player for now
            health: 100,

            isAlive: true,
            deathTime: 0,

            units: [] // array of units under this player's control
        };
        this.players.push(player);
        return player;
    }

    physicsLoop() {
        // as the players are always moving, move the players
        // note: dead players logic must be handled and changed
        this.players.filter(player => { return player.isAlive })
            .forEach(player => {
                player.x += player.movement_speed * Math.cos(player.direction);
                player.y += player.movement_speed * Math.sin(player.direction);

                // move the player's units too
                player.units.forEach(unit => {
                    unit.x += player.movement_speed * Math.cos(player.direction);
                    unit.y += player.movement_speed * Math.sin(player.direction);
                });
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

        // players collect orbs
        this.orbs.forEach(orb => {
            this.players.filter(player => {
                if (player.isAlive === true) return true;
            })
                .forEach(player => {
                    if (Math.sqrt(Math.pow(player.x - orb.x, 2) + Math.pow(player.y - orb.y, 2)) <= 5) {
                        this.orbs.splice(this.orbs.indexOf(orb), 1); // remove the orb
                        // spawn a new unit for the player
                        const new_unit = {
                            x: player.x + Math.floor(Math.random() * (10 + 1)),
                            y: player.y + Math.floor(Math.random() * (10 + 1))
                        };
                        player.units.push(new_unit);
                        // notify all the players of the new unit
                        arraybuffer = new ArrayBuffer(1 + 4 + 4 + 4);
                        dataview = new DataView(arraybuffer);
                        dataview.setUint8(0, 6);
                        dataview.setUint32(1, player.id);
                        dataview.setFloat32(5, new_unit.x);
                        dataview.setFloat32(9, new_unit.y);
                        ws_server.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN)
                                client.send(dataview);
                        });
                    }
                });
        });

        // spawn new unit orbs that can give a player new units
        const new_unit_orb = {
            x: Math.floor(Math.random() * (this.mapSize + 1)),
            y: Math.floor(Math.random() * (this.mapSize + 1))
        };
        this.orbs.push(new_unit_orb);
        // notify all the players of the new orb
        arraybuffer = new ArrayBuffer(1 + 4 + 4); // [message_id, x (32-bit float), y (32-bit float)]
        dataview = new DataView(arraybuffer);
        dataview.setUint8(0, 5);
        dataview.setFloat32(1, new_unit_orb.x);
        dataview.setFloat32(5, new_unit_orb.y);
        ws_server.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN)
                client.send(dataview);
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

        // send the positions of the units of the players
        this.players.forEach(player => {
            if (player.units.length < 1)
                return;
            arraybuffer = new ArrayBuffer(1 + 1 + 4 + player.units.length * (4 + 4));
            dataview = new DataView(arraybuffer);
            dataview.setUint8(0, 7);
            dataview.setUint8(1, player.units.length);
            dataview.setUint32(2, player.id);
            player.units.forEach((unit, unit_index) => {
                dataview.setFloat32(6 + unit_index * 4, unit.x);
                dataview.setFloat32(10 + unit_index * 4, unit.y);
            });
            ws_server.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN)
                    client.send(dataview);
            });
        });
    }

    processPlayerDirection(player, player_position_x, player_position_y, input_position_x, input_position_y) {
        player.direction = Math.atan2(input_position_y - player_position_y, input_position_x, player_position_x);
    }
}

const game = new Game();

setInterval(() => { // run physics loop at 60 times a second
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