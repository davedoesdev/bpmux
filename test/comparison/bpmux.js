/* eslint-env node */
/* eslint brace-style: "error" */
// BPMux exerts backpressure on individual streams so a stream which doesn't
// read its data doesn't starve the other streams.

const fs = require('fs');
const net = require('net');
const { BPMux } = require('../..');

require('net').createServer(c => {
    new BPMux(c).on('handshake', stream => {
        stream.on('data', function (d) {
            console.log('data', stream._chan, d.length);
            if (stream._chan === 0) {
                this.pause();
            }
        });
    });
}).listen(7000, () => {
    const mux = new BPMux(net.createConnection(7000));

    const stream1 = mux.multiplex();
    const stream2 = mux.multiplex();

    fs.createReadStream('/dev/urandom').pipe(stream1);
    fs.createReadStream('/dev/urandom').pipe(stream2);
});
