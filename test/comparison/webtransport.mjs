/*eslint-env node */
/*eslint brace-style: "error" */
import { createReadStream } from 'fs';
import { Writable } from 'stream';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { X509Certificate } from 'crypto';
import { Http3Server, WebTransport } from '@fails-components/webtransport';

const certs_dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'certs');
const cert = await readFile(join(certs_dir, 'server.crt'));

const server = new Http3Server({
    port: 8080,
    host: '127.0.0.1',
    secret: 'testsecret',
    cert,
    privKey: await readFile(join(certs_dir, 'server.key'))
});

(async () => {
    try {
        const session_stream = server.sessionStream('/test');
        const session_reader = session_stream.getReader();

        const session = await session_reader.read();
        if (session.done) {
            return console.log('Server finished');
        }
        console.log('got a new session');
        await session.value.ready;
        console.log('server session is ready');

        const bidi_reader = session.value.incomingBidirectionalStreams.getReader();
        const bidi_stream1 = await bidi_reader.read();
        if (bidi_stream1.done) {
            return console.log('bidi reader done');
        }
        console.log('got bidi stream');

        const bidi_stream2 = await bidi_reader.read();
        if (bidi_stream2.done) {
            return console.log('bidi reader done');
        }
        console.log('got bidi stream');

        (async () => {
            const reader = bidi_stream1.value.readable.getReader();
            while (true) { // eslint-disable-line no-constant-condition
                const data = await reader.read();
                if (data.done) {
                    return;
                }
                console.log('stream1', data.value.length);
            }
        })();

        (async () => {
            const reader = bidi_stream2.value.readable.getReader();
            const data = await reader.read();
            if (data.done) {
                return;
            }
            console.log('stream2', data.value.length);
        })();
    } catch (ex) {
        console.error('Server error', ex);
    }
})();

server.startServer();

//await new Promise(resolve => setTimeout(resolve, 2000));

const client = new WebTransport('https://127.0.0.1:8080/test', {
    serverCertificateHashes: [{
        algorithm: 'sha-256',
        value: Buffer.from(
            new X509Certificate(cert).fingerprint256.split(':').map(
                el => parseInt(el, 16)))
    }]
});
client.closed
    .then(() => {
        console.log('Connection closed');
    })
    .catch(err => {
        console.error('Connection errored', err);
    });
console.log('Waiting for client to be ready');
await client.ready;
console.log('Client ready');

const stream1 = await client.createBidirectionalStream();
const stream2 = await client.createBidirectionalStream();
console.log('Client created streams');

const writer1 = stream1.writable.getWriter();
const writer2 = stream2.writable.getWriter();

createReadStream('/dev/urandom').pipe(new Writable({
    async write(chunk, encoding, cb) {
        try {
            await writer1.write(chunk);
            cb();
        } catch (ex) {
            cb(ex);
        }
    }
}));
createReadStream('/dev/zero').pipe(new Writable({
    async write(chunk, encoding, cb) {
        try {
            await writer2.write(chunk);
            cb();
        } catch (ex) {
            cb(ex);
        }
    }
}));
