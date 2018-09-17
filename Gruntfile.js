/*global timeout: false,
         browser_timeout: false */
/*jslint node: true, nomen: true */
"use strict";

var path = require('path');

// Enable passing options in title (WithOptions in test/test_comms.js)
require('mocha/lib/utils').isString = function (obj)
{
    return true;
};

module.exports = function (grunt)
{
    grunt.initConfig(
    {
        jshint: {
            src: [ '*.js', 'test/*.js' ],
            options: {
                esversion: 6
            }
        },

        env: {
            fast: {
                FAST: 'yes'
            }
        },

        mochaTest: {
            default: {
                src: [ 'test/test_tcp.js',
                       'test/test_channel_full.js',
                       'test/test_inline_stream.js'],
                options: {
                    timeout: 10 * 60 * 1000,
                    bail: true,
                    reporter: 'spec'
                }
            },

            examples: 'test/test_examples.js',

            inline: 'test/test_inline_stream.js'
        },

        apidox: {
            input: [ 'index.js', 'events_doc.js' ],
            output: 'README.md',
            fullSourceDescription: true,
            extraHeadingLevels: 1
        },

        shell: {
            cover: {
                command: "./node_modules/.bin/nyc -x Gruntfile.js -x 'test/**' ./node_modules/.bin/grunt test-fast",
                execOptions: {
                    maxBuffer: 10000 * 1024
                }
            },

            cover_report: {
                command: './node_modules/.bin/nyc report -r lcov'
            },

            cover_check: {
                command: './node_modules/.bin/nyc check-coverage --statements 100 --branches 100 --functions 100 --lines 100'
            },

            coveralls: {
                command: 'cat coverage/lcov.info | coveralls'
            },

            nw_build: {
                command: [
                    'rsync -a node_modules test/fixtures/nw --exclude nw-builder',
                    'cp index.js test/fixtures/nw/node_modules/bpmux.js',
                    'cp test/test_browser.js test/fixtures/nw/node_modules',
                    'cp test/test_comms.js test/fixtures/nw/node_modules',
                    'cp test/fixtures/webpack/bundle.js test/fixtures/nw',
                    'mkdir -p test/fixtures/nw/node_modules/fixtures',
                    'touch test/fixtures/nw/node_modules/fixtures/keep',
                    'mkdir -p test/fixtures/nw/node_modules/certs',
                    'cp test/certs/server.* test/fixtures/nw/node_modules/certs',
                    './node_modules/.bin/nwbuild --quiet -p linux64 test/fixtures/nw'
                ].join('&&')
            },

            bpmux_test: {
                command: './build/bpmux-test/linux64/bpmux-test',
                execOptions: {
                    maxBuffer: 10000 * 1024
                }
            },

            bundle: {
                command: './node_modules/.bin/webpack --mode production --config test/webpack.config.js'
            },

            bundle_example: {
                command: './node_modules/.bin/webpack --mode production --config test/webpack.example.config.js'
            },

            certs: {
                command: 'if [ ! -f test/certs/server.crt ]; then ./test/certs/make_ca_cert.sh && ./test/certs/make_server_cert.sh; fi'
            }
        }
    });
    
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-apidox');
    grunt.loadNpmTasks('grunt-shell');
    grunt.loadNpmTasks('grunt-env');

    grunt.registerTask('lint', 'jshint');
    grunt.registerTask('test', 'mochaTest:default');
    grunt.registerTask('test-fast', ['env:fast', 'mochaTest:default']);
    grunt.registerTask('test-inline', 'mochaTest:inline');
    grunt.registerTask('test-examples', [ 'shell:bundle_example',
                                          'mochaTest:examples' ]);
    grunt.registerTask('test-browser', [ 'save-primus',
                                         'shell:certs',
                                         'shell:bundle',
                                         'shell:nw_build',
                                         'shell:bpmux_test' ]);
    grunt.registerTask('docs', 'apidox');
    grunt.registerTask('coverage', ['shell:cover',
                                    'shell:cover_report',
                                    'shell:cover_check']);
    grunt.registerTask('coveralls', 'shell:coveralls');
    grunt.registerTask('default', ['lint', 'test']);

    grunt.registerTask('save-primus', function ()
    {
        var Primus = require('primus'),
            primus = Primus.createServer({ port: 7000 });
        primus.save(path.join(__dirname, 'test', 'fixtures', 'nw', 'primus.js'));
        primus.destroy();
    });
};
