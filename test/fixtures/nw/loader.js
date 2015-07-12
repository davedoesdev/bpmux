function doit()
{
    try
    {
        require('test_browser')(Primus,
                                PrimusDuplex,
                                BPMux,
                                BundledBuffer,
                                bundled_crypto);
    }
    catch (ex)
    {
        process.stderr.write(ex.stack);
        process.exit(1);
    }
}
