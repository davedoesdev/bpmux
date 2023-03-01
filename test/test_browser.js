/*eslint-env node */
"use strict";

var util = require('util'),
    os = require('os');

console.log = function () // eslint-disable-line no-console
{
    process.stdout.write(util.format.apply(this, arguments));
    process.stdout.write(os.EOL);
};

console.error = function () // eslint-disable-line no-console
{
    process.stderr.write(util.format.apply(this, arguments));
    process.stderr.write(os.EOL);
};

console.trace = function trace() // eslint-disable-line no-console
{
    var err = new Error();
    err.name = 'Trace';
    err.message = util.format.apply(this, arguments);
    Error.captureStackTrace(err, trace);
    this.error(err.stack);
};

process.on('uncaughtException', err =>
{
    console.error("Uncaught exception", err);
});

process.on('unhandledRejection', err =>
{
    console.error("Unhandled rejection", err);
});

// Enable passing options in title (WithOptions in test/test_comms.js)
require('mocha/lib/utils').isString = function (obj)
{
    return typeof obj === 'string' ||
           (typeof obj === 'object' && obj.constructor.name == 'WithOptions');
};

var fs = require('fs'),
    path = require('path'),
    crypto = require('crypto'),
    http2 = require('http2'),
    Mocha = require('mocha'),
    Primus = require('primus'),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex,
    Http2DuplexServer = require('./http2_duplex_server.js').Http2DuplexServer,
    BPMux = require('bpmux').BPMux,
    server_port = 7000;

module.exports = function (BrowserPrimus, // will be using browser transport
                           BrowserPrimusDuplex,
                           make_client_http2_duplex,
                           BrowserBPMux,
                           BrowserBuffer,
                           browser_crypto,
                           browser_frame,
                           BrowserError,
                           browser_stream,
                           BrowserWebTransport,
                           cb)
{
    var mocha = new Mocha(
    {
        bail: true,
        timeout: 20 * 60 * 1000
    });

    mocha.suite.emit('pre-require', global, null, mocha);

    require('test_comms')(
        'primus',
        BPMux,
        function (conn_cb, cb)
        {
            cb(Primus.createServer(function (spark)
            {
                conn_cb(new PrimusDuplex(spark));
            },
            {
                port: server_port,
                key: fs.readFileSync(path.join(__dirname, 'certs', 'server.key')),
                cert: fs.readFileSync(path.join(__dirname, 'certs', 'server.crt'))
            }));
        },
        function (server, cb)
        {
            server.destroy(cb);
        },
        function (conn, cb)
        {
            if (conn.destroyed)
            {
                return cb();
            }
            conn.on('end', function ()
            {
                this.end();
                cb();
            });
        },
        BrowserBPMux,
        function (server, cb)
        {
            cb(new BrowserPrimusDuplex(
                    new BrowserPrimus('https://localhost:' + server_port)));
        },
        function (conn, cb)
        {
            if (conn.destroyed)
            {
                return cb();
            }
            conn.on('close', cb);
            conn.end();
        },
        BrowserBuffer,
        browser_crypto,
        browser_frame,
        BrowserError,
        browser_stream,
        true);

    require('test_comms')(
        'http2-duplex',
        BPMux,
        function (conn_cb, cb)
        {
            const http2_server = http2.createSecureServer(
            {
                key: fs.readFileSync(path.join(__dirname, 'certs', 'server.key')),
                cert: fs.readFileSync(path.join(__dirname, 'certs', 'server.crt'))
            });

            const http2_duplex_server = new Http2DuplexServer(
                http2_server,
                '/test'
            );

            http2_duplex_server.on('duplex', conn_cb);

            http2_server.listen(server_port, function ()
            {
                cb(http2_duplex_server);
            });
        },
        function (http2_duplex_server, cb)
        {
            http2_duplex_server.detach();

            http2_duplex_server.http2_server.on('session', function (session)
            {
                try
                {
                    session.destroy();
                }
                catch (ex)
                { // eslint-disable-line no-empty
                }
            });

            http2_duplex_server.http2_server.close(cb);
        },
        function (conn, cb)
        {
            if (conn.destroyed)
            {
                return cb();
            }
            // we have to listen for 'close' separately in case the actual
            // connection terminates, in which case we don't get 'end'
            // because browser-http2-duplex forgets about it before the
            // end message arrives
            conn.on('close', cb);
            conn.on('end', function ()
            {
                this.end();
            });
        },
        BrowserBPMux,
        async function (server, cb)
        {
            const url = 'https://localhost:' + server_port + '/test';
            const duplex = await make_client_http2_duplex(url);
            cb(duplex);
        },
        function (conn, cb)
        {
            if (conn.destroyed)
            {
                return cb();
            }
            conn.on('close', cb);
            conn.end();
        },
        BrowserBuffer,
        browser_crypto,
        browser_frame,
        BrowserError,
        browser_stream,
        true);

    require('test_comms')(
        'webtransport',
        BPMux,
        async (conn_cb, cb) =>
        {
            const { Http3Server } = require('@fails-components/webtransport');
            const server = new Http3Server({
                port: server_port,
                host: '127.0.0.1',
                secret: 'testsecret',
                cert: fs.readFileSync(path.join(__dirname, 'certs', 'server.crt')),
                privKey: fs.readFileSync(path.join(__dirname, 'certs', 'server.key'))
            });
            server.startServer();
            (async () =>
            {
                const session_stream = server.sessionStream('/test');
                const session_reader = session_stream.getReader();
                while (true) // eslint-disable-line no-constant-condition
                {
                    const { done, value } = await session_reader.read();
                    if (done)
                    {
                        return;
                    }
                    await value.ready;
                    conn_cb(value);
                }
            })();
            cb(server);
        },
        (server, cb) =>
        {
            server.stopServer();
            cb();
        },
        (wt, cb) =>
        {
            (async () =>
            {
                try
                {
                    await wt.closed;
                }
                catch (ex)
                {
                    return cb(ex);
                }
                cb();
            })();
        },
        BrowserBPMux,
        (server, cb) =>
        {
            let i = 0;
            const connect = async () =>
            {
                let client;
                let should_retry = true;
                const maybe_retry = err =>
                {
                    console.error(err);
                    if (should_retry)
                    {
                        should_retry = false;
                        if (++i === 10)
                        {
                            return cb(err);
                        }
                        console.log("RETRYING", i);
                        setTimeout(connect, 200);
                    }
                };
                try
                {
                    client = new BrowserWebTransport(`https://127.0.0.1:${server_port}/test`, {
                        serverCertificateHashes: [{
                            algorithm: 'sha-256',
                            value: new Uint8Array(
                                new crypto.X509Certificate(fs.readFileSync(path.join(__dirname, 'certs', 'server.crt')))
                                    .fingerprint256.split(':').map(el => parseInt(el, 16)))
                        }]
                    });
                    (async () =>
                    {
                        try
                        {
                            await client.closed;
                        }
                        catch (ex)
                        {
                            maybe_retry(ex);
                        }
                    })();
                    await client.ready;
                }
                catch (ex)
                {
                    return maybe_retry(ex);
                }
                should_retry = false;
                cb(client);
            };
            connect();
        },
        function (client, cb)
        {
            (async () =>
            {
                try
                {
                    await client.closed;
                }
                catch (ex)
                {
                    return cb(ex);
                }
                cb();
            })();
            client.close(
            {
                closeCode: 0,
                reason: ''
            });
        },
        BrowserBuffer,
        browser_crypto,
        browser_frame,
        BrowserError,
        browser_stream,
        true);

    mocha.run(function (failures)
    {
        cb(failures ? new Error('failed') : null);
    });
};
