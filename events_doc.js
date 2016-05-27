/*global BPMux: false */
/*jslint node: true, unparam: true */
"use strict";
/**
`peer_multiplex` event

A `BPMux` object emits a `peer_multiplex` event when it detects a new multiplexed stream from its peer on the carrier stream.

@param {Duplex} duplex The new stream.
*/
BPMux.events.peer_multiplex = function (duplex) { return undefined; };

/**
`handshake` event

A `BPMux` object emits a `handshake` event when it receives a handshake message from its peer on the carrier stream. This can happen in two cases: 

1. The `BPMux` object is processing a handshake message for a new multiplexed stream the peer created and it hasn't seen before. Note the `handshake` event is emitted after the [`peer_multiplex`](#bpmuxeventspeer_multiplexduplex) event.
2. Your application previously called [`multiplex`](#bpmuxprototypemultiplexoptions) on its `BPMux` object to multiplex a new stream over the carrier and now the peer has replied with a handshake message.

@param {Duplex} duplex The multiplexed stream for which a handshake message has been received. **Please note that a `handshake` event is also emitted on `duplex` immediately after `BPMux`'s `handshake` event finishes processing**. `duplex`'s `handshake` event is passed the same `handshake_data` and `delay_handshake` parameters decribed below.

@param {Object} handshake_data Application-specific data which the peer sent along with the handshake message. If you specified a `parse_handshake_data` function in the `BPMux` [constructor](#bpmuxcarrrier-options) then `handshake_data` will be the return value from calling that function.

@param {Function|null} [delay_handshake] This parameter will be `null` in case 2 (your application previously created `duplex`). Otherwise (case 1), this parameter will be a function. By default, the `BPMux` object replies to the peer's handshake message as soon as your event handler returns and doesn't attach any application-specific handshake data. If you wish to delay the handshake message or provide handshake data, call `delay_handshake`. It returns another function which you can call at any time to send the handshake message. The returned function takes a single argument:

  - `{Buffer} [handshake_data]` Application-specific handshake data to attach to the handshake message sent to the peer. Defaults to a zero-length `Buffer`.
*/
BPMux.events.handshake = function (duplex, handshake_data, delay_handshake) { return undefined; };
