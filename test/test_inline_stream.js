/*eslint-env node */
/*global describe: false,
         beforeEach: false,
         it: false */
"use strict";

var BPMux = require('..').BPMux,
    chai = require('chai'),
    expect = chai.expect,
    stream = require('stream'),
    util = require('util'),
    Duplex = stream.Duplex;

function RightDuplex(left)
{
    Duplex.call(this);
    this.left = left;
    this.on('finish', function ()
    {
        left.push(null);
    });
}

util.inherits(RightDuplex, Duplex);

RightDuplex.prototype._read = function ()
{
    if (this._cb)
    {
        var cb = this._cb;
        this._cb = null;
        cb();
    }
};

RightDuplex.prototype._write = function (chunk, encoding, cb)
{
    if (this.left.push(chunk, encoding))
    {
        cb();
    }
    else
    {
        this.left._cb = cb;
    }
};

function LeftDuplex()
{
    Duplex.call(this);
    this.right = new RightDuplex(this);
    this.on('finish', function ()
    {
        this.right.push(null);
    }.bind(this));
}

util.inherits(LeftDuplex, Duplex);

LeftDuplex.prototype._read = function ()
{
    if (this._cb)
    {
        var cb = this._cb;
        this._cb = null;
        cb();
    }
};

LeftDuplex.prototype._write = function (chunk, encoding, cb)
{
    if (this.right.push(chunk, encoding))
    {
        cb();
    }
    else
    {
        this.right._cb = cb;
    }
};

describe('inline stream', function ()
{
    var left, right, lmux, rmux;

    beforeEach(function ()
    {
        left = new LeftDuplex();
        right = left.right;
        lmux = new BPMux(left);
        rmux = new BPMux(right);
    });

    it('should multiplex over inline stream', function (cb)
    {
        rmux.once('handshake', function (duplex, hsdata)
        {
            expect(hsdata.toString()).to.equal('left hs');

            var bufs = [];

            duplex.on('end', function ()
            {
                var buf = Buffer.concat(bufs);
                expect(buf.toString()).to.equal('left data');

                rmux.multiplex(
                {
                    handshake_data: Buffer.from('right hs')
                }).end('right data');
            });

            duplex.on('readable', function ()
            {
                while (true) // eslint-disable-line no-constant-condition
                {
                    var data = this.read();
                    if (data === null)
                    {
                        break;
                    }
                    bufs.push(data);
                }
            });
        });

        lmux.multiplex(
        {
            handshake_data: Buffer.from('left hs')
        }).end('left data');
        
        lmux.on('handshake', function (duplex, hsdata, delay)
        {
            if (!delay)
            {
                return expect(hsdata.length).to.equal(0);
            }

            expect(hsdata.toString()).to.equal('right hs');

            var bufs = [];

            duplex.on('end', function ()
            {
                var buf = Buffer.concat(bufs);
                expect(buf.toString()).to.equal('right data');
                cb();
            });

            duplex.on('readable', function ()
            {
                while (true) // eslint-disable-line no-constant-condition
                {
                    var data = this.read();
                    if (data === null)
                    {
                        break;
                    }
                    bufs.push(data);
                }
            });
        });
    });

    it('should ping-pong', function (cb)
    {
        var duplex = rmux.multiplex();
        
        duplex.once('readable', function ()
        {
            expect(this.read()[0]).to.equal(1);

            duplex.on('readable', function ()
            {
                while (true) // eslint-disable-line no-constant-condition
                {
                    var data = this.read();
                    if (data === null) { break; }
                    expect(data[0]).to.equal(3);
                }
            });

            this.end(Buffer.from([2]));
        });

        duplex.on('end', cb);

        lmux.on('handshake', function (duplex)
        {
            duplex.write(Buffer.from([1]));

            duplex.on('readable', function ()
            {
                while (true) // eslint-disable-line no-constant-condition
                {
                    var data = this.read();
                    if (data === null) { break; }
                    expect(data[0]).to.equal(2);
                    this.end(Buffer.from([3]));
                }
            });
        });
    });

    it('should emit handshake on multiplexed duplex', function (cb)
    {
        // right mux is intially in sync mode so need to send some data
        var control = lmux.multiplex();

        lmux.on('handshake', function (duplex)
        {
            if (duplex !== control)
            {
                return;
            }

            // give right mux chance to exit sync mode so it will
            // emit readable and send handshake straight away
            process.nextTick(function ()
            {
                lmux.multiplex().on('handshake', function ()
                {
                    cb();
                });
            });
        });
    });

    it('should pass delay to one side when both sides multiplex a duplex with the same channel number', function (cb)
    {
        var rdelay = null, lduplex, rduplex;

        lduplex = lmux.multiplex();
        expect(lduplex.get_channel()).to.equal(0);
        lduplex.on('handshake', function (hdata, delay)
        {
            // handshake sent so delay will be null
            expect(delay).to.equal(null);
            expect(rdelay).not.to.equal(null); // see below
            cb();
        });

        rduplex = rmux.multiplex();
        expect(rduplex.get_channel()).to.equal(0);
        rduplex.on('handshake', function (hdata, delay)
        {
            // handshake not sent yet so delay won't be null
            rdelay = delay;
        });

        // when rmux comes to send its original handshake (from the
        // multiplex call), it won't be sent because we already sent
        // one in response to the one from lmux (we didn't delay it)
    });

    it('should support giving a different channel range to each side', function (cb)
    {
        left = new LeftDuplex();
        right = left.right;
        lmux = new BPMux(left);
        rmux = new BPMux(right, { high_channels: true });

        var ldelay, lduplex, rduplex;

        lduplex = lmux.multiplex();
        expect(lduplex.get_channel()).to.equal(0);
        lduplex.on('handshake', function (hdata, delay)
        {
            ldelay = delay;
            // right handshake won't be received yet as different channel
        });

        rduplex = rmux.multiplex();
        expect(rduplex.get_channel()).to.equal(Math.pow(2, 31));
        rduplex.on('handshake', function (hdata, delay)
        {
            expect(delay).to.equal(null);
            expect(ldelay).to.equal(null);
            cb();
        });
    });

    it('should support ending stream before sending delayed handshake',
    function (cb)
    {
        rmux.on('handshake', function (duplex, hsdata, delay)
        {
            expect(hsdata.length).to.equal(0);

            duplex.end();

            var handshake = delay(),
                bufs = [];

            duplex.on('readable', function ()
            {
                while (true) // eslint-disable-line no-constant-condition
                {
                    var data = this.read();
                    if (!data) { return; }
                    bufs.push(data);
                }
            });

            duplex.on('end', function ()
            {
                expect(bufs.length).to.equal(0);
                handshake();
            });
        });

        lmux.on('handshake', function (duplex, hsdata, delay)
        {
            expect(delay).to.equal(null);
            cb();
        });

        lmux.multiplex().end();
    });

    it('should support ending stream (with data) before sending delayed handshake',
    function (cb)
    {
        rmux.on('handshake', function (duplex, hsdata, delay)
        {
            expect(hsdata.length).to.equal(0);

            duplex.end();

            var handshake = delay(),
                bufs = [];

            duplex.on('readable', function ()
            {
                while (true) // eslint-disable-line no-constant-condition
                {
                    var data = this.read();
                    if (!data) { return; }
                    bufs.push(data);
                }
            });

            duplex.on('end', function ()
            {
                expect(Buffer.concat(bufs).toString()).to.equal('foo');
                handshake();
            });
        });

        lmux.on('handshake', function (duplex, hsdata, delay)
        {
            expect(delay).to.equal(null);
            cb();
        });

        lmux.multiplex().end('foo');
    });

    it('should emit handshake_sent event', function (cb)
    {
        var lcomplete, lcomplete2, rcomplete, rcomplete2;

        function check()
        {
            if (lcomplete && lcomplete2 && rcomplete && rcomplete2)
            {
                cb();
            }
        }

        rmux.on('handshake', function (duplex)
        {
            duplex.on('handshake_sent', function (complete)
            {
                rcomplete = complete;
                check();
            });
        });

        rmux.on('handshake_sent', function (duplex, complete)
        {
            rcomplete2 = complete;
            check();
        });

        lmux.on('handshake_sent', function (duplex, complete)
        {
            lcomplete2 = complete;
            check();
        });

        lmux.multiplex().on('handshake_sent', function (complete)
        {
            lcomplete = complete;
            check();
        });
    });

    it('should emit pre_handshake_sent event', function (cb)
    {
        var lcomplete,
            lcomplete2,
            rcomplete,
            rcomplete2,
            rcomplete3,
            rcomplete4;

        function check()
        {
            if (lcomplete && lcomplete2 && rcomplete && rcomplete2 && rcomplete3 && rcomplete4)
            {
                cb();
            }
        }

        rmux.on('handshake', function (duplex, hsdata, delay)
        {
            var hs = delay();

            duplex.on('pre_handshake_sent', function (complete)
            {
                rcomplete = complete;
                check();
                hs();
            });

            duplex.on('handshake_sent', function (complete)
            {
                rcomplete4 = complete;
                check();
            });
        });

        rmux.on('pre_handshake_sent', function (duplex, complete)
        {
            rcomplete2 = complete;
            check();
        });

        rmux.on('handshake_sent', function (duplex, complete)
        {
            rcomplete3 = complete;
            check();
        });

        lmux.on('handshake_sent', function (duplex, complete)
        {
            lcomplete2 = complete;
            check();
        });

        lmux.multiplex().on('handshake_sent', function (complete)
        {
            lcomplete = complete;
            check();
        });
    });

    it('should support backpressure on handshakes', function (cb)
    {
        this.timeout(2 * 60 * 1000);

        var orig_write = left._write,
            write_chunk,
            write_encoding,
            write_cb;

        left._write = function (chunk, encoding, cb)
        {
            write_chunk = chunk;
            write_encoding = encoding;
            write_cb = cb;
        };

        var count_complete = 0,
            count_incomplete = 0,
            count_drain = 0;

        function sent(complete)
        {
            if (complete)
            {
                count_complete += 1;
            }
            else
            {
                count_incomplete += 1;
            }
            if ((count_complete + count_incomplete) === 4343)
            {
                expect(count_complete).to.equal(4342);
                expect(count_incomplete).to.equal(1);
                expect(count_drain).to.equal(0);
                left._write = orig_write;
                left._write(write_chunk, write_encoding, write_cb);
            }
        }

        lmux.on('drain', function ()
        {
            expect(count_drain).to.equal(0);
            count_drain += 1;
            cb();
        });

        // number will change if change handshake buffer size
        for (var i = 0; i < 4343; i += 1)
        {
            lmux.multiplex().on('handshake_sent', sent);
        }
    });

    // https://github.com/nodejs/node/pull/7292 isn't on 0.12
    if (parseFloat(process.versions.node) > 0.12)
    {
        it('should support sending large buffers', function (cb)
        {
            var buf = Buffer.alloc(128 * 1024);
            buf.fill('a');

            rmux.once('handshake', function (duplex)
            {
                var bufs = [];

                duplex.on('readable', function ()
                {
                    while (true) // eslint-disable-line no-constant-condition
                    {
                        var data = this.read();
                        if (data === null)
                        {
                            break;
                        }
                        bufs.push(data);
                    }
                });

                duplex.on('end', function ()
                {
                    expect(Buffer.concat(bufs).toString()).to.equal(buf.toString());
                    cb();
                });
            });

            lmux.multiplex().end(buf);
        });

        it('should support sending large buffers with delayed handshake',
        function (cb)
        {
            var buf = Buffer.alloc(100 * 1024);
            buf.fill('a');

            rmux.on('handshake', function (duplex, hsdata, delay)
            {
                delay();

                var bufs = [];

                duplex.on('readable', function ()
                {
                    while (true) // eslint-disable-line no-constant-condition
                    {
                        var data = this.read();
                        if (data === null)
                        {
                            break;
                        }
                        bufs.push(data);
                    }
                });

                duplex.on('end', function ()
                {
                    expect(Buffer.concat(bufs).toString()).to.equal(buf.toString());                cb();
                });
            });

            lmux.multiplex().end(buf);
        });
    }

    it('should emit end event when carrier stream ends', function (cb)
    {
        rmux.on('end', cb);
        left.end();
    });

    it('should emit finish event when carrier stream ends', function (cb)
    {
        lmux.on('finish', cb);
        left.end();
    });

    it('multiplex() should throw error if carrier stream has already ended', function (cb)
    {
        rmux.on('end', function ()
        {
            expect(function ()
            {
                rmux.multiplex();
            }).to.throw('ended');
            cb();
        });
        left.end();
    });

    it('multiplex() should throw error if carrier stream has already finished', function (cb)
    {
        rmux.carrier.on('end', function ()
        {
            this.end();
        });

        rmux.on('finish', function ()
        {
            expect(function ()
            {
                rmux.multiplex();
            }).to.throw('finished');
            cb();
        });
        left.end();
    });
});

