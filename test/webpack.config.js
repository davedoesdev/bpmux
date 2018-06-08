var webpack = require('webpack'),
    path = require('path');

module.exports = {
    context: __dirname,
    entry: './fixtures/webpack/bundler.js',
    output: {
        filename: 'bundle.js',
        path: path.join(__dirname, './fixtures/webpack')
    },
    performance: { hints: false },
    optimization: { minimize: false }
};
