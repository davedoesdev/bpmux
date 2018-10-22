/*eslint-env node */
/*global describe: false,
         it: false */
"use strict";

var BPMux = require('..').BPMux,
    chai = require('chai'),
    expect = chai.expect;

var dummy_carrier = {
    on: function () { return undefined; },
    once: function () { return undefined; },
    emit: function () { return undefined; },
    pipe: function () { return undefined; },
    prependListener: function () { return undefined; },
    _readableState: { ended: false },
    _writableState: { finished: false }
};

describe('channel number full', function ()
{
    it('should throw a full exception when maximum number of duplexes exceeded', function (cb)
    {
        var mux = new BPMux(dummy_carrier,
            {
                keep_alive: false
            }),
            full_emitted = false;

        mux.on('full', function ()
        {
            full_emitted = true;
        });

        mux._max_duplexes = 3;

        mux.multiplex({ _delay_handshake: true });
        mux.multiplex({ _delay_handshake: true });
        mux.multiplex({ _delay_handshake: true });

        expect(full_emitted).to.equal(false);

        function fn()
        {
            mux.multiplex({ _delay_handshake: true });
        }
        expect(fn).to.throw(Error);
        expect(full_emitted).to.equal(true);
        expect(fn).to.throw('full');

        cb();
    });

    it('should throw a full exception when maximum number of open duplexes exceeded', function (cb)
    {
        var mux = new BPMux(dummy_carrier,
            {
                max_open: 3,
                keep_alive: false
            }),
            full_emitted = false;

        mux.on('full', function ()
        {
            full_emitted = true;
        });

        mux.multiplex({ _delay_handshake: true });
        mux.multiplex({ _delay_handshake: true });
        expect(full_emitted).to.equal(false);
        mux.multiplex({ _delay_handshake: true });
        setImmediate(function ()
        {
            expect(full_emitted).to.equal(true);

            function fn()
            {
                mux.multiplex({ _delay_handshake: true });
            }
            expect(fn).to.throw(Error);
            expect(fn).to.throw('full');

            cb();
        });
    });

});

