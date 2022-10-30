/*eslint-env node */
const webpack = require('webpack');
const path = require('path');

module.exports = {
    context: __dirname,
    entry: './fixtures/webpack/bundler.js',
    output: {
        filename: 'bundle.js',
        path: path.join(__dirname, 'fixtures/webpack')
    },
    performance: { hints: false },
    optimization: { minimize: false },
    resolve: {
        fallback: {
            util: 'util',
            stream: path.join(path.dirname(__dirname), 'readable-stream.js'),
            crypto: 'crypto-browserify',
            buffer: 'buffer'
        },
        alias: {
            process: 'process/browser'
        }
    },
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process'
        }),
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer']
        }),
        new webpack.IgnorePlugin({
            resourceRegExp: /^http2$/
        })
    ]
};
