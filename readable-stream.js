'use strict';

module.exports = require('readable-stream');

function isWritableEnded(stream) {
  if (stream.writableEnded === true) return true;
  const wState = stream._writableState;
  if (wState?.errored) return false;
  if (typeof wState?.ended !== 'boolean') return null;
  return wState.ended;
}

module.exports.Duplex.fromWeb = function(pair, options) {
    const writer = pair.writable.getWriter();
    const reader = pair.readable.getReader();

    let writerClosed = false;
    let readerClosed = false;

    const duplex = new module.exports.Duplex({
        ...options,

        async write(chunk, encoding, callback) {
            let error = null;

            try {
                await writer.ready;
                await writer.write(chunk);
            } catch (ex) {
                error = ex;
            }

            try {
                callback(error);
            } catch (ex) {
                process.nextTick(() => duplex.destroy(ex));
            }
        },

        async final(callback) {
            if (!writerClosed) {
                let error = null;

                try {
                    // If destroy is called while closing,
                    // abort causes a SEGV due to nullptr abort algorithm.
                    // This change may fix it:
                    // https://github.com/chromium/chromium/commit/6f868b76a0dae219c9950360a47931c196d0fa94
                    // So try removing the line below when nw.js
                    // goes to chromium 109
                    writerClosed = true; 

                    await writer.close();
                } catch (ex) {
                    error = ex;
                }

                try {
                    callback(error);
                } catch (ex) {
                    process.nextTick(() => duplex.destroy(ex));
                }
            }
        },

        async read() {
            try {
                const chunk = await reader.read();
                duplex.push(chunk.done ? null : chunk.value);
            } catch (ex) {
                process.nextTick(() => duplex.destroy(ex));
            }
        },

        async destroy(error, callback) {
            try {
                await Promise.all([
                    (async () => {
                        if (!writerClosed) {
                            await writer.abort(error);
                        }
                    })(),
                    (async () => {
                        if (!readerClosed) {
                            await reader.cancel(error);
                        }
                    })()
                ]);
            } catch (ex) {
                if (!error) {
                    error = ex;
                }
            }

            try {
                callback(error);
            } catch (ex) {
                process.nextTick(() => { throw ex; });
            }
        }
    });

    (async () => {
        try {
            await writer.closed;
        } catch (ex) {
            writerClosed = true;
            readerClosed = true;
            return duplex.destroy(ex);
        }

        writerClosed = true;
        if (!isWritableEnded(duplex)) {
            duplex.destroy(new Error('Premature close'));
        }
    })();

    (async () => {
        try {
            await reader.closed;
        } catch (ex) {
            writerClosed = true;
            readerClosed = true;
            return duplex.destroy(ex);
        }

        readerClosed = true;
    })();

    return duplex;
};
