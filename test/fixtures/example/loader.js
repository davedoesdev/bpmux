function doit()
{
    var mux = new BPMux(new PrimusDuplex(new Primus({ strategy: false })));

    mux.on('handshake', function (duplex, handshake_data)
    {
        console.log("handshake", handshake_data[0]);
        duplex.pipe(duplex);

        duplex.on('end', function ()
        {
            console.log('end', handshake_data[0]);
        });
    });
}
