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

<a name="tableofcontents"></a>

- <a name="toc_bpmuxcarrrier-options"></a>[BPMux](#bpmuxcarrrier-options)
- <a name="toc_bpmuxprototypemultiplexoptions-cb"></a><a name="toc_bpmuxprototype"></a>[BPMux.prototype.multiplex](#bpmuxprototypemultiplexoptions-cb)
- <a name="toc_bpmuxeventspeer_multiplexduplex"></a><a name="toc_bpmuxevents"></a>[BPMux.events.peer_multiplex](#bpmuxeventspeer_multiplexduplex)
- <a name="toc_bpmuxeventshandshakeduplex-handshake_data-delay_handshake"></a>[BPMux.events.handshake](#bpmuxeventshandshakeduplex-handshake_data-delay_handshake)

## BPMux(carrrier, [options])

> Constructor for a `BPMux` object which multiplexes more than one [`stream.Duplex`](https://nodejs.org/api/stream.html#stream_class_stream_duplex) over a carrier `Duplex`.

**Parameters:**

- `{Duplex} carrrier` The `Duplex` stream over which other `Duplex` streams will be multiplexed. 
- `{Object} [options]` Configuration options: 
  - `{Object} [peer_multiplex_options]` When your `BPMux` object detects a new multiplexed stream from the peer on the carrier, it creates a new `Duplex` and emits a [`peer_multiplex`](#bpmuxeventspeer_multiplexduplex) event. When it creates the `Duplex`, it uses `peer_multiplex_options` to configure it with the following options:

    - `{Integer} [max_write_size]` Maximum number of bytes to write to the `Duplex` at once, regardless of how many bytes the peer is free to receive. Defaults to 0 (no limit).

    - `{Boolean} [check_read_overflow]` Whether to check if more data than expected is being received. If `true` and the `Duplex`'s high-water mark for reading is exceeded then the `Duplex` emits an `error` event. This should not normally occur unless you add data yourself using [`readable.unshift`](http://nodejs.org/api/stream.html#stream_readable_unshift_chunk) &mdash; in which case you should set `check_read_overflow` to `false`. Defaults to `true`.

  - `{Function} [parse_handshake_data(handshake_data)]` When a new stream is multiplexed, the `BPMux` objects at each end of the carrier exchange a handshake message. You can supply application-specific handshake data to add to the handshake message (see [`BPMux.prototype.multiplex`](#bpmuxprototypemultiplexoptions-cb) and [`BPMux.events.handshake`](#bpmuxeventshandshakeduplex-handshake_data-delay_handshake)). By default, when handshake data from the peer is received, it's passed to your application as a raw [`Buffer`](https://nodejs.org/api/buffer.html#buffer_buffer). Use `parse_handshake_data` to specify a custom parser. It will receive the `Buffer` as an argument and should return a value which makes sense to your application.
  
  - `{Boolean} [coalesce_writes]` Whether to batch together writes to the carrier. When the carrier indicates it's ready to receive data, its spare capacity is shared equally between the multiplexed streams. By default, the data from each stream is written separately to the carrier. Specify `true` to write all the data to the carrier in a single write. Depending on the carrier, this can be more performant.

<sub>Go: [TOC](#tableofcontents)</sub>

<a name="bpmuxprototype"></a>

## BPMux.prototype.multiplex([options], cb)

> Multiplex a new `stream.Duplex` over the carrier.

**Parameters:**

- `{Object} [options]` Configuration options: 
  - `{Buffer} [handshake_data]` Application-specific handshake data to send to the peer. When a new stream is multiplexed, the `BPMux` objects at each end of the carrier exchange a handshake message. You can optionally supply handshake data to add to the handshake message here. The peer application will receive this when its `BPMux` object emits a [`handshake`](#bpmuxeventshandshakeduplex-handshake_data-delay_handshake) event. Defaults to a zero-length `Buffer`.
  
  - `{Integer} [max_write_size]` Maximum number of bytes to write to the `Duplex` at once, regardless of how many bytes the peer is free to receive. Defaults to 0 (no limit).

  - `{Boolean} [check_read_overflow]` Whether to check if more data than expected is being received. If `true` and the `Duplex`'s high-water mark for reading is exceeded then the `Duplex` emits an `error` event. This should not normally occur unless you add data yourself using [`readable.unshift`](http://nodejs.org/api/stream.html#stream_readable_unshift_chunk) &mdash; in which case you should set `check_read_overflow` to `false`. Defaults to `true`.

  - `{Integer} [channel]` Unique number for the new stream. `BPMux` identifies each multiplexed stream by giving it a unique number, which it allocates automatically. If you want to do the allocation yourself, specify a channel number here. It's very unlikely you'll need to do this but the option is there. `Duplex` objects managed by `BPMux` expose a `get_channel` method to retrieve their channel number. Defaults to automatic allocation.
  
- `{Function} cb` Function called with the new `Duplex`. It's passed the following arguments: 
  - `{Object} err` If an error occurred then details of the error, otherwise `null`.

  - `{Duplex} duplex` The new `Duplex` which is multiplexed over the carrier.

<sub>Go: [TOC](#tableofcontents) | [BPMux.prototype](#toc_bpmuxprototype)</sub>

<a name="bpmuxevents"></a>

## BPMux.events.peer_multiplex(duplex)

> `peer_multiplex` event

A `BPMux` object emits a `peer_multiplex` event when it detects a new multiplexed stream from its peer on the carrier stream.

**Parameters:**

- `{Duplex} duplex` The new stream.

<sub>Go: [TOC](#tableofcontents) | [BPMux.events](#toc_bpmuxevents)</sub>

## BPMux.events.handshake(duplex, handshake_data, [delay_handshake])

> `handshake` event

A `BPMux` object emits a `handshake` event when it receives a handshake message from its peer on the carrier stream. This can happen in two cases: 

1. The `BPMux` object is processing a handshake message for a new multiplexed stream the peer created and it hasn't seen before. Note the `handshake` event is emitted after the [`peer_multiplex`](#bpmuxeventspeer_multiplexduplex) event.
2. Your application previously called [`multiplex`](#bpmuxprototypemultiplexoptions-cb) on its `BPMux` object to multiplex a new stream over the carrier and now the peer has replied with a handshake message.

**Parameters:**

- `{Duplex} duplex` The multiplexed stream for which a handshake message has been received. **Please note that a `handshake` event is also emitted on `duplex` immediately after `BPMux`'s `handshake` event finishes processing**. `duplex`'s `handshake` event is passed the same `handshake_data` and `delay_handshake` parameters decribed below. 
- `{Object} handshake_data` Application-specific data which the peer sent along with the handshake message. If you specified a `parse_handshake_data` function in the `BPMux` [constructor](#bpmuxcarrrier-options) then `handshake_data` will be the return value from calling that function. 
- `{Function | null} [delay_handshake]` This parameter will be `null` in case 2 (your application previously created `duplex`). Otherwise (case 1), this parameter will be a function. By default, the `BPMux` object replies to the peer's handshake message as soon as your event handler returns and doesn't attach any application-specific handshake data. If you wish to delay the handshake message or provide handshake data, call `delay_handshake`. It returns another function which you can call at any time to send the handshake message. The returned function takes a single argument: 
  - `{Buffer} [handshake_data]` Application-specific handshake data to attach to the handshake message sent to the peer. Defaults to a zero-length `Buffer`.

<sub>Go: [TOC](#tableofcontents) | [BPMux.events](#toc_bpmuxevents)</sub>

_&mdash;generated by [apidox](https://github.com/codeactual/apidox)&mdash;_
