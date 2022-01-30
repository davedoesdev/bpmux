/*eslint-env node */
/*eslint brace-style: "error" */
const fs = require('fs');
const http2 = require('http2');

const server = http2.createServer();
server.on('stream', (stream, headers) => {
    stream.on('data', function (d) {
        console.log('data', headers[':path'], d.length);
        if (headers[':path'] === '/stream1') {
            this.pause();
        }
    });
});
server.listen(8000);

const client = http2.connect('http://localhost:8000');

const stream1 = client.request({ ':path': '/stream1' }, { endStream: false });
const stream2 = client.request({ ':path': '/stream2' }, { endStream: false });

fs.createReadStream('/dev/urandom').pipe(stream1);
fs.createReadStream('/dev/urandom').pipe(stream2);

