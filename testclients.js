const WebSocket = require('ws');

class Client {
    constructor(move_rate) {
        this.session_started = false;

        this.websocket = new WebSocket('ws://localhost:3000');
        //this.websocket = new WebSocket('https://privatebuild.herokuapp.com');
        this.websocket.binaryType = 'arraybuffer';

        this.websocket.onmessage = (event) => {
            if (typeof event.data === 'string') {
                const data = JSON.parse(event.data);

                if (data.type === 'welcome') {
                    this.session_started = true;
                }
            }
        }

        this.websocket.onopen = () => {
            this.websocket.send(JSON.stringify({ type: 'join' }));
        };

        setInterval(() => {
            if (this.session_started) {
                // move in a random direction
                const arraybuffer = new ArrayBuffer(9);
                const dataview = new DataView(arraybuffer);
                dataview.setUint8(0, 1);
                const max = 100;
                const min = -100;
                dataview.setFloat32(1, Math.floor(Math.random() * (max - min + 1) + min));
                dataview.setFloat32(5, Math.floor(Math.random() * (max - min + 1) + min));
                this.websocket.send(dataview);
            }
        }, move_rate);
    }
}

const move_rate = 2500;
const clients = 20;

console.log(`${clients} clients connecting at a move rate of ${move_rate}.`);

for (let i = 0; i < clients; i++) {
    new Client(move_rate);
}