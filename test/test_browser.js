/*jslint node: true */
"use strict";

// Enable passing options in title (WithOptions in test/test_comms.js)
require('mocha/lib/utils').isString = function (obj)
{
    return true;
};

var net = require('net'),
    util = require('util'),
    os = require('os'),
    Mocha = require('mocha'),
    Primus = require('primus'),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex,
    BPMux = require('bpmux').BPMux,
    server_port = 7000;

module.exports = function (BrowserPrimus, // will be using browser transport
                           BrowserPrimusDuplex,
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
