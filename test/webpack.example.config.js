/*eslint-env node */
var path = require('path');

module.exports = {
    context: __dirname,
    entry: './fixtures/example/bundler.js',
    output: {
        filename: 'bundle.js',
        path: path.join(__dirname, 'fixtures/example')
    },
    performance: { hints: false }
};
