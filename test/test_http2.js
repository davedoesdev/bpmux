/*eslint-env node */
"use strict";

var http2 = require('http2'),
    fs = require('fs'),
    path = require('path'),
    BPMux = require('..').BPMux,
    server_port = 7000;

require('./test_comms')(
    'http2',
    BPMux,
    function (conn_cb, cb)
    {
        var server = http2.createSecureServer(
        {
            key: fs.readFileSync(path.join(__dirname, 'certs', 'server.key')),
            cert: fs.readFileSync(path.join(__dirname, 'certs', 'server.crt'))
        });

        server.bpmux_sessions = new Set();

        server.on('session', function (session)
        {
            server.bpmux_sessions.add(session);
            session.on('close', function ()
            {
                server.bpmux_sessions.delete(session);
            });

            session.on('stream', function (stream)
            {
                stream.respond(
                {
                    ':status': 200,
                    'Content-Type': 'application/octet-stream'
                });

                conn_cb(stream);
            });
        });

        server.listen(server_port, () => cb(server));
    },
    function (server, cb)
    {
        server.removeAllListeners('session');

        for (let session of server.bpmux_sessions)
        {
            session.removeAllListeners('stream');
            try
            {
                session.destroy();
            }
            catch (ex)
            { // eslint-disable-line no-empty
            }
        }

        server.on('session', function (session)
        {
            try
            {
                session.destroy();
            }
            catch (ex)
            { // eslint-disable-line no-empty
            }
        });

        server.close(cb);
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
            // note: Http2Stream hardcodes autoDestroy to false so
            // we don't get close event here
            cb();
        });
    },
    BPMux,
    function (server, cb)
    {
        function connected()
        {
            server.bpmux_client_session
                .request({ ':method': 'POST' })
                .on('response', function ()
                {
                    cb(this);
                });
        }

        if (server.bpmux_client_session)
        {
            return connected();
        }

        http2.connect(
            'https://localhost:' + server_port,
            {
                ca: fs.readFileSync(path.join(__dirname, 'certs', 'ca.crt'))
            },
            function ()
            {
                server.bpmux_client_session = this;
                connected();
            });
    },
    function (conn, cb)
    {
        if (conn.destroyed)
        {
            return cb();
        }
        var called = false;
        function cb2()
        {
            if (!called)
            {
                called = true;
                cb();
            }
        }
        conn.on('end', cb2);
        conn.on('close', cb2);
        conn.close();
    },
    Buffer,
    require('crypto'),
    require('frame-stream'),
    process.env.FAST);
