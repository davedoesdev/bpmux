/*eslint-env node */
/*eslint brace-style: "error" */
"use strict";

const { join } = require('path');
const { readFile } = require('fs/promises');
const { X509Certificate } = require('crypto');
const BPMux = require('..').BPMux;

const certs_dir = join(__dirname, 'certs');
async function read_cert() {
    return await readFile(join(certs_dir, 'server.crt'));
}

require('./test_comms')(
    'webtransport',
    BPMux,
    async (conn_cb, cb) => {
        const { Http3Server } = await import('@fails-components/webtransport');
        const server = new Http3Server({
            port: 7000,
            host: '127.0.0.1',
            secret: 'testsecret',
            cert: await read_cert(),
            privKey: await readFile(join(certs_dir, 'server.key'))
        });
        server.startServer();
        (async () => {
            const session_stream = server.sessionStream('/test');
            const session_reader = session_stream.getReader();
            while (true) { // eslint-disable-line no-constant-condition
                const { done, value } = await session_reader.read();
                if (done) {
                    return;
                }
                await value.ready;
                conn_cb(value);
            }
        })();
        cb(server);
    },
    (server, cb) => {
        server.stopServer();
        cb();
    },
    (wt, cb) => {
        (async () => {
            try {
                await wt.closed;
            } catch (ex) {
                return cb(ex);
            }
            cb();
        })();
    },
    BPMux,
    async (server, cb) => {
        const { WebTransport } = await import('@fails-components/webtransport');
        const client = new WebTransport('https://127.0.0.1:7000/test', {
            serverCertificateHashes: [{
                algorithm: 'sha-256',
                value: Buffer.from(
                    new X509Certificate(await read_cert()).fingerprint256.split(':').map(
                        el => parseInt(el, 16)))
            }]
        });
        await client.ready;
        cb(client);
    },
    function (client, cb) {
        (async () => {
            await client.closed;
            cb();
        })();
        client.close({
            closeCode: 0,
            reason: ''
        });
    },
    Buffer,
    require('crypto'),
    require('frame-stream'),
    Error,
    require('stream'),
    process.env.FAST);
