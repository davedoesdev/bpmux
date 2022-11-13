/*eslint-env node */
"use strict";

var path = require('path');

// Enable passing options in title (WithOptions in test/test_comms.js)
require('mocha/lib/utils').isString = function (obj)
{
    return typeof obj === 'string' ||
           (typeof obj === 'object' && obj.constructor.name == 'WithOptions');
};

const c8 = "npx c8 -x Gruntfile.js -x 'test/**'";

module.exports = function (grunt)
{
    grunt.initConfig(
    {
        eslint: {
            target: [
                '*.js',
                'test/*.js',
                'test/comparison/*.js',
                'test/comparison/*.mjs'
            ]
        },

        env: {
            fast: {
                FAST: 'yes'
            }
        },

        apidox: {
            input: [ 'index.js', 'events_doc.js' ],
            output: 'README.md',
            fullSourceDescription: true,
            extraHeadingLevels: 1
        },

        mochaTest: {
            default: {
                src: [
                    'test/test_tcp.js',
                    'test/test_channel_full.js',
                    'test/test_inline_stream.js',
                    'test/test_http2.js',
                    'test/test_http2_session.js',
                    'test/test_webtransport.js'
                ],
                options: {
                    timeout: 10 * 60 * 1000,
                    bail: true,
                    reporter: 'spec'
                }
            },

            examples: 'test/test_examples.js',

            inline: 'test/test_inline_stream.js'
        },

        exec: Object.fromEntries(Object.entries({
            cover: `${c8} grunt test-fast`,
            cover_report: `${c8} report -r lcov`,
            cover_check: `${c8} check-coverage --statements 100 --branches 100 --functions 100 --lines 100`,
            nw_build: [
                'rsync -a node_modules test/fixtures/nw --exclude nw-builder --exclude malformed_package_json --delete',
                'BABEL_ENV=test npx babel --config-file ./test/fixtures/nw/.babelrc.json test/fixtures/nw/node_modules/http2-duplex/server.js --out-file test/fixtures/nw/node_modules/http2_duplex_server.js --source-maps',
                'for f in test/fixtures/nw/node_modules/@fails-components/webtransport/lib/*.js; do BABEL_ENV=test npx babel --config-file ./test/fixtures/nw/.babelrc.json $f --out-file $f --source-maps; done',
                 "sed -i -e 's/\\(_require = \\).*/\\1require;/' -e 's/\\(dirname = \\).*/\\1__dirname;/' test/fixtures/nw/node_modules/@fails-components/webtransport/lib/native.js",
                'sed -i s/module/commonjs/ test/fixtures/nw/node_modules/@fails-components/webtransport/package.json',
                'cp index.js test/fixtures/nw/node_modules/bpmux.js',
                'cp test/test_browser.js test/fixtures/nw/node_modules',
                'cp test/test_comms.js test/fixtures/nw/node_modules',
                'cp test/fixtures/webpack/bundle.js test/fixtures/nw',
                'mkdir -p test/fixtures/nw/node_modules/fixtures',
                'touch test/fixtures/nw/node_modules/fixtures/keep',
                'mkdir -p test/fixtures/nw/node_modules/certs',
                'cp test/certs/server.* test/fixtures/nw/node_modules/certs',
                'npx nwbuild test/fixtures/nw/package.json "test/fixtures/nw/**" --mode build --quiet warn --platforms linux64'
            ].join('&&'),
            bpmux_test: 'export TEST_ERR_FILE=/tmp/test_err_$$; ./build/bpmux-test/linux64/bpmux-test; if [ -f $TEST_ERR_FILE ]; then exit 1; fi',
            bundle: 'npx webpack --mode production --config test/webpack.config.js',
            bundle_example: 'npx webpack --mode production --config test/webpack.example.config.js',
            certs: './test/certs/make_ca_cert.sh && ./test/certs/make_server_cert.sh'
        }).map(([k, cmd]) => [k, { cmd, stdio: 'inherit' }]))
    });
    
    grunt.loadNpmTasks('grunt-eslint');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-apidox');
    grunt.loadNpmTasks('grunt-exec');
    grunt.loadNpmTasks('grunt-env');

    grunt.registerTask('lint', 'eslint');
    grunt.registerTask('test', [
        'exec:certs',
        'mochaTest:default'
    ]);
    grunt.registerTask('test-fast', [
        'exec:certs',
        'env:fast',
        'mochaTest:default'
    ]);
    grunt.registerTask('test-inline', 'mochaTest:inline');
    grunt.registerTask('test-examples', [
        'exec:bundle_example',
        'mochaTest:examples'
    ]);
    grunt.registerTask('test-browser', [
        'save-primus',
        'exec:certs',
        'exec:bundle',
        'exec:nw_build',
        'intercept-exit',
        'exec:bpmux_test'
    ]);
    grunt.registerTask('docs', 'apidox');
    grunt.registerTask('coverage', [
        'exec:cover',
        'exec:cover_report',
        'exec:cover_check'
    ]);
    grunt.registerTask('default', ['lint', 'test']);

    grunt.registerTask('save-primus', function ()
    {
        var Primus = require('primus'),
            primus = Primus.createServer({ port: 7000 });
        primus.save(path.join(__dirname, 'test', 'fixtures', 'nw', 'primus.js'));
        primus.destroy();
    });

    grunt.registerTask('intercept-exit', function ()
    {
        // Stop process.exit() being called, which hangs process
        // due to webtransport native code not being cleaned up
        require('grunt-legacy-util').exit = code =>
        {
            if (code)
            {
                process.exitCode = code;
            }
        };
    });
};
