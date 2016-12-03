/*global before: false,
         after: false,
         beforeEach: false,
         afterEach: false,
         it : false,
         describe: false */
/*jslint node: true, nomen: true */
"use strict";

var path = require('path'),
    fs = require('fs'),
    util = require('util'),
    tmp = require('tmp'),
    async = require('async'),
    crypto = require('crypto'),
    chai = require('chai'),
    expect = chai.expect,
    random_fname = path.join(__dirname, 'fixtures', 'random');

function WithOptions(title, mux_options, multiplex_options)
{
    this.title = title;
    this.mux_options = mux_options;
    this.multiplex_options = multiplex_options;
}

WithOptions.prototype.toString = function ()
{
    return this.title;
};

function drain()
{
    /*jshint validthis: true */
    var buf;
    do
    {
        buf = this.read();
    } while (buf !== null);
}

function parse_handshake_data(buf)
{
    if ((buf.length === 0) || (buf.toString() === 'control'))
    {
        return buf;
    }
    expect(buf.length).to.equal(4);
    return buf.readUInt32BE(0, true);
}

function test(ServerBPMux, make_server, end_server, end_server_conn,
              ClientBPMux, make_client_conn, end_client_conn,
              ClientBuffer, client_crypto,
              coalesce_writes, fast)
{
    var server,
        server_conn,
        client_conn,
        server_mux,
        client_mux,
        duplexes,
        ended,
        finished,
        check,
        mux_options = {
            coalesce_writes: coalesce_writes,
            parse_handshake_data: parse_handshake_data,
            peer_multiplex_options: {
                highWaterMark: fast ? 2048 : 16384
            }
        };

    function csebemr(duplex)
    {
        duplex.on('error', function (err)
        {
            expect(err.message).to.be.oneOf(
            [
                'carrier stream ended before end message received',
                'carrier stream finished before duplex finished',
                'write after end'
            ]);
            if (err.message === 'carrier stream ended before end message received')
            {
                this.push(null);
            }
            else if (err.message === 'carrier stream finished before duplex finished')
            {
                // give chance for duplex._ended === true case to occur in
                // carrier on end/close handler
                setImmediate(function ()
                {
                    duplex.end();
                });
            }
        });
    }

    function add_duplex(duplex)
    {
        duplex.on('end', function ()
        {
            if (this._finished)
            {
                expect(this._mux.duplexes.has(this._chan)).to.equal(false);
                this._mux._chan = this._chan;
                var d = this._mux.multiplex({ _delay_handshake: true });
                expect(d._chan).to.equal(this._chan);
                csebemr(d);
            }
            ended += 1;
            if (check) { check(); }
        });

        duplex.on('finish', function ()
        {
            finished += 1;
            if (check) { check(); }
        });

        duplexes.push(duplex);
    }

    before(function (cb)
    {
        var buf = crypto.randomBytes(100 * 1024);
        fs.writeFile(random_fname, buf, cb);
    });

    after(function (cb)
    {
        fs.unlink(random_fname, cb);
    });

    beforeEach(function (cb)
    {
        var options = mux_options;

        if (this.currentTest.title instanceof WithOptions)
        {
            options = util._extend(
            {
                coalesce_writes: coalesce_writes,
                parse_handshake_data: parse_handshake_data
            }, this.currentTest.title.mux_options || {});
        }

        client_conn = null;
        server_conn = null;
        duplexes = [];
        ended = 0;
        finished = 0;
        check = null;

        make_server(function (c)
        {
            server_conn = c;
            server_mux = new ServerBPMux(server_conn, options);
            server_mux.setMaxListeners(0);
            server_mux.name = 'server';

            server_mux.on('error', function (err)
            {
                if (this.listenerCount('error') === 0)
                {
                    expect(err.message).to.equal('write after end');
                }
            });

            if (client_conn) { cb(); }
        }, function (s)
        {
            server = s;
            make_client_conn(function (c)
            {
                client_conn = c;
                client_mux = new ClientBPMux(client_conn, options);
                client_mux.setMaxListeners(0);
                client_mux.name = 'client';

                client_mux.on('error', function (err)
                {
                    if (this.listenerCount('error') === 0)
                    {
                        expect(err.message).to.equal('write after end');
                    }
                });

                if (server_conn) { cb(); }
            });
        });
    });

    afterEach(function (cb)
    {
        var i;

        for (i = 0; i < duplexes.length; i += 1)
        {
            if (duplexes[i].listenerCount('error') === 0)
            {
                csebemr(duplexes[i]);
            }
        }

        check = function ()
        {
            if ((!client_conn) &&
                (!server_conn) &&
                (ended === duplexes.length) &&
                (finished === duplexes.length))
            {
                end_server(server, cb);
            }
        };

        end_server_conn(server_conn, function ()
        {
            server_conn = null;
            check();
        });

        end_client_conn(client_conn, function ()
        {
            client_conn = null;
            check();
        });

        for (i = 0; i < duplexes.length; i += 1)
        {
            duplexes[i].on('readable', drain);
            drain.call(duplexes[i]);
        }

        check();
    });

    function both(f)
    {
        return function (initiator_duplex, responder_duplex, cb)
        {
            async.parallel([
                function (cb)
                {
                    f(initiator_duplex, responder_duplex, cb);
                },

                function (cb)
                {
                    f(responder_duplex, initiator_duplex, cb);
                }
            ], cb);
        };
    }
    
    function make_buffer(mux, x)
    {
        return mux.name === 'client' ? new ClientBuffer(x) : new Buffer(x);
    }

    function buffer_concat(mux, x)
    {
        return mux.name === 'client' ? ClientBuffer.concat(x) : Buffer.concat(x);
    }

    function get_crypto(mux)
    {
        return mux.name === 'client' ? client_crypto : crypto;
    }

    function multiplex(n, f, initiator_mux, responder_mux)
    {
        /*jshint validthis: true */
        var responder_chans = [],
            title = this.test.title;

        return function (i, cb)
        {
            var initiator_duplex = null,
                responder_duplex = null,
                initiator_buf = make_buffer(initiator_mux, 4),
                wait_for_handshake = !((title instanceof WithOptions) &&
                                       title.multiplex_options &&
                                       title.multiplex_options._delay_handshake);
                
            initiator_buf.writeUInt32BE(i, 0, true);

            responder_mux.on('handshake', function (duplex, handshake_data, delay_handshake)
            {
                if ((n > 1) && (handshake_data !== i)) { return; }

                expect(responder_chans[duplex._chan]).to.equal(undefined);
                responder_chans[duplex._chan] = true;
                expect(duplex._chan).to.be.below(n);

                var send_handshake = delay_handshake(),
                    responder_buf = make_buffer(responder_mux, 4);

                responder_buf.writeUInt32BE(i, 0, true);

                // test sending handshake later
                process.nextTick(function ()
                {
                    send_handshake(responder_buf);
                });

                add_duplex(duplex);
                responder_duplex = duplex;
                responder_duplex.name = responder_mux.name;

                if (wait_for_handshake && initiator_duplex)
                {
                    f(initiator_duplex, responder_duplex, cb);
                }
            });

            expect(initiator_mux._chan).to.equal(i);

            initiator_duplex = initiator_mux.multiplex(
                title instanceof WithOptions ?
                util._extend(
                {
                    handshake_data: initiator_buf
                }, title.multiplex_options || {}) :
                {
                    handshake_data: initiator_buf,
                    highWaterMark: fast ? 2048 : 16384
                });

            expect(initiator_duplex._chan).to.equal(i);
            add_duplex(initiator_duplex);
            initiator_duplex.name = initiator_mux.name;
            if ((!wait_for_handshake) || responder_duplex)
            {
                f(initiator_duplex, wait_for_handshake ? responder_duplex :
                {
                    _mux: responder_mux,
                    name: responder_mux.name
                }, cb);
            }
        };
    }

    function single_byte(sender, receiver, cb)
    {
        var ch = sender._mux.name.substr(0, 1);

        receiver.on('readable', function ()
        {
            var data = this.read();
            if (data === null)
            {
                return;
            }
            expect(data.toString()).to.equal(ch);
            cb();
        });

        sender.write(ch);
    }

    function multi_byte(sender, receiver, cb)
    {
        var send_crypto = get_crypto(sender),
            receive_crypto = get_crypto(receiver),
            send_hash = send_crypto.createHash('sha256'),
            receive_hash = receive_crypto.createHash('sha256'),
            total = (fast ? 10 : 100) * 1024,
            remaining_out = total,
            remaining_in = remaining_out;

        receiver.on('readable', function ()
        {
            var buf;

            while (true)
            {
                buf = this.read();
                if (buf === null) { break; }

                expect(remaining_in).to.be.at.least(1);
                remaining_in -= buf.length;
                expect(remaining_in).to.be.at.least(0);

                receive_hash.update(buf);

                if (remaining_in === 0)
                {
                    expect(receive_hash.digest('hex')).to.equal(send_hash.digest('hex'));
                    cb();
                }
            }
        });

        function send()
        {
            var n = Math.min(Math.floor(Math.random() * 201), remaining_out),
                buf = send_crypto.randomBytes(n),
                r = sender.write(buf);

            send_hash.update(buf);
            remaining_out -= n;

            if (remaining_out > 0)
            {
                if (r)
                {
                    setTimeout(send, Math.floor(Math.random() * 51));
                }
                else
                {
                    sender.once('drain', send);
                }
            }
        }

        send();
    }

    function large_buffer(sender, receiver, cb)
    {
        var buf = make_buffer(sender, 32 * 1024), bufs = [], count = 0;
        buf.fill('a');

        receiver.on('readable', function ()
        {
            while (true)
            {
                var data = this.read();
                if (data === null)
                {
                    break;
                }
                bufs.push(data);
                count += data.length;
                if (count === buf.length)
                {
                    expect(buffer_concat(receiver, bufs).toString()).to.equal(buf.toString());
                    cb();
                }
                else if (count > buf.length)
                {
                    cb(new Error('too much data'));
                }
            }
        });

        sender.write(buf);
    }

    function delay_status(sender, receiver, cb)
    {
        var read_count = 0,
            drain_count = 0,
            hwm = sender._writableState.highWaterMark;

        function check2()
        {
            expect(read_count).to.equal(hwm + 1);
            expect(drain_count).to.equal(1);
            cb();
        }

        function check1()
        {
            expect(read_count).to.equal(hwm);
            expect(drain_count).to.equal(0);

            receiver.removeAllListeners('readable');

            receiver.on('readable', function ()
            {
                var buf;

                while (true)
                {
                    buf = this.read(null, false);

                    if (buf === null)
                    {
                        break;
                    }

                    expect(buf.length).to.equal(1);
                    read_count += buf.length;
                    expect(read_count).to.equal(hwm + 1);

                    // give time for any unexpected reads and drains
                    setTimeout(check2, 2000);
                }
            });

            expect(receiver.read(0)).to.equal(null);
        }

        receiver.on('readable', function ()
        {
            var buf;

            while (true)
            {
                buf = this.read(null, false);

                if (buf === null)
                {
                    break;
                }

                read_count += buf.length;
                expect(read_count).to.be.at.most(hwm);

                if (read_count === hwm)
                {
                    // give time for any unexpected reads and drains
                    setTimeout(check1, 2000);
                }
            }
        });

        expect(sender.write(make_buffer(sender, hwm + 1))).to.equal(false);

        sender.on('drain', function ()
        {
            drain_count += 1;
        });
    }

    // adapted from test in Node source (test/simple/test-stream2-writable.js)

    function write_backpressure(sender, receiver, cb)
    {
        var drains = 0,
            i = 0,
            j = 1,
            write_crypto = get_crypto(sender),
            read_crypto = get_crypto(receiver),
            write_hash = write_crypto.createHash('sha256'),
            read_hash = read_crypto.createHash('sha256'),
            write_done = false,
            read_done = false,
            chunks = new Array(sender._writableState.highWaterMark),
            ci;

        for (ci = 0; ci < chunks.length; ci += 1)
        {
            chunks[ci] = make_buffer(sender, ci); //send_crypto.randomBytes(ci);
        }

        receiver.on('readable', function ()
        {
            var buf;

            while (true)
            {
                buf = this.read(j);

                if (buf === null)
                {
                    break;
                }

                read_hash.update(buf);

                j += 1;
            }
        });

        receiver.on('end', function ()
        {
            expect(read_hash.digest('hex')).to.equal(write_hash.digest('hex'));
            read_done = true;
            if (write_done) { cb(); }
        });

        sender.on('finish', function ()
        {
            expect(drains).to.equal(fast ? 726 : 5816);
            write_done = true;
            if (read_done) { cb(); }
        });

        sender.on('drain', function ()
        {
            drains += 1;
        });

        function write()
        {
            var ret;

            do
            {
                ret = sender.write(chunks[i]);
                write_hash.update(chunks[i]);
                i += 1;
            }
            while ((ret !== false) && (i < chunks.length));

            if (i < chunks.length)
            {
                expect(sender._writableState.length).to.be.at.least(sender._writableState.highWaterMark);
                sender.once('drain', write);
            }
            else
            {
                sender.end();
            }
        }

        write();
    }

    function flow_mode(sender, receiver, cb)
    {
        var send_hash = get_crypto(sender).createHash('sha256'),
            receive_hash = get_crypto(receiver).createHash('sha256'),
            total = (fast ? 10 : 100) * 1024,
            remaining_out = total,
            remaining_in = remaining_out;

        receiver.on('data', function (buf)
        {
            expect(remaining_in).to.be.at.least(1);
            remaining_in -= buf.length;
            expect(remaining_in).to.be.at.least(0);

            receive_hash.update(buf);

            if (remaining_in === 0)
            {
                expect(receive_hash.digest('hex')).to.equal(send_hash.digest('hex'));
                cb();
            }
        });

        function send()
        {
            var n = Math.min(Math.floor(Math.random() * 201), remaining_out),
                buf = get_crypto(sender).randomBytes(n);

            sender.write(buf);
            send_hash.update(buf);
            remaining_out -= n;

            if (remaining_out > 0)
            {
                setTimeout(send, Math.floor(Math.random() * 51));
            }
        }

        send();
    }

    function pipe(sender, receiver, cb)
    {
        var in_stream = fs.createReadStream(random_fname),
            tmp_receiver;

        if ((ClientBuffer !== Buffer) && (receiver.name === 'client'))
        {
            // Can't pipe from file to browser because Node checks buffer type
            // so reverse sender and receiver.
            tmp_receiver = receiver;
            receiver = sender;
            sender = tmp_receiver;
        }

        tmp.tmpName(function (err, out_fname1)
        {
            if (err) { return cb(err); }
            tmp.tmpName(function (err, out_fname2)
            {
                if (err) { return cb(err); }

                var out_stream1 = fs.createWriteStream(out_fname1),
                    out_stream2 = fs.createWriteStream(out_fname2),
                    finished1 = false,
                    finished2 = false;

                function piped()
                {
                    fs.readFile(random_fname, function (err, in_buf)
                    {
                        if (err) { return cb(err); }
                        fs.readFile(out_fname1, function (err, out_buf1)
                        {
                            if (err) { return cb(err); }
                            fs.readFile(out_fname2, function (err, out_buf2)
                            {
                                if (err) { return cb(err); }
                                expect(in_buf).to.eql(out_buf1);
                                expect(in_buf).to.eql(out_buf2);
                                fs.unlink(out_fname1, function (err)
                                {
                                    if (err) { return cb(err); }
                                    fs.unlink(out_fname2, function (err)
                                    {
                                        if (err) { return cb(err); }
                                        cb();
                                    });
                                });
                            });
                        });
                    });
                }

                out_stream1.on('finish', function ()
                {
                    finished1 = true;
                    if (finished2) { piped(); }
                });

                out_stream2.on('finish', function ()
                {
                    finished2 = true;
                    if (finished1) { piped(); }
                });

                receiver.pipe(out_stream1);
                receiver.pipe(out_stream2);

                in_stream.pipe(receiver);

                sender.pipe(sender);

                //in_stream.pipe(sender);
            });
        });
    }

    /*jslint unparam: true */
    function error_event(sender, receiver, cb)
    {
        var err = new Error('foo'),
            n1 = 0,
            n2 = 0,
            called = false,
            error_events;

        sender.on('error', function onerr(e)
        {
            expect(e).to.equal(err);
            n1 += 1;
            expect(n1).to.be.at.most(4);
            if ((n1 === 4) && (n2 === 3) && !called)
            {
                this.removeListener('error', onerr);
                cb();
                called = true;
            }
        });

        sender._mux.on('error', function onerr(e)
        {
            expect(e).to.equal(err);
            n2 += 1;
            expect(n2).to.be.at.most(3);
            if ((n1 === 4) && (n2 === 3) && !called)
            {
                this.removeListener('error', onerr);
                cb();
                called = true;
            }
        });

        // Readable unpipes on error (_stream_readable.js, function onerror),
        // which means we'll never get EOF when cleaning up.
        error_events = sender._mux.carrier._events.error;
        if (error_events[0].name === 'onerror')
        {
            error_events.shift();
        }
        error_events = sender._mux._in_stream._events.error;
        if (error_events[0].name === 'onerror')
        {
            error_events.shift();
        }

        sender._mux._in_stream.emit('error', err);
        sender._mux._out_stream.emit('error', err);
        sender._mux.carrier.emit('error', err);
        sender.emit('error', err);
    }
    /*jslint unparam: false */

    function unknown_message(sender, receiver, cb)
    {
        receiver._mux.on('error', function (err)
        {
            expect(err.message).to.equal('short buffer length 1 < 5');
            cb();
        });

        sender.write('a', function (err)
        {
            if (err) { return cb(err); }
            sender._mux._out_stream.write('a');
        });
    }

    function unknown_type(sender, receiver, cb)
    {
        receiver._mux.on('error', function (err)
        {
            expect(err.message).to.equal('unknown type: 200');
            cb();
        });

        receiver.on('handshake', function (i)
        {
            var buf = make_buffer(sender, 5);
            buf.writeUInt8(200, 0, true);
            buf.writeUInt32BE(i, 1, true);
            sender._mux._out_stream.write(buf);
        });
    }

    function emit_error(sender, receiver, cb)
    {
        receiver._mux.on('peer_multiplex', csebemr);

        receiver._mux.on('error', function (err)
        {
            expect(err.message).to.equal('expected handshake, got: 255');
            cb();
        });

        var buf = make_buffer(sender, 5);
        buf.writeUInt8(255, 0, true);
        buf.writeUInt32BE(0, 1, true);
        sender._mux._out_stream.write(buf);
    }

    function max_write_size(sender, receiver, cb)
    {
        var sender_out = get_crypto(sender).randomBytes(64),
            receiver_out = get_crypto(receiver).randomBytes(64),
            sender_in = [],
            receiver_in = [];

        function check1()
        {
            expect(sender_in.length).to.be.at.most(4);
            expect(receiver_in.length).to.be.at.most(4);

            if ((sender_in.length === 4) &&
                (receiver_in.length === 4))
            {
                expect(buffer_concat(sender, sender_in).toString('hex')).to.eql(receiver_out.toString('hex'));
                expect(buffer_concat(receiver, receiver_in).toString('hex')).to.eql(sender_out.toString('hex'));
                sender.end();
            }
        }

        sender.on('end', cb);

        sender.on('readable', function ()
        {
            var data = this.read();

            if (data)
            {
                expect(data.length).to.equal(16);
                sender_in.push(data);
                check1();
            }
        });

        receiver.on('readable', function ()
        {
            var data = this.read();

            if (data)
            {
                expect(data.length).to.equal(16);
                receiver_in.push(data);
                check1();
            }
        });

        receiver.on('end', function ()
        {
            this.end();
        });

        sender.write(sender_out);
        receiver.write(receiver_out);
    }
 
    function read_overflow(sender, receiver, cb)
    {
        receiver._mux._in_stream._events.readable = [
            function ()
            {
                receiver.unshift(make_buffer(receiver, 1));
                receiver._mux._in_stream._events.readable.shift();
            },
            receiver._mux._in_stream._events.readable];

        receiver.once('error', function (err)
        {
            expect(err.message).to.equal('too much data');
            cb();
        });

        sender.write(make_buffer(sender, 100));
    }

    function disable_read_overflow(sender, receiver, cb)
    {
        var size = 0;

        receiver._mux._in_stream._events.readable = [
            function ()
            {
                receiver.unshift(make_buffer(receiver, 1));
                receiver._mux._in_stream._events.readable.shift();
            },
            receiver._mux._in_stream._events.readable];

        receiver.on('end', function ()
        {
            expect(size).to.equal(101);
            this.end();
            cb();
        });

        receiver.on('readable', function ()
        {
            var data;

            while (true)
            {
                data = this.read();

                if (data === null)
                {
                    break;
                }

                size += data.length;
            }
        });

        sender.end(make_buffer(sender, 100));
    }

    /*jslint unparam: true */
    function no_zero_length_data(sender, receiver, cb)
    {
        sender.on('handshake', function ()
        {
            var called = 0;

            sender._mux._out_stream.write = function (data)
            {
                expect(data.length).to.be.above(0);
                called += 1;
            };

            sender.write(make_buffer(sender, 0));
            expect(called).to.equal(0);

            sender.write(make_buffer(sender, 1));
            expect(called).to.equal(2); // header and data

            cb();
        });
    }
    /*jslint unparam: false */

    function wrap_sequence_numbers(sender, receiver, cb)
    {
        sender.on('handshake', function ()
        {
            var msg = '';

            sender._seq = Math.pow(2, 32) - 4;

            sender.on('end', function ()
            {
                expect(this._remote_free).to.equal(100);
                expect(this._seq).to.equal(7);
                cb();
            });

            sender.on('readable', drain);
            
            sender.write('h'); // test remote_free calc after wrap
                               // (local seq will be less than remote)
            sender.end('ello there');

            receiver.on('readable', function ()
            {
                var data;
                while (true)
                {
                    data = this.read();
                    if (data === null)
                    {
                        break;
                    }
                    msg += data.toString();
                }
            });

            receiver.on('end', function ()
            {
                expect(msg).to.equal('hello there');
                this.end();
            });
        });
    }

    function more_than_hwm(sender, receiver, cb)
    {
        var buf = get_crypto(sender).randomBytes(150);

        receiver.once('readable', function ()
        {
            expect(sender._remote_free).to.equal(0);
            expect(this.read(150)).to.equal(null);

            this.once('readable', function ()
            {
                expect(sender._remote_free).to.equal(106);
                expect(this.read(150).toString('hex')).to.equal(buf.toString('hex'));

                this.on('end', function ()
                {
                    expect(this._readableState.highWaterMark).to.equal(256);
                    this.end();
                });

                this.once('readable', function ()
                {
                    expect(this.read()).to.equal(null);
                });
            });
        });

        sender.on('end', function ()
        {
            expect(this._remote_free).to.equal(256);
            cb();
        });

        sender.on('readable', drain);

        sender.end(buf);
    }

    function end_before_handshaken(sender, receiver, cb)
    {
        var sender_handshaken = false,
            receiver_handshaken = false,
            receiver_ended = false;

        sender.on('handshake', function ()
        {
            sender_handshaken = true;
        });

        receiver._mux.on('peer_multiplex', function (duplex)
        {
            if (duplex._chan !== sender._chan)
            {
                return;
            }

            expect(duplex._end_pending).to.equal(false);

            duplex.on('handshake', function ()
            {
                receiver_handshaken = true;
            });

            duplex.on('readable', drain);

            duplex.on('end', function ()
            {
                receiver_ended = true;
                this.end();
            });

            process.nextTick(function ()
            {
                expect(duplex._end_pending).to.equal(true);
                expect(sender_handshaken).to.equal(false);
                expect(receiver_handshaken).to.equal(false);
                expect(receiver_ended).to.equal(false);
                sender._send_handshake();
            });
        });

        sender.on('readable', drain);

        sender.on('end', function ()
        {
            expect(sender_handshaken).to.equal(true);
            expect(receiver_handshaken).to.equal(true);
            expect(receiver_ended).to.equal(true);
            cb();
        });

        sender.end();
    }

    /*jslint unparam: true */
    function error_on_mux(sender, receiver, cb)
    {
        var err = new Error('foobar');

        sender._mux.on('error', function (e)
        {
            expect(e.message).to.equal('foobar');
            cb();
        });

        sender._mux.carrier.emit('error', err);
    }
    /*jslint unparam: false */

    function drain_event(sender, receiver, cb)
    {
        var send_buf = get_crypto(sender).randomBytes(50 * 1024),
            receive_bufs = [],
            drain_called = false,
            out_stream_drain_called = false;

        receiver.on('readable', function ()
        {
            var data;
            while (true)
            {
                data = this.read();
                if (data === null)
                {
                    break;
                }
                receive_bufs.push(data);
            }

        });

        receiver.on('end', function ()
        {
            expect(drain_called).to.equal(true);
            expect(buffer_concat(receiver, receive_bufs).toString('hex')).to.equal(send_buf.toString('hex'));
            cb();
        });

        sender._mux._out_stream.setMaxListeners(0);
        sender._mux._out_stream.on('drain', function ()
        {
            out_stream_drain_called = true;

        });

        sender.on('drain', function ()
        {
            expect(out_stream_drain_called).to.equal(true);
            drain_called = true;
            this.end();
        });

        expect(sender.write(send_buf)).to.equal(false);
    }

    function no_data_after_end(sender, receiver, cb)
    {
        var s = '';

        receiver._mux.on('peer_multiplex', csebemr);

        receiver.on('readable', function ()
        {
            var data;
            while (true)
            {
                data = this.read();
                if (data === null) { return; }
                s += data;
            }
        });

        receiver.on('end', function ()
        {
            expect(s).to.equal('');
            cb();
        });

        receiver._mux._in_stream.on('readable', function ()
        {
            if (receiver._mux._reading_duplex)
            {
                receiver._mux._reading_duplex.push(null);
            }
        });

        sender.end('12345');
    }

    function small_high_water_mark(sender, receiver, cb)
    {
        var sender_buf = get_crypto(sender).randomBytes(5),
            receiver_bufs = [],
            orig_transform = receiver._mux._in_stream._transform;

        if (!orig_transform.replaced)
        {
            receiver._mux._in_stream._transform = function (chunk, enc, cont)
            {
                var ths = this;
                // test re-assembly of headers
                orig_transform.call(this, chunk.slice(0, 1), enc, function ()
                {
                    orig_transform.call(ths, chunk.slice(1), enc, cont);
                });
            };
            receiver._mux._in_stream._transform.replaced = true;
        }

        receiver.on('readable', function ()
        {
            var data = this.read();
            if (data !== null)
            {
                expect(data.length).to.equal(1);
                receiver_bufs.push(data);
            }
        });

        receiver.on('end', function ()
        {
            expect(sender_buf.toString('hex')).to.equal(buffer_concat(receiver, receiver_bufs).toString('hex'));
            cb();
        });

        sender.end(sender_buf);
    }

    function fragmented_data(sender, receiver, cb)
    {
        var sender_buf = get_crypto(sender).randomBytes(64 * 1024),
            receiver_bufs = [],
            orig_transform = receiver._mux._in_stream._transform;

        if (!orig_transform.replaced)
        {
            receiver._mux._in_stream._transform = function (chunk, enc, cont)
            {
                var ths = this,
                    index = Math.max(0, chunk.length - 30);
                orig_transform.call(this, chunk.slice(0, index), enc, function ()
                {
                    orig_transform.call(ths, chunk.slice(index), enc, cont);
                });
            };
            receiver._mux._in_stream._transform.replaced = true;
        }

        receiver.on('readable', function ()
        {
            var data = this.read();
            if (data !== null)
            {
                receiver_bufs.push(data);
            }
        });

        receiver.on('end', function ()
        {
            expect(sender_buf.toString('hex')).to.equal(buffer_concat(receiver, receiver_bufs).toString('hex'));
            cb();
        });

        sender.end(sender_buf);
    }

    function fragmented_data_with_read_zero(sender, receiver, cb)
    {
        var sender_buf = get_crypto(sender).randomBytes(64 * 1024),
            receiver_bufs = [],
            orig_transform = receiver._mux._in_stream._transform;

        if (!orig_transform.replaced)
        {
            receiver._mux._in_stream._transform = function (chunk, enc, cont)
            {
                var ths = this,
                    index = Math.max(0, chunk.length - 30);
                orig_transform.call(this, chunk.slice(0, index), enc, function ()
                {
                    orig_transform.call(ths, chunk.slice(index), enc, cont);
                });
            };
            receiver._mux._in_stream._transform.replaced = true;
        }

        function read()
        {
            var data;

            while (true)
            {
                data = receiver.read();
                if (data === null)
                {
                    break;
                }
                receiver_bufs.push(data);
            }
        }

        receiver.once('readable', function ()
        {
            // give time for the sender to send more
            setTimeout(function ()
            {
                receiver.on('readable', read);
                read();
            }, 2000);

            this.read(0);
        });

        receiver.on('end', function ()
        {
            expect(sender_buf.toString('hex')).to.equal(buffer_concat(receiver, receiver_bufs).toString('hex'));
            cb();
        });

        sender.end(sender_buf);
    }

    function short_status_message(sender, receiver, cb)
    {
        /*jslint unparam: true */
        sender.on('handshake', function (handshake_data, delay_handshake)
        {
            var called = false, buf;

            receiver._mux.on('error', function (err)
            {
                expect(err.message).to.equal('short buffer length 5 < 13');
                called = true;
            });

            receiver.on('readable', drain);
            receiver.on('end', function ()
            {
                expect(called).to.equal(true);
                cb();
            });
            
            if (delay_handshake) // in both mode, called with server as sender
            {
                delay_handshake()();
            }

            buf = make_buffer(sender, 5);
            buf.writeUInt8(2, 0, true); // TYPE_STATUS
            buf.writeUInt32BE(sender._chan, 1, true);
            sender._mux._out_stream.write(buf);
            sender.end('a');
        });
        /*jslint unparam: false */
    }

    function short_handshake_message(sender, receiver, cb)
    {
        var called = false, buf;

        receiver._mux.on('peer_multiplex', csebemr);

        receiver._mux.on('error', function (err)
        {
            expect(err.message).to.equal('short buffer length 5 < 9');
            if (!called)
            {
                called = true;
                cb();
            }
        });

        buf = make_buffer(sender, 5);
        buf.writeUInt8(1, 0, true); // TYPE_HANDSHAKE
        buf.writeUInt32BE(sender._chan, 1, true);
        sender._mux._out_stream.write(buf);
    }

    function short_pre_handshake_message(sender, receiver, cb)
    {
        var called = false, buf;

        receiver._mux.on('peer_multiplex', csebemr);

        receiver._mux.on('error', function (err)
        {
            expect(err.message).to.equal('short buffer length 5 < 9');
            if (!called)
            {
                called = true;
                cb();
            }
        });

        buf = make_buffer(sender, 5);
        buf.writeUInt8(5, 0, true); // TYPE_PRE_HANDSHAKE
        buf.writeUInt32BE(sender._chan, 1, true);
        sender._mux._out_stream.write(buf);
    }

    function not_parse_handshake_data(sender, receiver, cb)
    {
        var sender_called = false, receiver_called = false;

        sender.on('handshake', function (handshake_data)
        {
            expect(handshake_data.toString('hex')).to.equal('00000000');
            sender_called = true;
            if (sender_called && receiver_called)
            {
                cb();
            }
        });

        receiver.on('handshake', function (handshake_data)
        {
            expect(handshake_data.toString('hex')).to.equal('00000000');
            receiver_called = true;
            if (sender_called && receiver_called)
            {
                cb();
            }
        });
    }

    function end_without_finish(sender, receiver, cb)
    {
        receiver.on('end', cb);
        receiver.on('readable', function ()
        {
            while (this.read() !== null)
            {
            }
        });
        sender.end();
    }

    function setup(n)
    {
        function calln(description, f, max, not_both)
        {
            max = max || n;
            if (n > max) { return; }

            var b = not_both ? function (x) { return x; } : both;

            function make_title(s)
            {
                var title = '(x' + n + s + ') ' + description;

                if (description instanceof WithOptions)
                {
                    return new WithOptions(title,
                                           description.mux_options,
                                           description.multiplex_options);
                }

                return title;
            }

            it(make_title(', client initiated'), function (cb)
            {
                async.times(n, multiplex.call(
                        this, n, b(f), client_mux, server_mux), cb);
            });

            it(make_title(', server initiated'), function (cb)
            {
                async.times(n, multiplex.call(
                        this, n, b(f), server_mux, client_mux), cb);
            });
        }

        calln('should support fragmented data',
              fragmented_data);

        calln('should support fragmented data when read(0) sends status message',
              fragmented_data_with_read_zero);

        calln(new WithOptions('should support not parsing handshake data',
                              {
                                  parse_handshake_data: undefined
                              }),
              not_parse_handshake_data,
              1);

        function check_handshake_this(buf)
        {
            /*jshint validthis: true */
            if (this.name === 'client')
            {
                expect(this).to.equal(client_mux);
            }
            else
            {
                expect(this).to.equal(server_mux);
            }
            return parse_handshake_data(buf);
        }

        calln(new WithOptions('should pass this as mux in parse_handshake_data',
                              {
                                  parse_handshake_data: check_handshake_this
                              }),
              single_byte);

        calln(new WithOptions('should emit an error if handshake message length too short',
                              {
                                  peer_multiplex_options: {
                                      _delay_handshake: true
                                  }
                              },
                              {
                                  _delay_handshake: true
                              }),
              short_handshake_message,
              null,
              true);

        calln(new WithOptions('should emit an error if pre-handshake message length too short',
                              {
                                  peer_multiplex_options: {
                                      _delay_handshake: true
                                  }
                              },
                              {
                                  _delay_handshake: true
                              }),
              short_pre_handshake_message,
              null,
              true);

        calln('should emit an error if status message length too short',
              short_status_message);

        calln(new WithOptions('should support small high-water marks',
                              {
                                  peer_multiplex_options: {
                                      highWaterMark: 1
                                  }
                              },
                              {
                                  highWaterMark: 1
                              }),
              small_high_water_mark);

        calln('should not deliver data if duplex has ended',
              no_data_after_end,
              1,
              true);

        calln(new WithOptions('should emit drain event on mux and duplex',
                              {
                                  peer_multiplex_options: {
                                      highWaterMark: 25 * 1024
                                  }
                              },
                              {
                                  highWaterMark: 25 * 1024
                              }),
              drain_event);

        calln('should emit error on mux when no error listener on duplex',
              error_on_mux,
              1);

        calln(new WithOptions('should not end before handshaken',
                              null,
                              {
                                  _delay_handshake: true
                              }),
              end_before_handshaken,
              null,
              true);

        calln('should emit an error when unknown message type is received',
              unknown_type,
              1);

        calln('should write a single byte to multiplexed streams',
              single_byte);

        calln('should write multiple bytes to multiplexed streams',
              multi_byte);

        calln('should write large buffer to multiplexed streams',
              large_buffer);

        calln('should be able to delay status messages',
              delay_status);

        calln('should handle write backpressure',
              write_backpressure,
              10);

        calln('should handle flow mode',
              flow_mode);

        calln('should be able to pipe',
              pipe,
              null,
              true);

        calln('should expose error events',
              error_event,
              1);

        calln('should emit an error when unknown message is received',
              unknown_message,
              1);

        calln(new WithOptions('should support default options'),
              multi_byte,
              1);

        calln(new WithOptions('should emit an error if first message is not handshake',
                              null,
                              {
                                  _delay_handshake: true
                              }),
              emit_error,
              1);

        calln(new WithOptions('should support a maximum write size',
                              {
                                  peer_multiplex_options: {
                                      max_write_size: 16,
                                      highWaterMark: 100
                                  }
                              },
                              {
                                  max_write_size: 16,
                                  highWaterMark: 100
                              }),
              max_write_size,
              1,
              true);

        calln(new WithOptions('should detect Read overflow',
                              {
                                  peer_multiplex_options: {
                                      highWaterMark: 100
                                  }
                              },
                              {
                                  highWaterMark: 100
                              }),
              read_overflow,
              1);

        calln(new WithOptions('should support disabling read overflow',
                              {
                                  peer_multiplex_options: {
                                      highWaterMark: 100,
                                      check_read_overflow: false
                                  }
                              },
                              {
                                  highWaterMark: 100,
                                  check_read_overflow: false
                              }),
              disable_read_overflow,
              1);

        calln('should not write zero length data',
              no_zero_length_data,
              1,
              true);

        calln(new WithOptions('should wrap sequence numbers',
                              {
                                  peer_multiplex_options: {
                                      highWaterMark: 100
                                  }
                              },
                              {
                                  highWaterMark: 100
                              }),
              wrap_sequence_numbers,
              1,
              true);

        calln(new WithOptions('should support reading and writing more than the high-water mark',
                              {
                                  peer_multiplex_options: {
                                      highWaterMark: 100
                                  }
                              },
                              {
                                  highWaterMark: 100
                              }),
              more_than_hwm,
              1,
              true);
       
        calln('end without finish',
              end_without_finish,
              1,
              true);
    }

    setup(1);
    setup(2);
    setup(fast ? 5 : 10);

    it(new WithOptions('should pass null delay_handshake if handshake already sent',
                       {
                           parse_handshake_data: undefined
                       }),
    function (cb)
    {
        var duplex = client_mux.multiplex(
        {
            handshake_data: new ClientBuffer('foo')
        });
        expect(duplex._handshake_sent).to.equal(false);
        csebemr(duplex);
        duplex.on('handshake', function (handshake_data, delay_handshake)
        {
            expect(handshake_data.toString()).to.equal('bar');
            expect(duplex._handshake_sent).to.equal(true);
            expect(delay_handshake).to.equal(null);
            cb();
        });

        server_mux.on('handshake', function (duplex, handshake_data, delay_handshake)
        {
            expect(handshake_data.toString()).to.equal('foo');
            expect(duplex._handshake_sent).to.equal(false);
            expect(delay_handshake).not.to.equal(null);
            csebemr(duplex);
            delay_handshake()(new Buffer('bar'));
        });
    });

    it('should be able to specify channel number', function (cb)
    {
        var c100 = false, s100 = false, c200 = false, s200 = false;

        function check1()
        {
            if (c100 && s100 && c200 && s200)
            {
                cb();
            }
        }

        var client_duplex100 = client_mux.multiplex(
        {
            channel: 100
        });
        add_duplex(client_duplex100);
        expect(client_duplex100.get_channel()).to.equal(100);
        client_duplex100.write('a');
        client_duplex100.on('readable', function ()
        {
            var data = this.read();
            if (data !== null)
            {
                expect(c100).to.equal(false);
                c100 = true;
                expect(data.toString()).to.equal('b');
                check1();
            }
        });

        var server_duplex100 = server_mux.multiplex(
        {
            channel: 100
        });
        add_duplex(server_duplex100);
        expect(server_duplex100.get_channel()).to.equal(100);
        server_duplex100.write('b');
        server_duplex100.on('readable', function ()
        {
            var data = this.read();
            if (data !== null)
            {
                expect(s100).to.equal(false);
                s100 = true;
                expect(data.toString()).to.equal('a');
                check1();
            }
        });

        var client_duplex200 = client_mux.multiplex(
        {
            channel: 200
        });
        add_duplex(client_duplex200);
        expect(client_duplex200.get_channel()).to.equal(200);
        client_duplex200.write('c');
        client_duplex200.on('readable', function ()
        {
            var data = this.read();
            if (data !== null)
            {
                expect(c200).to.equal(false);
                c200 = true;
                expect(data.toString()).to.equal('d');
                check1();
            }
        });

        var server_duplex200 = server_mux.multiplex(
        {
            channel: 200
        });
        add_duplex(server_duplex200);
        expect(server_duplex200.get_channel()).to.equal(200);
        server_duplex200.write('d');
        server_duplex200.on('readable', function ()
        {
            var data = this.read();
            if (data !== null)
            {
                expect(s200).to.equal(false);
                s200 = true;
                expect(data.toString()).to.equal('c');
                check1();
            }
        });
    });

    it('should be able to use a control channel to ask for new duplexes', function (cb)
    {
        var client_duplex = client_mux.multiplex(
        {
            handshake_data: make_buffer(client_mux, 'control')
        });
        add_duplex(client_duplex);
        client_duplex.write('aaaaa');

        var count = 0;

        client_mux.on('handshake', function (duplex, handshake_data)
        {
            if (handshake_data.toString() !== 'control')
            {
                add_duplex(duplex);
            }
            count += 1;
            expect(count).to.be.at.most(6); // 1 for return handshake on control
            if (count === 6)
            {
                return cb();
            }
        });

        server_mux.once('handshake', function (server_duplex,
                                               handshake_data,
                                               delay_handshake)
        {
            expect(handshake_data.toString()).to.equal('control');
            add_duplex(server_duplex);
            delay_handshake()(handshake_data);

            server_duplex.on('readable', function ()
            {
                var data = this.read(), i;
                if (data === null) { return; }

                for (i = 0; i < data.length; i += 1)
                {
                    add_duplex(server_mux.multiplex());
                }
            });
        });
    });

    it('should support write before handshaken', function (cb)
    {
        var client_duplex = client_mux.multiplex(
        {
            _delay_handshake: true
        });
        client_duplex.name = 'client';
        add_duplex(client_duplex);
        client_duplex.end('x');
        client_duplex._send_handshake();

        client_duplex.on('readable', function ()
        {
            var data = this.read();
            if (data === null) { return; }
            expect(data.toString()).to.equal('y');
            cb();
        });

        /*jslint unparam: true */
        server_mux.on('handshake', function (server_duplex,
                                             handshake_data,
                                             delay_handshake)
        {
            server_duplex.name = 'server';
            add_duplex(server_duplex);
            var send_handshake = delay_handshake();
            server_duplex.end('y');
            send_handshake();
            server_duplex.on('readable', function ()
            {
                var data = this.read();
                if (data === null) { return; }
                expect(data.toString()).to.equal('x');
            });
        });
        /*jslint unparam: false */
    });

    it(new WithOptions('should emit a full event when maximum number of open duplexes exceeded',
                       {
                           max_open: 3
                       }),
    function (cb)
    {
        server_mux.on('peer_multiplex', csebemr);
        server_mux.on('full', cb);
        client_mux._max_open = 0;
        csebemr(client_mux.multiplex());
        csebemr(client_mux.multiplex());
        csebemr(client_mux.multiplex());
        csebemr(client_mux.multiplex());
    });

    it(new WithOptions('should be able to limit header size',
                       {
                           max_header_size: 64 * 1024
                       }),
    function (cb)
    {
        server_mux.on('peer_multiplex', csebemr);
        var duplex = client_mux.multiplex();
        csebemr(duplex);
        duplex.on('handshake', function ()
        {
            server_mux.on('handshake', function ()
            {
                cb(new Error('should not be called'));
            });

            server_mux.on('error', function (err)
            {
                expect(err.message).to.equal('header too big');
                cb();
            });

            csebemr(client_mux.multiplex(
            {
                handshake_data: new Buffer(1024 * 1024)
            }));
        });
    });
}

module.exports = function(
        type,
        ServerBPMux, make_server, end_server, end_server_conn,
        ClientBPMux, make_client_conn, end_client_conn,
        ClientBuffer, client_crypto,
        fast)
{
    [ false, true ].forEach(function (coa)
    {
        describe(type + ' coa=' + coa, function ()
        {
            test(ServerBPMux, make_server, end_server, end_server_conn,
                 ClientBPMux, make_client_conn, end_client_conn,
                 ClientBuffer, client_crypto,
                 coa, fast);
        });
    });
};
