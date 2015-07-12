/*global timeout: false,
         browser_timeout: false */
/*jslint node: true, nomen: true */
"use strict";

var path = require('path');

module.exports = function (grunt)
{
    grunt.initConfig(
    {
        jslint: {
            all: {
                src: [ '*.js', 'test/*.js' ],
                directives: {
                    white: true
                }
            }
        },

        env: {
            fast: {
                FAST: 'yes'
            }
        },

        cafemocha: {
            default: {
                src: [ 'test/test_tcp.js', 'test/test_channel_full.js' ],
                options: {
                    timeout: 10 * 60 * 1000,
                    bail: true,
                    reporter: 'spec'
                }
            },

            examples: 'test/test_examples.js'
        },

        nodewebkit: {
            options: {
                platforms: [ 'linux64' ]
            },
            src: 'test/fixtures/nw/**'
        },

        apidox: {
            input: [ 'index.js', 'events_doc.js' ],
            output: 'README.md',
            fullSourceDescription: true,
            extraHeadingLevels: 1
        },

        exec: {
            cover: {
                cmd: './node_modules/.bin/istanbul cover -x Gruntfile.js ./node_modules/.bin/grunt -- test-fast',
                maxBuffer: 10000 * 1024
            },

            check_cover: {
                cmd: './node_modules/.bin/istanbul check-coverage --statement 100 --branch 100 --function 100 --line 100'
            },

            coveralls: {
                cmd: 'cat coverage/lcov.info | coveralls'
            },

            bpmux_test: {
                cmd: './build/bpmux-test/linux64/bpmux-test'
            }
        },

        webpack: {
            bundle: {
                entry: path.join(__dirname, 'test', 'fixtures', 'webpack', 'bundler.js'),
                output: {
                    path: path.join(__dirname, 'test', 'fixtures', 'webpack'),
                    filename: 'bundle.js'
                },
                stats: {
                    modules: true
                }
            },

            bundle_example: {
                entry: path.join(__dirname, 'test', 'fixtures', 'example', 'bundler.js'),
                output: {
                    path: path.join(__dirname, 'test', 'fixtures', 'example'),
                    filename: 'bundle.js'
                },
                stats: {
                    modules: true
                }
            }
        }
    });
    
    grunt.loadNpmTasks('grunt-jslint');
    grunt.loadNpmTasks('grunt-cafe-mocha');
    grunt.loadNpmTasks('grunt-apidox');
    grunt.loadNpmTasks('grunt-exec');
    grunt.loadNpmTasks('grunt-webpack');
    grunt.loadNpmTasks('grunt-node-webkit-builder');
    grunt.loadNpmTasks('grunt-env');

    grunt.registerTask('lint', 'jslint:all');
    grunt.registerTask('test', 'cafemocha:default');
    grunt.registerTask('test-fast', ['env:fast', 'cafemocha:default']);
    grunt.registerTask('test-examples', [ 'webpack:bundle_example',
                                          'cafemocha:examples' ]);
    grunt.registerTask('test-browser', [ 'save-primus',
                                         'webpack:bundle',
                                         'nodewebkit',
                                         'exec:bpmux_test' ]);
    grunt.registerTask('docs', 'apidox');
    grunt.registerTask('coverage', ['exec:cover', 'exec:check_cover']);
    grunt.registerTask('coveralls', 'exec:coveralls');
    grunt.registerTask('default', ['lint', 'test']);

    grunt.registerTask('save-primus', function ()
    {
        var Primus = require('primus'),
            primus = Primus.createServer({ port: 7000 });
        primus.save(path.join(__dirname, 'test', 'fixtures', 'nw', 'primus.js'));
        primus.destroy();
    });
};
