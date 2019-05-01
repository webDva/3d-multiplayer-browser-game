const WebSocket = require('uws');
const env = require('./env.json')[process.env.NODE_ENV || 'development'];

console.log(`Using ${env.testUrl} as the test target URL.`);

class Client {
    constructor(move_rate) {
        this.session_started = false;

        this.websocket = new WebSocket(env.testUrl);
        this.websocket.binaryType = 'arraybuffer';

        this.websocket.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                const dataview = new DataView(event.data);
                if (dataview.getUint8(0) === 3) {
                    this.session_started = true;
                    connected++;
                    console.log(`${connected} clients connected.`);
                    if (connected == clients) {
                        console.log(`All ${clients} clients connected at target URL ${env.testUrl} with a move rate of ${move_rate}.`);
                    }
                }
            }
        }

        this.websocket.onopen = () => {
            this.websocket.send(JSON.stringify({ type: 'join', class: Math.floor(Math.random() * 3 + 1) }));
        };

        setInterval(() => {
            if (this.session_started) {
                // move in a random direction
                let arraybuffer = new ArrayBuffer(2);
                let dataview = new DataView(arraybuffer);
                dataview.setUint8(0, 3);
                dataview.setUint8(1, Math.floor(Math.random() * (4 - 1 + 1) + 1));
                this.websocket.send(dataview);

                // shoot
                arraybuffer = new ArrayBuffer(2);
                dataview = new DataView(arraybuffer);
                dataview.setUint8(0, 2);
                dataview.setUint8(1, 1);
                this.websocket.send(dataview);
            }
        }, move_rate);
    }
}

const clients = (process.argv.length > 2) ? process.argv[2] : 20;
const move_rate = (process.argv.length > 3) ? process.argv[3] : 2500;
// node testclients.js [clients_no] [move_rate_no]
// for production: NODE_ENV=production node testclients.js [clients_no] [move_rate_no]

let connected = 0;

console.log(`${clients} clients connecting at a move rate of ${move_rate}.`);

for (let i = 0; i < clients; i++) {
    new Client(move_rate);
}