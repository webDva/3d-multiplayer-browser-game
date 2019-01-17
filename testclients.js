const WebSocket = require('ws');

class Client {
    constructor(move_rate, shoot_rate) {
        this.session_started = false;

        this.websocket = new WebSocket('ws://localhost:3000');
        this.websocket.binaryType = 'arraybuffer';

        this.websocket.onmessage = (event) => {
            if (typeof event.data === 'string') {
                const data = JSON.parse(event.data);

                if (data.type === 'welcome') {
                    this.session_started = true;
                    this.id = data.id;
                    //console.log(`Client connected as ${this.id}`);
                }
            }
        }

        this.websocket.onopen = () => {
            this.websocket.send(JSON.stringify({ type: 'join' }));
        };

        setInterval(() => {
            if (this.session_started) {
                // move in a random direction
                const arraybuffer = new ArrayBuffer(2);
                const dataview = new DataView(arraybuffer);
                dataview.setUint8(0, 1);
                dataview.setUint8(1, Math.floor(Math.random() * (4 + 1)));
                this.websocket.send(dataview);
                //console.log(`Client ${this.id} sent random movement direction.`);
            }
        }, move_rate);

        const minimum = shoot_rate - 15000;
        setInterval(() => {
            if (this.session_started) {
                // shoot in a random direction in radians
                const arraybuffer = new ArrayBuffer(5);
                const dataview = new DataView(arraybuffer);
                dataview.setUint8(0, 2);
                dataview.setFloat32(1, Math.floor(Math.random() * (2 * Math.PI + 1)));
                this.websocket.send(dataview);
                //console.log(`Client ${this.id} sent random projectile.`);   
            }
        }, Math.floor(Math.random() * (shoot_rate - minimum + 1) + minimum));
    }
}

const move_rate = 200;
const shoot_rate = 30000; // must be greater than 15000
const clients = 20;

console.log(`${clients} clients connecting at a move rate of ${move_rate} and a shoot rate of ${shoot_rate - 15000} to ${shoot_rate}.`);

for (let i = 0; i < clients; i++) {
    new Client(move_rate, shoot_rate);
}