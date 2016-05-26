/*global describe: false,
         beforeEach: false,
         it: false */
/*jshint node: true */
"use strict";

var BPMux = require('..').BPMux,
    chai = require('chai'),
    expect = chai.expect,
    stream = require('stream'),
    util = require('util'),
    Duplex = stream.Duplex,
    PassThrough = stream.PassThrough;

function RightDuplex(left)
{
    Duplex.call(this);
    this.left = left;
}

util.inherits(RightDuplex, Duplex);

RightDuplex.prototype._read = function ()
{
    if (this._cb)
    {
        this._cb();
        this._cb = null;
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
        this._cb = cb;
    }
};

function LeftDuplex()
{
    Duplex.call(this);
    this.right = new RightDuplex(this);
}

util.inherits(LeftDuplex, Duplex);

LeftDuplex.prototype._read = function ()
{
    if (this._cb)
    {
        this._cb();
        this._cb = null;
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
        this._cb = cb;
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
                    handshake_data: new Buffer('right hs')
                }, function (err, duplex)
                {
                    if (err) { return cb(err); }
                    duplex.end('right data');
                });
            });

            duplex.on('readable', function ()
            {
                while (true)
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
            handshake_data: new Buffer('left hs')
        }, function (err, duplex)
        {
            if (err) { return cb(err); }
            duplex.end('left data');
        });

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
                while (true)
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
        rmux.multiplex(function (err, duplex)
        {
            if (err) { return cb(err); }

            duplex.once('readable', function ()
            {
                expect(this.read()[0]).to.equal(1);

                duplex.on('readable', function ()
                {
                    while (true)
                    {
                        var data = this.read();
                        if (data === null) { break; }
                        expect(data[0]).to.equal(3);
                    }
                });

                this.end(new Buffer([2]));
            });

            duplex.on('end', cb);
        });

        lmux.on('handshake', function (duplex)
        {
            duplex.write(new Buffer([1]));

            duplex.on('readable', function ()
            {
                while (true)
                {
                    var data = this.read();
                    if (data === null) { break; }
                    expect(data[0]).to.equal(2);
                    this.end(new Buffer([3]));
                }
            });
        });
    });

    it('should emit handshake on multiplexed duplex', function (cb)
    {
        // right mux is intially in sync mode so need to send some data
        lmux.multiplex(function (err, control)
        {
            if (err) { return cb(err); }
            lmux.on('handshake', function (duplex, hdata, delay)
            {
                if (duplex !== control)
                {
                    return;
                }

                // give right mux chance to exit sync mode so it will
                // emit readable and send handshake straight away
                process.nextTick(function ()
                {
                    lmux.multiplex(function (err, duplex)
                    {
                        if (err) { return cb(err); }
                        duplex.on('handshake', function ()
                        {
                            cb();
                        });
                    });
                });
            });
        });
    });

    it('should pass delay to one side when both sides multiplex a duplex with the same channel number', function (cb)
    {
        var rdelay = null;

        lmux.multiplex(function (err, duplex)
        {
            if (err) { return cb(err); }
            expect(duplex.get_channel()).to.equal(0);

            duplex.on('handshake', function (hdata, delay)
            {
                // handshake sent so delay will be null
                expect(delay).to.equal(null);
                expect(rdelay).not.to.equal(null); // see below
                cb();
            });
        });

        rmux.multiplex(function (err, duplex)
        {
            if (err) { return cb(err); }
            expect(duplex.get_channel()).to.equal(0);

            duplex.on('handshake', function (hdata, delay)
            {
                // handshake not sent yet so delay won't be null
                rdelay = delay;
            });

            // when rmux comes to send its original handshake (from the
            // multiplex call), it won't be sent because we already sent
            // one in response to the one from lmux (we didn't delay it)
        });
    });

    it('should support giving a different channel range to each side', function (cb)
    {
        left = new LeftDuplex();
        right = left.right;
        lmux = new BPMux(left);
        rmux = new BPMux(right, { high_channels: true });

        var ldelay;

        lmux.multiplex(function (err, duplex)
        {
            if (err) { return cb(err); }
            expect(duplex.get_channel()).to.equal(0);

            duplex.on('handshake', function (hdata, delay)
            {
                ldelay = delay;
                // right handshake won't be received yet as different channel
            });
        });

        rmux.multiplex(function (err, duplex)
        {
            if (err) { return cb(err); }
            expect(duplex.get_channel()).to.equal(Math.pow(2, 31));

            duplex.on('handshake', function (hdata, delay)
            {
                expect(delay).to.equal(null);
                expect(ldelay).to.equal(null);
                cb();
            });
        });
    });
});

