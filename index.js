/**
# bpmux&nbsp;&nbsp;&nbsp;[![Build Status](https://travis-ci.org/davedoesdev/bpmux.png)](https://travis-ci.org/davedoesdev/bpmux) [![Coverage Status](https://coveralls.io/repos/davedoesdev/bpmux/badge.png?branch=master&service=github)](https://coveralls.io/r/davedoesdev/bpmux?branch=master) [![NPM version](https://badge.fury.io/js/bpmux.png)](http://badge.fury.io/js/bpmux)

Node stream multiplexing with back-pressure on each stream.

- Run more than one [`stream.Duplex`](https://nodejs.org/api/stream.html#stream_class_stream_duplex) over a carrier `Duplex`.
- Exerts back-pressure on each multiplexed stream and the underlying carrier stream.
- Each multiplexed stream's back-pressure is handled separately while respecting the carrier's capacity.
- Unit tests with 100% coverage.
- Tested with TCP streams and [Primus](https://github.com/primus/primus) (using [primus-backpressure](https://github.com/davedoesdev/primus-backpressure)) - works in the browser!
- Browser unit tests using [webpack](http://webpack.github.io/) and [nwjs](http://nwjs.io/).

The API is described [here](#api).

## Example

Multiplexing multiple streams over a single TCP stream:

```javascript
var net = require('net'),
    crypto = require('crypto'),
    assert = require('assert'),
    BPMux = require('bpmux'),
    sent = [];

net.createServer(function (c)
{
    var received = [], ended = 0;

    new BPMux(c).on('handshake', function (duplex)
    {
        var accum = '';

        duplex.on('readable', function ()
        {
            var data = this.read();
            if (data)
            {
                accum += data.toString('hex');
            }
        });

        duplex.on('end', function ()
        {
            received.push(accum);

            ended += 1;
            assert(ended <= 10);
            if (ended === 10)
            {
                assert.deepEqual(received.sort(), sent.sort());
            }
        });
    });
}).listen(7000, function ()
{
    var mux = new BPMux(net.createConnection(7000)), i;

    function multiplex(n)
    {
        mux.multiplex(function (err, duplex)
        {
            assert.ifError(err);
            var data = crypto.randomBytes(n * 100);
            duplex.end(data);
            sent.push(data.toString('hex'));
        });
    }

    for (i = 1; i <= 10; i += 1)
    {
        multiplex(i);
    }
});
```

## Another Example

Multiple return pipes to the browser, multiplexed over a single Primus connection:

```javascript
var PrimusDuplex = require('primus-backpressure').PrimusDuplex,
    BPMux = require('bpmux'),
    http = require('http'),
    path = require('path'),
    crypto = require('crypto'),
    stream = require('stream'),
    assert = require('assert'),
    finalhandler = require('finalhandler'),
    serve_static = require('serve-static'),
    Primus = require('primus'),
    serve = serve_static(__dirname);

http.createServer(function (req, res)
{
    serve(req, res, finalhandler(req, res));
}).listen(7500, function ()
{
    var primus = new Primus(this);

    primus.on('connection', function (spark)
    {
        var mux = new BPMux(new PrimusDuplex(spark)), ended = 0, i;

        function multiplex(n)
        {
            mux.multiplex({ handshake_data: new Buffer([n]) },
            function (err, duplex)
            {
                assert.ifError(err);

                var buf = crypto.randomBytes(10 * 1024),
                    buf_stream = new stream.PassThrough(),
                    bufs = [];

                buf_stream.end(buf);
                buf_stream.pipe(duplex);

                duplex.on('readable', function ()
                {
                    var data;

                    while (true)
                    {
                        data = this.read();
                        if (data === null)
                        {
                            break;
                        }
                        bufs.push(data);
                    }
                });

                duplex.on('end', function ()
                {
                    console.log('end', n);
                    ended += 1;
                    assert(ended <= 10);
                    assert.deepEqual(Buffer.concat(bufs), buf);
                });
            });
        }

        for (i = 0; i < 10; i += 1)
        {
            multiplex(i);
        }
    });
    
    console.log('Point your browser to http://localhost:7500/loader.html');
});
```

The HTML (`loader.html`) for the browser-side of this example:

```html
<html>
  <head>
    <title>BPMux Test Runner</title>
    <script type="text/javascript" src="/primus/primus.js"></script>
    <script type="text/javascript" src="bundle.js"></script>
    <script type="text/javascript" src="loader.js"></script>
  </head>
  <body onload='doit()'>
  </body>
</html>
```

The browser-side code (`loader.js`):

```javascript
function doit()
{
    var mux = new BPMux(new PrimusDuplex(new Primus({ strategy: false })));

    mux.on('handshake', function (duplex, handshake_data)
    {
        console.log("handshake", handshake_data[0]);
        duplex.pipe(duplex);

        duplex.on('end', function ()
        {
            console.log('end', handshake_data[0]);
        });
    });
}
```

The browser-side dependencies (`bundle.js`) can be produced by webpack from:

```javascript
PrimusDuplex = require('primus-backpressure').PrimusDuplex;
BPMux = require('bpmux').BPMux;
```

## Installation

```shell
npm install bpmux
```

## Licence

[MIT](LICENCE)

## Test

Over TCP (long test):

```shell
grunt test
```

Over TCP (quick test):

```shell
grunt test-fast
```

Over Primus (using nwjs to run browser- and server-side):

```shell
grunt test-browser
```

The examples at the top of this page:

```shell
grunt test-examples
```

## Code Coverage

```shell
grunt coverage
```

[Instanbul](http://gotwarlost.github.io/istanbul/) results are available [here](http://rawgit.davedoesdev.com/davedoesdev/bpmux/master/coverage/lcov-report/index.html).

Coveralls page is [here](https://coveralls.io/r/davedoesdev/bpmux).

## Lint

```shell
grunt lint
```

# API
*/
/*jslint node: true, nomen: true, unparam: true */
'use strict';

var util = require('util'),
    Duplex = require('stream').Duplex,
    EventEmitter = require('events').EventEmitter,
    frame = require('frame-stream'),
    max_seq = Math.pow(2, 32),
    TYPE_END = 0,
    TYPE_HANDSHAKE = 1,
    TYPE_STATUS = 2,
    TYPE_FINISHED_STATUS = 3,
    TYPE_DATA = 4;

function BPDuplex(options, mux, chan)
{
    Duplex.call(this, options);

    options = options || {};

    this._mux = mux;
    this._chan = chan;
    this._max_write_size = options.max_write_size || 0;
    this._check_read_overflow = options.check_read_overflow !== false;
    this._seq = 0;
    this._remote_free = 0;
    this._data = null;
    this._cb = null;
    this._index = 0;
    this._finished = false;
    this._ended = false;
    this._removed = false;
    this._handshake_sent = false;
    this._handshake_received = false;

    function check_remove()
    {
        if (this._finished && this._ended && !this._removed)
        {
            this._mux._remove(this);
        }
    }

    this.on('finish', function ()
    {
        this._finished = true;
        this._mux._send_end(this);
        check_remove.call(this);
    });

    this.on('end', function ()
    {
        this._ended = true;
        check_remove.call(this);
    });

    if (!options._delay_handshake)
    {
        this._send_handshake(options.handshake_data);
    }
}

util.inherits(BPDuplex, Duplex);

BPDuplex.prototype.get_channel = function ()
{
    return this._chan;
};

BPDuplex.prototype._send_handshake = function (handshake_data)
{
    this._mux._send_handshake(this, handshake_data || new Buffer(0));
};

BPDuplex.prototype._read = function () { return undefined; };

BPDuplex.prototype.read = function (size, send_status)
{
    var r = Duplex.prototype.read.call(this, size);

    if (send_status !== false)
    {
        this._mux._send_status(this);
    }

    return r;
};

BPDuplex.prototype._write = function (data, encoding, cb)
{
    if (data.length === 0)
    {
        return cb();
    }

    this._data = data;
    this._cb = cb;
    this._mux._send();
};

/**
Constructor for a `BPMux` object which multiplexes more than one [`stream.Duplex`](https://nodejs.org/api/stream.html#stream_class_stream_duplex) over a carrier `Duplex`.

@constructor
@extends events.EventEmitter

@param {Duplex} carrrier The `Duplex` stream over which other `Duplex` streams will be multiplexed.

@param {Object} [options] Configuration options:

  - `{Object} [peer_multiplex_options]` When your `BPMux` object detects a new multiplexed stream from the peer on the carrier, it creates a new `Duplex` and emits a [`peer_multiplex`](#bpmuxeventspeer_multiplexduplex) event. When it creates the `Duplex`, it uses `peer_multiplex_options` to configure it with the following options:

    - `{Integer} [max_write_size]` Maximum number of bytes to write to the `Duplex` at once, regardless of how many bytes the peer is free to receive. Defaults to 0 (no limit).

    - `{Boolean} [check_read_overflow]` Whether to check if more data than expected is being received. If `true` and the `Duplex`'s high-water mark for reading is exceeded then the `Duplex` emits an `error` event. This should not normally occur unless you add data yourself using [`readable.unshift`](http://nodejs.org/api/stream.html#stream_readable_unshift_chunk) &mdash; in which case you should set `check_read_overflow` to `false`. Defaults to `true`.

  - `{Function} [parse_handshake_data(handshake_data)]` When a new stream is multiplexed, the `BPMux` objects at each end of the carrier exchange a handshake message. You can supply application-specific handshake data to add to the handshake message (see [`BPMux.prototype.multiplex`](#bpmuxprototypemultiplexoptions-cb) and [`BPMux.events.handshake`](#bpmuxeventshandshakeduplex-handshake_data-delay_handshake)). By default, when handshake data from the peer is received, it's passed to your application as a raw [`Buffer`](https://nodejs.org/api/buffer.html#buffer_buffer). Use `parse_handshake_data` to specify a custom parser. It will receive the `Buffer` as an argument and should return a value which makes sense to your application.
  
  - `{Boolean} [coalesce_writes]` Whether to batch together writes to the carrier. When the carrier indicates it's ready to receive data, its spare capacity is shared equally between the multiplexed streams. By default, the data from each stream is written separately to the carrier. Specify `true` to write all the data to the carrier in a single write. Depending on the carrier, this can be more performant.
*/
function BPMux(carrier, options)
{
    EventEmitter.call(this, options);

    options = options || {};

    this._max_duplexes = Math.pow(2, 32);
    this._duplexes = {};
    this._chan = 0;
    this._finished = false;
    this._ended = false;
    this._header_buffers = [];
    this._header_buffer_len = 0;
    this._reading_duplex = null;
    this._peer_multiplex_options = util._extend(util._extend(
        {}, options.peer_multiplex_options || {}),
        {
            _delay_handshake: true
        });
    this._parse_handshake_data = options.parse_handshake_data;
    this._coalesce_writes = options.coalesce_writes;
    this._carrier = carrier;

    this._out_stream = frame.encode(options);

    if (this._coalesce_writes)
    {
        this._out_stream._pushFrameData = function (bufs)
        {
            var i;
            for (i = 0; i < bufs.length; i += 1)
            {
                this.push(bufs[i]);
            }
        };
    }

    this._out_stream.pipe(carrier);

    this._in_stream = frame.decode(util._extend(util._extend(
        {}, options),
        {
            unbuffered: true
        }));
    carrier.pipe(this._in_stream);

    var ths = this;

    carrier.on('prefinish', function ()
    {
        ths._finished = true;

        Object.keys(ths._duplexes).forEach(function (chan)
        {
            ths._duplexes[chan].end();
        });
    });

    this._in_stream.on('end', function ()
    {
        ths._ended = true;

        Object.keys(ths._duplexes).forEach(function (chan)
        {
            ths._duplexes[chan].push(null);
        });
    });

    function error(err)
    {
        Object.keys(ths._duplexes).forEach(function (chan)
        {
            var duplex = ths._duplexes[chan];

            if (EventEmitter.listenerCount(duplex, 'error') > 0)
            {
                duplex.emit('error', err);
            }
        });

        ths.emit('error', err);
    }

    carrier.on('error', error);
    this._in_stream.on('error', error);
    this._out_stream.on('error', error);

    this._out_stream.on('drain', function ()
    {
        ths._send();
    });

    this._in_stream.on('readable', function ()
    {
        var data, duplex;

        while (true)
        {
            data = this.read();
            duplex = ths._reading_duplex;

            if (data === null)
            {
                break;
            }

            if (duplex)
            {
                if (data.frameEnd)
                {
                    ths._reading_duplex = null;
                }

                if (!duplex._readableState.ended)
                {
                    if (duplex._check_read_overflow &&
                        ((duplex._readableState.length + data.length) >
                         duplex._readableState.highWaterMark))
                    {
                        duplex.emit('error', new Error('too much data'));
                    }
                    else
                    {
                        duplex.push(data);
                    }
                }
            }
            else
            {
                ths._header_buffers.push(data);
                ths._header_buffer_len += data.length;

                if (data.frameEnd)
                {
                    ths._process_header(Buffer.concat(ths._header_buffers, ths._header_buffer_len));
                    ths._header_buffers = [];
                    ths._header_buffer_len = 0;
                }
            }
        }
    });
}

util.inherits(BPMux, EventEmitter);

BPMux.prototype._check_buffer = function (buf, size)
{
    if (buf.length < size)
    {
        this.emit('error', new Error('short buffer length ' + buf.length + ' < ' + size));
        return false;
    }

    return true;
};

BPMux.prototype._process_header = function (buf)
{
    if (!this._check_buffer(buf, 5)) { return; }

    var type = buf.readUInt8(0, true),
        chan = buf.readUInt32BE(1, true),
        duplex = this._duplexes[chan],
        handshake_data,
        handshake_delayed = false,
        dhs,
        free,
        seq;

    function delay_handshake()
    {
        handshake_delayed = true;
        return function (handshake_data)
        {
            duplex._send_handshake(handshake_data);
        };
    }

    if ((type !== TYPE_FINISHED_STATUS) && !duplex)
    {
        duplex = new BPDuplex(this._peer_multiplex_options, this, chan);
        this._duplexes[chan] = duplex;
        this.emit('peer_multiplex', duplex);
    }

    if (duplex && duplex._handshake_received)
    {
        switch (type)
        {
            case TYPE_END:
                duplex.push(null);
                break;

            case TYPE_STATUS:
            case TYPE_FINISHED_STATUS:
                if (!this._check_buffer(buf, 13)) { return; }
                
                free = buf.readUInt32BE(5, true);
                seq = buf.readUInt32BE(9, true);

                free = duplex._max_write_size > 0 ?
                        Math.min(free, duplex._max_write_size) : free;

                duplex._remote_free = seq + free - duplex._seq;

                if (duplex._seq < seq)
                {
                    duplex._remote_free -= max_seq;
                }

                this._send();

                break;

            case TYPE_DATA:
                duplex._remote_seq = buf.slice(5);
                this._reading_duplex = duplex;
                break;

            default:
                this.emit('error', new Error('unknown type: ' + type));
                break;
        }

        return;
    }

    switch (type)
    {
        case TYPE_END:
            duplex.push(null);
            break;

        case TYPE_HANDSHAKE:
            if (!this._check_buffer(buf, 9)) { return; }
            free = buf.readUInt32BE(5, true);
            duplex._remote_free = duplex._max_write_size > 0 ?
                    Math.min(free, duplex._max_write_size) : free;
            duplex._handshake_received = true;
            handshake_data = this._parse_handshake_data ?
                    this._parse_handshake_data(buf.slice(9)) :
                    buf.slice(9);
            dhs = duplex._handshake_sent ? null : delay_handshake;
            this.emit('handshake', duplex, handshake_data, dhs);
            duplex.emit('handshake', handshake_data, dhs);
            if (!handshake_delayed)
            {
                duplex._send_handshake();
            }
            break;

        case TYPE_FINISHED_STATUS:
            // from old duplex
            break;

        default:
            this.emit('error', new Error('expected handshake, got: ' + type));
            break;
    }
};

BPMux.prototype._remove = function (duplex)
{
    delete this._duplexes[duplex._chan];
};

BPMux.prototype._send_end = function (duplex)
{
    if (this._finished) { return; }

    var buf = new Buffer(1 + 4);

    buf.writeUInt8(TYPE_END, 0, true);
    buf.writeUInt32BE(duplex._chan, 1, true);

    this._out_stream.write(buf);
};

BPMux.prototype._send_handshake = function (duplex, handshake_data)
{
    if (this._finished) { return; }
    if (duplex._handshake_sent) { return this._send(); }
    
    var buf = new Buffer(1 + 4 + 4 + handshake_data.length);

    buf.writeUInt8(TYPE_HANDSHAKE, 0, true);
    buf.writeUInt32BE(duplex._chan, 1, true);
    buf.writeUInt32BE(Math.max(duplex._readableState.highWaterMark - duplex._readableState.length, 0), 5, true);
    handshake_data.copy(buf, 9);

    this._out_stream.write(buf);

    duplex._handshake_sent = true;

    this._send();
};

BPMux.prototype._send_status = function (duplex)
{
    // Note: Status messages are sent regardless of remote_free
    // (if the remote peer isn't doing anything it could never be sent and it
    // could be waiting for a status update). 
    // This means every time the app calls read(), a status message wlll be sent
    // to the remote peer. If you want to control when status messages are
    // sent then use the second parameter of read(), send_status.
    // To force sending a status message without actually reading any data,
    // call read(0).

    if (this._finished ||
        (duplex._remote_seq === undefined) ||
        !duplex._handshake_sent ||
        this._reading_duplex)
    {
        return;
    }

    var free = Math.max(duplex._readableState.highWaterMark - duplex._readableState.length, 0),
        buf;

    if (duplex._prev_status &&
        (duplex._prev_status.free === free) &&
        // we don't care about contents here, just if it's changed
        (duplex._prev_status.seq === duplex._remote_seq))
    {
        return;
    }

    buf = new Buffer(1 + 4 + 4 + duplex._remote_seq.length);
    buf.writeUInt8(duplex._finished ? TYPE_FINISHED_STATUS : TYPE_STATUS, 0, true);
    buf.writeUInt32BE(duplex._chan, 1, true);
    buf.writeUInt32BE(free, 5, true);
    duplex._remote_seq.copy(buf, 9);

    duplex._prev_status = {
        free: free,
        seq: duplex._remote_seq
    };

    this._out_stream.write(buf);
};

BPMux.prototype._send = function ()
{
    var ths = this, space, output, n;

    if (this._finished)
    {
        return;
    }

    function push_output(chan)
    {
        var duplex = ths._duplexes[chan];

        if ((duplex._data === null) ||
            (duplex._remote_free <= 0) ||
            !duplex._handshake_sent)
        {
            return;
        }

        output.push(
        {
            duplex: duplex,
            size: Math.min(duplex._remote_free, duplex._data.length - duplex._index)
        });
    }

    function sort_output(a, b)
    {
        return a.size < b.size;
    }

    function write_output(info)
    {
        var size = Math.min(info.size, Math.max(Math.floor(space / n), 1)),
            buf = new Buffer(1 + 4 + 4),
            buf2 = info.duplex._data.slice(info.duplex._index, info.duplex._index + size),
            cb;

        info.duplex._seq = (info.duplex._seq + size) % max_seq;
        
        buf.writeUInt8(TYPE_DATA, 0, true);
        buf.writeUInt32BE(info.duplex._chan, 1, true);
        buf.writeUInt32BE(info.duplex._seq, 5, true);

        ths._out_stream.write(buf);
        ths._out_stream.write(buf2);
        
        info.duplex._remote_free -= size;
        info.duplex._index += size;

        if (info.duplex._index === info.duplex._data.length)
        {
            info.duplex._data = null;
            info.duplex._index = 0;
            cb = info.duplex._cb;
            info.duplex._cb = null;
            setImmediate(cb);
        }

        space = Math.max(space - size, 0);
        n -= 1;
    }

    while (true)
    {
        space = this._out_stream._writableState.highWaterMark - this._out_stream._writableState.length;
        output = [];

        if (space <= 0)
        {
            break;
        }
        
        Object.keys(this._duplexes).forEach(push_output);
        
        n = output.length;

        if (n === 0)
        {
            break;
        }

        output.sort(sort_output);

        if (this._coalesce_writes)
        {
            this._carrier.cork();
        }

        output.forEach(write_output);
        
        if (this._coalesce_writes)
        {
            this._carrier.uncork();
        }
    }
};

/**
Multiplex a new `stream.Duplex` over the carrier.

@param {Object} [options] Configuration options:

  - `{Buffer} [handshake_data]` Application-specific handshake data to send to the peer. When a new stream is multiplexed, the `BPMux` objects at each end of the carrier exchange a handshake message. You can optionally supply handshake data to add to the handshake message here. The peer application will receive this when its `BPMux` object emits a [`handshake`](#bpmuxeventshandshakeduplex-handshake_data-delay_handshake) event. Defaults to a zero-length `Buffer`.
  
  - `{Integer} [max_write_size]` Maximum number of bytes to write to the `Duplex` at once, regardless of how many bytes the peer is free to receive. Defaults to 0 (no limit).

  - `{Boolean} [check_read_overflow]` Whether to check if more data than expected is being received. If `true` and the `Duplex`'s high-water mark for reading is exceeded then the `Duplex` emits an `error` event. This should not normally occur unless you add data yourself using [`readable.unshift`](http://nodejs.org/api/stream.html#stream_readable_unshift_chunk) &mdash; in which case you should set `check_read_overflow` to `false`. Defaults to `true`.

  - `{Integer} [channel]` Unique number for the new stream. `BPMux` identifies each multiplexed stream by giving it a unique number, which it allocates automatically. If you want to do the allocation yourself, specify a channel number here. It's very unlikely you'll need to do this but the option is there. `Duplex` objects managed by `BPMux` expose a `get_channel` method to retrieve their channel number. Defaults to automatic allocation.
  
@param {Function} cb Function called with the new `Duplex`. It's passed the following arguments:

  - `{Object} err` If an error occurred then details of the error, otherwise `null`.

  - `{Duplex} duplex` The new `Duplex` which is multiplexed over the carrier.
*/
BPMux.prototype.multiplex = function (options, cb)
{
    var chan, next, duplex;

    if (cb === undefined)
    {
        cb = options;
        options = undefined;
    }
    
    if (options && (options.channel !== undefined))
    {
        duplex = new BPDuplex(options, this, options.channel);
        this._duplexes[options.channel] = duplex;
        return cb(null, duplex);
    }

    chan = this._chan;

    do
    {
        next = (chan + 1) % this._max_duplexes;

        if (this._duplexes[chan] === undefined)
        {
            duplex = new BPDuplex(options, this, chan);

            this._duplexes[chan] = duplex;
            this._chan = next;

            return cb(null, duplex);
        }

        chan = next;
    }
    while (chan !== this._chan);

    cb(new Error('full'));
};

exports.BPMux = BPMux;
