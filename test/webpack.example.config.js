/*eslint-env node */
const webpack = require('webpack');
const path = require('path');
const cfg = require('./webpack.config.js');

module.exports = {
    ...cfg,
    context: __dirname,
    entry: './fixtures/example/bundler.js',
    output: {
        filename: 'bundle.js',
        path: path.join(__dirname, 'fixtures/example')
    }
};
