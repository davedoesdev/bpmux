/*eslint-env node */
/*eslint brace-style: "error" */
"use strict";

const http2 = require('http2');
const fs = require('fs');
const path = require('path');
const { BPMux, Http2Sessions } = require('..');
const server_port = 7000;

function make_server(port, cb) {
    const server = http2.createSecureServer({
        key: fs.readFileSync(path.join(__dirname, 'certs', 'server.key')),
        cert: fs.readFileSync(path.join(__dirname, 'certs', 'server.crt')),
        maxSendHeaderBlockLength: 100000
    });

    server.bpmux_sessions = new Set();

    server.on('session', session => {
        server.bpmux_sessions.add(session);
        session.on('close', () => server.bpmux_sessions.delete(session));
    });

    server.listen(port, () => cb(server));
}

function connect(to, from, cb) {
    http2.connect(
        `https://localhost:${to.address().port}`,
        {
            ca: fs.readFileSync(path.join(__dirname, 'certs', 'ca.crt')),
            maxSendHeaderBlockLength: 100000
        },
        function () {
            from.bpmux_sessions.add(this);
            this.on('close', () => from.bpmux_sessions.delete(this));
            cb(this);
        });
}

function close_sessions(sessions, cb) {
    let closed = 0;
    function check() {
        if (++closed === 2) {
            cb();
        }
    }
    for (const session of [sessions.client, sessions.server]) {
        if (session.closed || session.destroyed) {
            check();
        } else {
            session.on('close', check);
            try {
                session.destroy();
            } catch (ex) { // eslint-disable-line no-empty
            }
        }
    }
}

require('./test_comms')(
    'http2-session',
    BPMux,
    (conn_cb, cb) => {
        make_server(server_port, serverRHS => {
            make_server(server_port + 1, serverLHS => {
                serverRHS.on('session', sessionRHSfromLHS => {
                    connect(serverLHS, serverRHS, sessionRHStoLHS => {
                        conn_cb(new Http2Sessions(sessionRHStoLHS, sessionRHSfromLHS));
                    });
                });
                cb({ serverLHS, serverRHS });
            });
        });
    },
    ({ serverLHS, serverRHS }, cb) => {
        let closed = 0;
        for (const server of [serverLHS, serverRHS]) {
            server.removeAllListeners('session');

            for (const session of server.bpmux_sessions) {
                try {
                    session.destroy();
                } catch (ex) { // eslint-disable-line no-empty
                }
            }

            server.on('session', session => {
                try {
                    session.destroy();
                } catch (ex) { // eslint-disable-line no-empty
                }
            });

            server.close(() => {
                if (++closed === 2) {
                    cb();
                }
            });
        }
    },
    close_sessions,
    BPMux,
    ({ serverLHS, serverRHS }, cb) => {
        let sessionLHStoRHS;
        let sessionLHSfromRHS;

        function check() {
            if (sessionLHStoRHS && sessionLHSfromRHS) {
                cb(new Http2Sessions(sessionLHStoRHS, sessionLHSfromRHS));
            }
        }

        serverLHS.once('session', session => {
            sessionLHSfromRHS = session;
            check();
        });

        connect(serverRHS, serverLHS, session => {
            sessionLHStoRHS = session;
            check();
        });
    },
    close_sessions,
    Buffer,
    require('crypto'),
    require('frame-stream'),
    Error,
    require('stream'),
    process.env.FAST);
