const util = require('util');
const os = require('os');

function done(err)
{
    require('nw.gui').App.quit();
    if (err)
    {
        if (process.env.TEST_ERR_FILE)
        {
            require('fs').writeFileSync(process.env.TEST_ERR_FILE, '');
        }
        process.stderr.write(`${err.stack}\n`);
        throw err;
    }
}

window.addEventListener('unhandledrejection', function (ev)
{
    done(ev.reason);
});

window.onerror = function (message, source, lineno, colno, err)
{
    done(err);
};

console.log = function ()
{
    process.stdout.write(util.format.apply(this, arguments));
    process.stdout.write(os.EOL);
};

console.error = function ()
{
    process.stderr.write(util.format.apply(this, arguments));
    process.stderr.write(os.EOL);
};

console.trace = function trace()
{
    var err = new Error();
    err.name = 'Trace';
    err.message = util.format.apply(this, arguments);
    Error.captureStackTrace(err, trace);
    this.error(err.stack);
};

function doit()
{
    try
    {
        //nw.Window.get().showDevTools();
        require('test_browser')(Primus,
                                PrimusDuplex,
                                make_client_http2_duplex,
                                BPMux,
                                BundledBuffer,
                                bundled_crypto,
                                bundled_frame,
                                done);
    }
    catch (ex)
    {
        done(ex);
    }
}
