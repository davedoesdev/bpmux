function doit()
{
    try
    {
        nw.Window.get().showDevTools();
        require('test_browser')(Primus,
                                PrimusDuplex,
                                fetch,
                                TransformStream,
                                BPMux,
                                BundledBuffer,
                                bundled_crypto,
                                bundled_frame);
    }
    catch (ex)
    {
        process.stderr.write(ex.stack);
        process.exit(1);
    }
}
