/*jslint node: true */
"use strict";

// Enable passing options in title (WithOptions in test/test_comms.js)
require('mocha/lib/utils').isString = function (obj)
{
    return true;
};

var net = require('net'),
    fs = require('fs'),
    path = require('path'),
    util = require('util'),
    os = require('os'),
    { Duplex } = require('stream'),
    Mocha = require('mocha'),
    Primus = require('primus'),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex,
    http2 = require('http2'),
    BPMux = require('bpmux').BPMux,
    server_port = 7000;

// TODO:
// combine that with response read stream
// we'll need to do some heavy adapting to what bpmux expects
// either make our own Duplex or write separate Writable and Readable and
// use duplexify to combine (possibly with enhancements for close)
// use ByteLengthQueueingStrategy
// we'll probably need to convert to/from native byte arrays

class BrowserStreamsDuplex extends Duplex
{
    constructor(readable, writable, options)
    {
        super(options);
        this._reader = readable.getReader();
        this._writer = writable.getWriter();
    }

    async _read()
    {
        console.log("_READ");
        // TODO: should we guard against re-entry like node-lora-comms does
        try
        {
            while (true)
            {
                const { value, done } = await this._reader.read();
                console.log("READ", value, done);
                if (done)
                {
                    return this.push(null);
                }
                if (!this.push(value))
                {
                    return;
                }
            }
        }
        catch (ex)
        {
            console.log("READ ERROR", ex);
            this.emit('error', ex);
        }
    }

    async _write(chunk, encoding, cb)
    {
        console.log("_WRITE", chunk);
        try
        {
            const arr = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; ++i)
            {
                arr[i] = chunk[i];
            }
            console.log(arr);
            await this._writer.write(arr);
            console.log("WRITTEN");
            cb();
        }
        catch (ex)
        {
            console.log("WRITE ERROR", ex);
            cb(ex);
        }
    }
}

module.exports = function (BrowserPrimus, // will be using browser transport
                           BrowserPrimusDuplex,
                           browser_fetch,
                           BrowserTransformStream,
                           BrowserBPMux,
                           BrowserBuffer,
                           browser_crypto,
                           browser_frame)
{
    var mocha = new Mocha(
    {
        bail: true,
        timeout: 20 * 60 * 1000
    });

    mocha.suite.emit('pre-require', global, null, mocha);
/*
    require('test_comms')(
        'primus',
        BPMux,
        function (conn_cb, cb)
        {
            cb(Primus.createServer(function (spark)
            {
                conn_cb(new PrimusDuplex(spark));
            }, { port: server_port, iknowhttpsisbetter: true }));
        },
        function (server, cb)
        {
            server.destroy(cb);
        },
        function (conn, cb)
        {
            conn.on('end', function ()
            {
                this.end();
                cb();
            });
        },
        BrowserBPMux,
        function (cb)
        {
            cb(new BrowserPrimusDuplex(
                    new BrowserPrimus('http://localhost:' + server_port)));
        },
        function (conn, cb)
        {
            conn.on('end', cb);
            conn.end();
        },
        BrowserBuffer,
        browser_crypto,
        browser_frame,
        true);
*/
    require('test_comms')(
        'http2',
        BPMux,
        function (conn_cb, cb)
        {
            var server = http2.createSecureServer(
            {
                key: fs.readFileSync(path.join(__dirname, 'certs', 'server.key')),
                cert: fs.readFileSync(path.join(__dirname, 'certs', 'server.crt')),
            });
            server.on('stream', function (stream, headers)
            {
                console.log("HEADERS", headers);
                stream.respond({ ':status': 200 });
                conn_cb(stream);
            });
            server.listen(server_port);
            setTimeout(function ()
            {
                cb(server);
            }, 5000);
        },
        function (server, cb)
        {
            // TODO: may need to close all sessions
            server.close(cb);
        },
        function (conn, cb)
        {
            conn.on('end', function ()
            {
                this.end();
                cb();
            });
        },
        BrowserBPMux,
        async function (cb)
        {
            const { readable, writable } = new BrowserTransformStream();
            const response = await browser_fetch(
                'https://localhost:' + server_port,
                {
                    method: 'POST',
                    body: readable,
                });
            cb(new BrowserStreamsDuplex(response.body, writable));
        },
        function (conn, cb)
        {
            conn.on('end', cb);
            conn.end();
        },
        BrowserBuffer,
        browser_crypto,
        browser_frame,
        true);

    console.log = function ()
    {
        process.stdout.write(util.format.apply(this, arguments));
        process.stdout.write(os.EOL);
    };

    console.error = function ()
    {
        process.stderr.write(util.format.apply(this, arguments));
        process.stderr.write(os.EOL);
    };

    console.trace = function trace()
    {
        var err = new Error();
        err.name = 'Trace';
        err.message = util.format.apply(this, arguments);
        Error.captureStackTrace(err, trace);
        this.error(err.stack);
    };

    mocha.run(function (failures)
    {
        if (failures)
        {
            return process.exit(failures);
        }

        /*global window */
        window.require('nw.gui').App.quit();
    });
};
