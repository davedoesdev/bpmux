/*jslint node: true */
"use strict";

var net = require('net'),
    BPMux = require('..').BPMux,
    server_port = 7000;

function setup(aho)
{
    require('./test_comms')(
        'tcp aho=' + aho,
        BPMux,
        function (conn_cb, cb)
        {
            net.createServer(
            {
                allowHalfOpen: aho
            }, conn_cb).listen(server_port, function ()
            {
                cb(this);
            });
        },
        function (server, cb)
        {
            server.close(cb);
        },
        function (conn, cb)
        {
            conn.on('end', function ()
            {
                if (this.allowHalfOpen)
                {
                    this.end();
                }
                cb();
            });
        },
        BPMux,
        function (cb)
        {
            net.createConnection(server_port, function ()
            {
                cb(this);
            });
        },
        function (conn, cb)
        {
            conn.on('end', cb);
            conn.end();
        },
        Buffer,
        require('crypto'),
        process.env.FAST);
}

setup(false);
setup(true);
