/**
# bpmux&nbsp;&nbsp;&nbsp;[![Build Status](https://github.com/davedoesdev/bpmux/workflows/ci/badge.svg)](https://github.com/davedoesdev/bpmux/actions) [![Coverage Status](https://coveralls.io/repos/davedoesdev/bpmux/badge.png?branch=master&service=github)](https://coveralls.io/r/davedoesdev/bpmux?branch=master) [![NPM version](https://badge.fury.io/js/bpmux.png)](http://badge.fury.io/js/bpmux)

Node stream multiplexing with back-pressure on each stream.

- Run more than one [`stream.Duplex`](https://nodejs.org/api/stream.html#stream_class_stream_duplex) over a carrier `Duplex`.
- Exerts back-pressure on each multiplexed stream and the underlying carrier stream.
- Each multiplexed stream's back-pressure is handled separately while respecting the carrier's capacity. [This prevents a slow or paused stream affecting other streams](#comparison). This does incur an overhead so if you don't care about this feature you might want to look elsewhere.
- Unit tests with 100% coverage.
- Tested with TCP streams. You'll get better performance if you [disable Nagle](https://nodejs.org/dist/latest-v10.x/docs/api/net.html#net_socket_setnodelay_nodelay).
- Works in the browser!
  - Tested with [Primus](https://github.com/primus/primus) (using [primus-backpressure](https://github.com/davedoesdev/primus-backpressure)).
  - Tested with HTTP/2 streams (using [browser-http2-duplex](https://github.com/davedoesdev/browser-http2-duplex)). Also tested Node-to-Node using `http2`.
  - Browser unit tests using [webpack](http://webpack.github.io/) and [nwjs](http://nwjs.io/).
- **See the [errors](#errors) section for information on why multiplexed streams error when their carrier stream closes before they do.**

The API is described [here](#api).

## Example

Multiplexing multiple streams over a single TCP stream:

```javascript
var net = require('net'),
    crypto = require('crypto'),
    assert = require('assert'),
    BPMux = require('bpmux').BPMux,
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
        var data = crypto.randomBytes(n * 100);
        mux.multiplex().end(data);
        sent.push(data.toString('hex'));
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
    BPMux = require('bpmux').BPMux,
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
            var buf = crypto.randomBytes(10 * 1024),
                buf_stream = new stream.PassThrough(),
                bufs = [],
                duplex = mux.multiplex({ handshake_data: Buffer.from([n]) });

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

## Comparison

Multiplexing libraries which don't exert backpressure on individual streams
suffer from starvation. A stream which doesn't read its data stops other streams
on the multiplex getting their data.

Here's a test using the [multiplex](https://github.com/maxogden/multiplex)
library:

```javascript
// Uses https://github.com/maxogden/multiplex (npm install multiplex)
// Backpressure is exerted across the multiplex as a whole, not individual streams.
// This means a stream which doesn't read its data starves the other streams.

const fs = require('fs');
const net = require('net');
const multiplex = require('multiplex');

require('net').createServer(c => {
    c.pipe(multiplex((stream, id) => {
        stream.on('data', function(d) {
            console.log('data', id, d.length);
            if (id === '0') {
                this.pause();
            }
        });
    }));
}).listen(7000, () => {
    const plex = multiplex();
    plex.pipe(net.createConnection(7000));

    const stream1 = plex.createStream();
    const stream2 = plex.createStream();

    fs.createReadStream('/dev/urandom').pipe(stream1);
    fs.createReadStream('/dev/urandom').pipe(stream2);
});
```

When the first stream is paused, backpressure is applied to the second stream
too, even though it hasn't been paused. If you run this example, you'll see:

```bash
$ node multiplex.js 
data 0 65536
data 1 65536
```

bpmux doesn't suffer from this problem since backpressure is exerted on each
stream separately. Here's the same test:

```javascript
// BPMux exerts backpressure on individual streams so a stream which doesn't
// read its data doesn't starve the other streams.

const fs = require('fs');
const net = require('net');
const { BPMux } = require('bpmux');

require('net').createServer(c => {
    new BPMux(c).on('handshake', stream => {
        stream.on('data', function (d) {
            console.log('data', stream._chan, d.length);
            if (stream._chan === 0) {
                this.pause();
            }
        });
    });
}).listen(7000, () => {
    const mux = new BPMux(net.createConnection(7000));

    const stream1 = mux.multiplex();
    const stream2 = mux.multiplex();

    fs.createReadStream('/dev/urandom').pipe(stream1);
    fs.createReadStream('/dev/urandom').pipe(stream2);
});
```

The second stream continues to receive data when the first stream is paused:

```bash
data 0 16384
data 1 16384
data 1 16384
data 1 16384
data 1 16384
data 1 16384
data 1 16384
data 1 16384
data 1 16384
data 1 16384
data 1 16384
data 1 16384
data 1 16384
data 1 16384
...
```

## Errors

bpmux will emit `error` events on multiplexed streams if their underlying
(carrier) stream closes before they have closed. The error object will have one
of the following messages:

```
carrier stream finished before duplex finished
carrier stream ended before end message received
```

and have a property `carrier_done` set to `true`.

As this is an `error` event, you must register an event listener on multiplexed
streams [if you don't want the Node process to exit](https://nodejs.org/dist/latest-v13.x/docs/api/events.html#events_error_events).

The reasoning behind emitting `error` events on open multiplexed streams when
their carrier closes is:

- If you're reading from a stream and it hasn't ended before the carrier closes then there may be some data that you'll never receive. This is an error state.

- If you're writing to a stream and it hasn't finished before the carrier closes then your application should be informed about it straight away. If it's performing some heavy calculation, for example, then it has a chance to cancel it before writing the result to the stream.

If you do register `error` event listeners, make sure you do so for streams
you multiplex using [`multiplex()`](#bpmuxprototypemultiplexoptions) _and_
for streams you receive using the [`handshake`](#bpmuxeventshandshakeduplex-handshake_data-delay_handshake) or [`peer_multiplex`](#bpmuxeventspeer_multiplexduplex) events.

`BPMux` objects will also re-emit any `error` events their carrier stream emits.

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
/*eslint-env node */
'use strict';

var util = require('util'),
    stream = require('stream'),
    Duplex = stream.Duplex,
    Writable = stream.Writable,
    EventEmitter = require('events').EventEmitter,
    frame = require('frame-stream'),
    max_seq = Math.pow(2, 32),
    TYPE_END = 0,
    TYPE_HANDSHAKE = 1,
    TYPE_STATUS = 2,
    TYPE_FINISHED_STATUS = 3,
    TYPE_DATA = 4,
    TYPE_PRE_HANDSHAKE = 5,
    TYPE_ERROR_END = 6,
    TYPE_KEEP_ALIVE = 7;

function BPDuplex(options, mux, chan)
{
    Duplex.call(this, options);

    options = Object.assign(
    {
        max_write_size: 0
    }, options);

    this._mux = mux;
    this._chan = chan;
    this._max_write_size = options.max_write_size;
    this._check_read_overflow = options.check_read_overflow !== false;
    this._seq = 0;
    this._remote_free = 0;
    this._set_remote_free = false;
    this._data = null;
    this._cb = null;
    this._index = 0;
    this._finished = false;
    this._ended = false;
    this._removed = false;
    this._handshake_sent = false;
    this._handshake_received = false;
    this._end_pending = false;
    this._error_end = false;
    this._error_end_pending = false;

    function finish()
    {
        this._finished = true;
        this._mux._send_end(this);
        this._check_remove();
    }
    this.once('finish', finish);

    this.once('close', function ()
    {
        this.removeListener('finish', finish);
        if (!this._finished)
        {
            this._finished = true;
            this._mux._send_end(this);
        }
        if (this._ended)
        {
            this._check_remove();
        }
        // Don't call _check_remove if not ended because the close event may be
        // due to a local destroy and so data may still come from the peer
        // (but be ignored because we don't push to destroyed streams).
        // Duplex will be removed when TYPE_END is received.
    });

    mux.duplexes.set(chan, this);

    if ((mux._max_open > 0) && (mux.duplexes.size === mux._max_open))
    {
        setImmediate(function ()
        {
            mux.emit('full');
        });
    }
}

util.inherits(BPDuplex, Duplex);

BPDuplex.prototype._check_remove = function ()
{
    if (this._finished && this._ended && !this._removed)
    {
        this._mux._remove(this);
    }
};

BPDuplex.prototype.get_channel = function ()
{
    return this._chan;
};

BPDuplex.prototype._send_handshake = function (handshake_data)
{
    this._mux._send_handshake(this, handshake_data || Buffer.alloc(0));
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

BPDuplex.prototype.peer_error_then_end = function (chunk, encoding, cb)
{
    this._error_end = true;
    return this.end(chunk, encoding, cb);
};

/**
Constructor for a `BPMux` object which multiplexes more than one [`stream.Duplex`](https://nodejs.org/api/stream.html#stream_class_stream_duplex) over a carrier `Duplex`.

@constructor
@extends events.EventEmitter

@param {Duplex} carrier The `Duplex` stream over which other `Duplex` streams will be multiplexed.

@param {Object} [options] Configuration options. This is passed down to [`frame-stream`](https://github.com/davedoesdev/frame-stream). It also supports the following additional properties:
- `{Object} [peer_multiplex_options]` When your `BPMux` object detects a new multiplexed stream from the peer on the carrier, it creates a new `Duplex` and emits a [`peer_multiplex`](#bpmuxeventspeer_multiplexduplex) event. When it creates the `Duplex`, it uses `peer_multiplex_options` to configure it with the following options:

  - `{Integer} [max_write_size]` Maximum number of bytes to write to the `Duplex` at once, regardless of how many bytes the peer is free to receive. Defaults to 0 (no limit).

  - `{Boolean} [check_read_overflow]` Whether to check if more data than expected is being received. If `true` and the `Duplex`'s high-water mark for reading is exceeded then the `Duplex` emits an `error` event. This should not normally occur unless you add data yourself using [`readable.unshift`](http://nodejs.org/api/stream.html#stream_readable_unshift_chunk) &mdash; in which case you should set `check_read_overflow` to `false`. Defaults to `true`.

- `{Function} [parse_handshake_data(handshake_data)]` When a new stream is multiplexed, the `BPMux` objects at each end of the carrier exchange a handshake message. You can supply application-specific handshake data to add to the handshake message (see [`BPMux.prototype.multiplex`](#bpmuxprototypemultiplexoptions) and [`BPMux.events.handshake`](#bpmuxeventshandshakeduplex-handshake_data-delay_handshake)). By default, when handshake data from the peer is received, it's passed to your application as a raw [`Buffer`](https://nodejs.org/api/buffer.html#buffer_buffer). Use `parse_handshake_data` to specify a custom parser. It will receive the `Buffer` as an argument and should return a value which makes sense to your application.
 
- `{Boolean} [coalesce_writes]` Whether to batch together writes to the carrier. When the carrier indicates it's ready to receive data, its spare capacity is shared equally between the multiplexed streams. By default, the data from each stream is written separately to the carrier. Specify `true` to write all the data to the carrier in a single write. Depending on the carrier, this can be more performant.

- `{Boolean} [high_channels]` `BPMux` assigns unique channel numbers to multiplexed streams. By default, it assigns numbers in the range [0..2^31). If your application can synchronise the two `BPMux` instances on each end of the carrier stream so they never call [`multiplex`](https://github.com/davedoesdev/bpmux#bpmuxprototypemultiplexoptions) at the same time then you don't need to worry about channel number clashes. For example, one side of the carrier could always call [`multiplex`](https://github.com/davedoesdev/bpmux#bpmuxprototypemultiplexoptions) and the other listen for [`handshake`](https://github.com/davedoesdev/bpmux#bpmuxeventshandshakeduplex-handshake_data-delay_handshake) events. Or they could take it in turns. If you can't synchronise both sides of the carrier, you can get one side to use a different range by specifying `high_channels` as `true`. The `BPMux` with `high_channels` set to `true` will assign channel numbers in the range [2^31..2^32).

- `{Integer} [max_open]` Maximum number of multiplexed streams that can be open at a time. Defaults to 0 (no maximum).

- `{Integer} [max_header_size]` `BPMux` adds a control header to each message it sends, which the receiver reads into memory. The header is of variable length &mdash; for example, handshake messages contain handshake data which can be supplied by the application. `max_header_size` is the maximum number of header bytes to read into memory. If a larger header is received, `BPMux` emits an `error` event. Defaults to 0 (no limit).

- `{Integer|false}` `keep_alive` Send a single byte keep-alive message every N milliseconds. Defaults to 30000 (30 seconds). Pass `false` to disable.
*/
function BPMux(carrier, options)
{
    EventEmitter.call(this, options);

    options = Object.assign(
    {
        max_open: 0,
        max_header_size: 0,
        keep_alive: 30 * 1000
    }, options);

    this._max_duplexes = Math.pow(2, 31);
    this._max_open = options.max_open;
    this._max_header_size = options.max_header_size;
    this.duplexes = new Map();
    this._chan = 0;
    this._chan_offset = options.high_channels ? this._max_duplexes : 0;
    this._finished = false;
    this._ended = false;
    this._header_buffers = [];
    this._header_buffer_len = 0;
    this._reading_duplex = null;
    this._peer_multiplex_options = options.peer_multiplex_options;
    this._parse_handshake_data = options.parse_handshake_data;
    this._coalesce_writes = options.coalesce_writes;
    this.carrier = carrier;
    this._sending = false;
    this._send_requested = false;
    this._keep_alive_id = null;
    this._keep_alive_paused = false;

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

    this._in_stream = frame.decode(Object.assign({}, options,
        {
            unbuffered: true
        }));
    carrier.pipe(this._in_stream);

    var ths = this;

    function finish()
    {
        if (ths._finished) { return; }
        ths._finished = true;

        clearInterval(ths._keep_alive_id);

        for (var duplex of ths.duplexes.values())
        {
            if (!duplex._finished && !duplex.destroyed)
            {
                const err = new Error('carrier stream finished before duplex finished');
                err.carrier_done = true;
                duplex.destroy(err);
            }
        }

        ths.emit('finish');
    }

    function end()
    {
        if (ths._ended) { return; }
        ths._ended = true;

        for (var duplex of ths.duplexes.values())
        {
            if (!duplex._ended && !duplex.destroyed)
            {
                duplex._ended = true; // we won't get any more messages for it
                const err = new Error('carrier stream ended before end message received');
                err.carrier_done = true;
                duplex.destroy(err);
            }
        }

        ths.emit('end');
    }

    carrier.on('finish', finish);
    carrier.on('close', finish);

    this._in_stream.on('end', end);
    carrier.on('close', end);

    function error(err)
    {
        for (var duplex of ths.duplexes.values())
        {
            if ((EventEmitter.listenerCount(duplex, 'error') > 0) &&
                !(duplex._ended && duplex._finished) &&
                !duplex.destroyed)
            {
                duplex.emit('error', err);
            }
        }

        ths.emit('error', err);
    }

    carrier.on('error', error);
    this._in_stream.on('error', error);
    this._out_stream.on('error', error);

    this._out_stream.on('drain', function ()
    {
        ths._send();

        if (this._writableState.length < this._writableState.highWaterMark)
        {
            ths.emit('drain');
        }
    });

    this._in_stream.pipe(new Writable(
    {
        write: function (data, encoding, cb)
        {
            var duplex = ths._reading_duplex;

            if (duplex)
            {
                if (data.frameEnd)
                {
                    ths._reading_duplex = null;
                }

                if (!duplex._readableState.ended && !duplex.destroyed)
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
                if ((ths._max_header_size <= 0) || 
                    (ths._header_buffer_len < ths._max_header_size))
                {
                    ths._header_buffers.push(data);
                    ths._header_buffer_len += data.length;
                }

                if (data.frameEnd)
                {
                    if ((ths._max_header_size <= 0) ||
                        (ths._header_buffer_len < ths._max_header_size))
                    {
                        ths._process_header(Buffer.concat(ths._header_buffers,
                                                          ths._header_buffer_len));
                    }
                    else
                    {
                        ths.emit('error', new Error('header too big'));
                    }

                    ths._header_buffers = [];
                    ths._header_buffer_len = 0;
                }
            }

            cb();
        }
    }));

    if (options.keep_alive !== false)
    {
        const orig_end = this.carrier.end;
        this.carrier.end = function ()
        {
            // If an error stops all data being written, we may not get 'finish'
            clearInterval(ths._keep_alive_id);
            return orig_end.apply(this, arguments);
        };

        this._out_stream.on('drain', function ()
        {
            ths._keep_alive_paused = false;
        });

        this._keep_alive_id = setInterval(function ()
        {
            ths._send_keep_alive();
        }, options.keep_alive);
    }
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
    if ((buf.length > 0) && (buf[0] === TYPE_KEEP_ALIVE))
    {
        return this.emit('keep_alive');
    }

    if (!this._check_buffer(buf, 5)) { return; }

    var ths = this,
        type = buf.readUInt8(0, true),
        chan = buf.readUInt32BE(1, true),
        duplex = this.duplexes.get(chan),
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

    function handle_status()
    {
        free = buf.readUInt32BE(5, true);
        seq = buf.length === 13 ? buf.readUInt32BE(9, true) : 0;

        free = duplex._max_write_size > 0 ?
            Math.min(free, duplex._max_write_size) : free;

        duplex._remote_free = seq + free - duplex._seq;

        if (duplex._seq < seq)
        {
            duplex._remote_free -= max_seq;
        }

        duplex._set_remote_free = true;

        ths._send();
    }

    if ((type !== TYPE_FINISHED_STATUS) && !duplex)
    {
        if ((this._max_open > 0) && (this.duplexes.size === this._max_open))
        {
            return this.emit('full');
        }

        duplex = new BPDuplex(this._peer_multiplex_options, this, chan);
        this.emit('peer_multiplex', duplex);
    }

    if (duplex && duplex._handshake_received)
    {
        switch (type)
        {
            case TYPE_END:
                duplex._ended = true;
                duplex._check_remove();
                duplex.push(null);
                break;

            case TYPE_ERROR_END:
                duplex._ended = true;
                duplex._check_remove();
                duplex.emit('error', new Error('peer error'));
                duplex.push(null);
                break;

            case TYPE_STATUS:
            case TYPE_FINISHED_STATUS:
                if (!this._check_buffer(buf, 13)) { return; }
                handle_status();
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
            duplex._end_pending = true;
            break;

        case TYPE_ERROR_END:
            duplex._error_end_pending = true;
            break;

        case TYPE_PRE_HANDSHAKE:
            if (!this._check_buffer(buf, 9)) { return; }
            handle_status();
            break;

        case TYPE_HANDSHAKE:
            if (!this._check_buffer(buf, 9)) { return; }
            if (duplex._seq === 0)
            {
                free = buf.readUInt32BE(5, true);
                duplex._remote_free = duplex._max_write_size > 0 ?
                    Math.min(free, duplex._max_write_size) : free;
                duplex._set_remote_free = true;
            }
            duplex._handshake_received = true;
            handshake_data = this._parse_handshake_data ?
                this._parse_handshake_data(buf.slice(9)) :
                buf.slice(9);
            dhs = duplex._handshake_sent ? null : delay_handshake;
            this.emit('handshake', duplex, handshake_data, dhs);
            duplex.emit('handshake', handshake_data, dhs);
            if (handshake_delayed)
            {
                this._send_handshake(duplex);
            }
            else
            {
                duplex._send_handshake();
            }
            if (duplex._error_end_pending)
            {
                duplex._ended = true;
                duplex._check_remove();
                duplex.emit('error', new Error('peer error'));
                duplex.push(null);
            }
            else if (duplex._end_pending)
            {
                duplex._ended = true;
                duplex._check_remove();
                duplex.push(null);
            }
            this._send();
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
    duplex._removed = true;

    if (this.duplexes.delete(duplex._chan))
    {
        this.emit('removed', duplex);
    }
};

BPMux.prototype._send_keep_alive = function ()
{
    var buf = Buffer.alloc(1);
    buf.writeUInt8(TYPE_KEEP_ALIVE, 0, true);

    this._keep_alive_paused = this._keep_alive_paused || !this._out_stream.write(buf);
};

BPMux.prototype._send_end = function (duplex)
{
    if (this._finished) { return; }

    var buf = Buffer.alloc(1 + 4);

    buf.writeUInt8(duplex._error_end ? TYPE_ERROR_END : TYPE_END, 0, true);
    buf.writeUInt32BE(duplex._chan, 1, true);

    this._out_stream.write(buf);
};

BPMux.prototype._send_handshake = function (duplex, handshake_data)
{
    if (this._finished) { return; }
    if (duplex._handshake_sent) { return this._send(); }
    
    var buf, size = 1 + 4 + 4;

    if (handshake_data)
    {
        size += handshake_data.length;
    }

    buf = Buffer.alloc(size);

    buf.writeUInt8(handshake_data ? TYPE_HANDSHAKE : TYPE_PRE_HANDSHAKE, 0, true);
    buf.writeUInt32BE(duplex._chan, 1, true);
    buf.writeUInt32BE(Math.max(duplex._readableState.highWaterMark - duplex._readableState.length, 0), 5, true);

    if (handshake_data)
    {
        handshake_data.copy(buf, 9);
        duplex._handshake_sent = true;
    }

    var r = this._out_stream.write(buf),
        evname = handshake_data ? 'handshake_sent' : 'pre_handshake_sent';

    this.emit(evname, duplex, r);
    duplex.emit(evname, r);

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
        (this._reading_duplex === duplex))
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

    var type;

    if (!duplex._handshake_sent)
    {
        type = TYPE_PRE_HANDSHAKE;
    }
    else if (duplex._finished)
    {
        type = TYPE_FINISHED_STATUS;
    }
    else
    {
        type = TYPE_STATUS;
    }

    buf = Buffer.alloc(1 + 4 + 4 + duplex._remote_seq.length);
    buf.writeUInt8(type, 0, true);
    buf.writeUInt32BE(duplex._chan, 1, true);
    buf.writeUInt32BE(free, 5, true);
    duplex._remote_seq.copy(buf, 9);

    duplex._prev_status = {
        free: free,
        seq: duplex._remote_seq
    };

    this._out_stream.write(buf);
};

BPMux.prototype.__send = function ()
{
    var ths = this, space, output, n;

    if (this._finished)
    {
        return;
    }

    function push_output(duplex)
    {
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
            buf = Buffer.alloc(1 + 4 + 4),
            buf2 = info.duplex._data.slice(info.duplex._index, info.duplex._index + size),
            cb;

        info.duplex._seq = (info.duplex._seq + size) % max_seq;
        
        buf.writeUInt8(TYPE_DATA, 0, true);
        buf.writeUInt32BE(info.duplex._chan, 1, true);
        buf.writeUInt32BE(info.duplex._seq, 5, true);

        info.duplex._set_remote_free = false;

        ths._out_stream.write(buf);
        ths._out_stream.write(buf2);

        if (!info.duplex._set_remote_free)
        {
            info.duplex._remote_free -= size;
        }

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

    while (true) // eslint-disable-line no-constant-condition
    {
        space = this._out_stream._writableState.highWaterMark - this._out_stream._writableState.length;
        output = [];

        if (space <= 0)
        {
            break;
        }
        
        this.duplexes.forEach(push_output);
        
        n = output.length;

        if (n === 0)
        {
            break;
        }

        output.sort(sort_output);

        if (this._coalesce_writes)
        {
            this.carrier.cork();
        }

        output.forEach(write_output);
        
        if (this._coalesce_writes)
        {
            this.carrier.uncork();
        }
    }
};

BPMux.prototype._send = function ()
{
    this._send_requested = true;

    if (this._sending)
    {
        return;
    }

    this._sending = true;

    while (this._send_requested)
    {
        this._send_requested = false;
        this.__send();
    }

    this._sending = false;
};

/**
Multiplex a new `stream.Duplex` over the carrier.

@param {Object} [options] Configuration options:
- `{Buffer} [handshake_data]` Application-specific handshake data to send to the peer. When a new stream is multiplexed, the `BPMux` objects at each end of the carrier exchange a handshake message. You can optionally supply handshake data to add to the handshake message here. The peer application will receive this when its `BPMux` object emits a [`handshake`](#bpmuxeventshandshakeduplex-handshake_data-delay_handshake) event. Defaults to a zero-length `Buffer`.
  
- `{Integer} [max_write_size]` Maximum number of bytes to write to the `Duplex` at once, regardless of how many bytes the peer is free to receive. Defaults to 0 (no limit).

- `{Boolean} [check_read_overflow]` Whether to check if more data than expected is being received. If `true` and the `Duplex`'s high-water mark for reading is exceeded then the `Duplex` emits an `error` event. This should not normally occur unless you add data yourself using [`readable.unshift`](http://nodejs.org/api/stream.html#stream_readable_unshift_chunk) &mdash; in which case you should set `check_read_overflow` to `false`. Defaults to `true`.

- `{Integer} [channel]` Unique number for the new stream. `BPMux` identifies each multiplexed stream by giving it a unique number, which it allocates automatically. If you want to do the allocation yourself, specify a channel number here. It's very unlikely you'll need to do this but the option is there. `Duplex` objects managed by `BPMux` expose a `get_channel` method to retrieve their channel number. Defaults to automatic allocation.
  
@return {Duplex} The new `Duplex` which is multiplexed over the carrier. This supports back-pressure using the stream [`readable`](https://nodejs.org/dist/latest-v4.x/docs/api/stream.html#stream_event_readable) event and [`write`](https://nodejs.org/dist/latest-v4.x/docs/api/stream.html#stream_writable_write_chunk_encoding_callback) method.

@throws {Error} If there are no channel numbers left to allocate to the new stream, the maximum number of open multiplexed streams would be exceeded or the carrier has finished or ended.
*/
BPMux.prototype.multiplex = function (options)
{
    if ((this._max_open > 0) && (this.duplexes.size === this._max_open))
    {
        this.emit('full');
        throw new Error('full');
    }

    if (this.carrier._writableState.ending)
    {
        throw new Error('finished');
    }

    if (this.carrier._readableState.ended)
    {
        throw new Error('ended');
    }

    var ths = this, chan, next;

    options = options || {};

    function done(channel)
    {
        var duplex = new BPDuplex(options, ths, channel);

        if (!options._delay_handshake)
        {
            setImmediate(function ()
            {
                duplex._send_handshake(options.handshake_data);
            });
        }

        return duplex;
    }

    if (options.channel !== undefined)
    {
        return done(options.channel);
    }

    chan = this._chan;

    do
    {
        next = (chan + 1) % this._max_duplexes;

        if (!this.duplexes.has(chan + this._chan_offset))
        {
            this._chan = next;
            return done(chan + this._chan_offset);
        }

        chan = next;
    }
    while (chan !== this._chan);

    this.emit('full');
    throw new Error('full');
};

exports.BPMux = BPMux;
