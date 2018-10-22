/*eslint-env node */
/*global describe: false,
         it: false */
"use strict";

describe('examples', function ()
{
    it('first', function (cb)
    {
        var net = require('net'),
            crypto = require('crypto'),
            assert = require('assert'),
            BPMux = require('..').BPMux,
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
                        cb();
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
    });

    it('second', function (cb)
    {
        this.timeout(60 * 60 * 1000);

        var PrimusDuplex = require('primus-backpressure').PrimusDuplex,
            BPMux = require('..').BPMux,
            http = require('http'),
            path = require('path'),
            crypto = require('crypto'),
            stream = require('stream'),
            assert = require('assert'),
            finalhandler = require('finalhandler'),
            serve_static = require('serve-static'),
            Primus = require('primus'),
            serve = serve_static(path.join(__dirname, 'fixtures', 'example'));

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

                        while (true) // eslint-disable-line no-constant-condition
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
                        console.log('end', n); // eslint-disable-line no-console
                        ended += 1;
                        assert(ended <= 10);
                        assert.deepEqual(Buffer.concat(bufs), buf);
                        if (ended === 10)
                        {
                            cb();
                        }
                    });
                }

                for (i = 0; i < 10; i += 1)
                {
                    multiplex(i);
                }
            });
            
            console.log('Point your browser to http://localhost:7500/loader.html'); // eslint-disable-line no-console
        });
    });
});

