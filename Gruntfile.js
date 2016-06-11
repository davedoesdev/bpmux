/*global timeout: false,
         browser_timeout: false */
/*jslint node: true, nomen: true */
"use strict";

var path = require('path');

module.exports = function (grunt)
{
    grunt.initConfig(
    {
        jshint: {
            src: [ '*.js', 'test/*.js' ]
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

            examples: 'test/test_examples.js'
        },

        apidox: {
            input: [ 'index.js', 'events_doc.js' ],
            output: 'README.md',
            fullSourceDescription: true,
            extraHeadingLevels: 1
        },

        shell: {
            cover: {
                command: './node_modules/.bin/istanbul cover -x Gruntfile.js ./node_modules/.bin/grunt -- test-fast',
                maxBuffer: 1000000 * 1024
            },

            check_cover: {
                command: './node_modules/.bin/istanbul check-coverage --statement 100 --branch 100 --function 100 --line 100'
            },

            coveralls: {
                command: 'cat coverage/lcov.info | coveralls'
            },

            nw_build: {
                command: [
                    'find node_modules -mindepth 1 -maxdepth 1 -exec rm -f test/fixtures/nw/{} \\;',
                    'find node_modules -mindepth 1 -maxdepth 1 -not -name nw-builder -exec ln -sf ../../../../{} test/fixtures/nw/{} \\;',
                    './node_modules/.bin/nwbuild --quiet -p linux64 -v 0.12.3 test/fixtures/nw'
                ].join('&&')
            },

            bpmux_test: {
                command: './build/bpmux-test/linux64/bpmux-test'
            },

            bundle: {
                command: './node_modules/.bin/webpack --module-bind json test/fixtures/webpack/bundler.js test/fixtures/webpack/bundle.js'
            },

            bundle_example: {
                command: './node_modules/.bin/webpack --module-bind json test/fixtures/example/bundler.js test/fixtures/example/bundle.js'
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
    grunt.registerTask('test-examples', [ 'shell:bundle_example',
                                          'mochaTest:examples' ]);
    grunt.registerTask('test-browser', [ 'save-primus',
                                         'shell:bundle',
                                         'shell:nw_build',
                                         'shell:bpmux_test' ]);
    grunt.registerTask('docs', 'apidox');
    grunt.registerTask('coverage', ['shell:cover', 'shell:check_cover']);
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
