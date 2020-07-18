/*eslint-env node, mocha */
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
            }, function (conn)
            {
                conn.setNoDelay();
                conn_cb(conn);
            }).listen(server_port, function ()
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
        function (server, cb)
        {
            net.createConnection(server_port, function ()
            {
                this.setNoDelay();
                cb(this);
            });
        },
        function (conn, cb)
        {
            conn.on('close', cb);
            conn.end();
        },
        Buffer,
        require('crypto'),
        require('frame-stream'),
        process.env.FAST);
}

setup(false);
setup(true);
