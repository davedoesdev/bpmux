/* eslint-env node */
/* eslint brace-style: "error" */
// Uses https://github.com/maxogden/multiplex (npm install multiplex)
// Backpressure is exerted across the multiplex as a whole, not individual streams.
// This means a stream which doesn't read its data starves the other streams.

const fs = require('fs');
const net = require('net');
const multiplex = require('multiplex');

require('net').createServer(c => {
    c.pipe(multiplex((stream, id) => {
        stream.on('data', function(d) {
            console.log('data', id, d.length);
            if (id === '0') {
                this.pause();
            }
        });
    }));
}).listen(7000, () => {
    const plex = multiplex();
    plex.pipe(net.createConnection(7000));

    const stream1 = plex.createStream();
    const stream2 = plex.createStream();

    fs.createReadStream('/dev/urandom').pipe(stream1);
    fs.createReadStream('/dev/urandom').pipe(stream2);
});
