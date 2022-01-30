require('setimmediate');
PrimusDuplex = require('primus-backpressure').PrimusDuplex;
make_client_http2_duplex = require('http2-duplex').default;
BPMux = require('../../..').BPMux;
BundledBuffer = require('buffer').Buffer;
bundled_crypto = require('crypto');
bundled_frame = require('frame-stream');
