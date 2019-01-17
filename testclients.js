const WebSocket = require('ws');

class Client {
    constructor(send_rate) {
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
                let arraybuffer = new ArrayBuffer(2);
                let dataview = new DataView(arraybuffer);
                dataview.setUint8(0, 1);
                dataview.setUint8(1, Math.floor(Math.random() * (4 + 1)));
                this.websocket.send(dataview);
                //console.log(`Client ${this.id} sent random movement direction.`);

                // shoot in a random direction in radians
                arraybuffer = new ArrayBuffer(5);
                dataview = new DataView(arraybuffer);
                dataview.setUint8(0, 2);
                dataview.setFloat32(1, Math.floor(Math.random() * (2 * Math.PI + 1)));
                this.websocket.send(dataview);
                //console.log(`Client ${this.id} sent random projectile.`);
            }
        }, send_rate);
    }
}

const send_rate = 800;
const clients = 10;

console.log(`${clients} clients connecting at a send rate of ${send_rate}.`);

for (let i = 0; i < clients; i++) {
    new Client(send_rate);
}