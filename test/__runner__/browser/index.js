var path = require('path');

require('require-self-ref');
require('../../../node-require').install();

var JSDOM = require('jsdom-global');
var MemoryFs = require('memory-fs');
var lasso = require('lasso');
var defaultPageTemplate = require('./page-template.marko');
var fs = require('fs');
var mkdirp = require('mkdirp');
var md5Hex = require('md5-hex');
var ok = require('assert').ok;
var url = require('url');
var shouldCover = !!process.env.NYC_CONFIG;

function generate(options) {
    return new Promise((resolve, reject) => {
        var memFs = new MemoryFs();
        var testsFile = options.testsFile;
        var pageTemplate = options.pageTemplate || defaultPageTemplate;
        var generatedDir = options.generatedDir;
        ok(generatedDir, '"options.generatedDir" is required');

        var outputFile = path.join(generatedDir, 'test.html');

        var browserDependencies = ["mocha/mocha.js", "mocha/mocha.css", "require-run: " + require.resolve('./mocha-setup'), 'require-run: ' + testsFile, "require: jquery", {
            "require-run": require.resolve('./mocha-run'),
            "slot": "mocha-run"
        }];

        var lassoConfig = {
            outputDir: path.join(generatedDir, 'static'),
            urlPrefix: './static',
            minify: false,
            bundlingEnabled: false,
            fingerprintsEnabled: false,
            plugins: [{
                plugin: 'lasso-fs-writer',
                config: {
                    fileSystem: memFs
                }
            }, {
                plugin: 'lasso-marko',
                config: {
                    output: 'vdom'
                }
            }, require('./lasso-autotest-plugin')]
        };

        if (shouldCover) {
            lassoConfig.plugins.push(require('./lasso-istanbul-plugin'));
        }

        var myLasso = lasso.create(lassoConfig);

        var templateData = {};

        Object.defineProperty(templateData, 'lasso', {
            value: myLasso,
            writable: false,
            configurable: false,
            enumerable: false
        });

        Object.defineProperty(templateData, 'browserDependencies', {
            value: browserDependencies,
            writable: false,
            configurable: false,
            enumerable: false
        });

        pageTemplate.render(templateData, function (err, html) {
            if (err) {
                return reject(err);
            }

            resolve({
                html: String(html),
                outputFile: outputFile,
                fs: memFs
            });
        });
    });
}

function runTests(options) {
    return generate(options).then(generated => {
        return new Promise(function (resolve, reject) {
            var html = generated.html;
            var memFs = generated.fs;
            var outputFile = generated.outputFile;
            var cleanup = JSDOM(html, {
                url: 'file://' + outputFile,
                resourceLoader: function (resource, done) {
                    memFs.readFile(url.resolve(outputFile, resource.url.pathname), done);
                },
                features: {
                    FetchExternalResources: ["script", "iframe", "link"]
                }
            });

            window.addEventListener('error', function (ev) {
                reject(ev.error);
            });

            window.addEventListener('load', function () {
                var runner = window.MOCHA_RUNNER;
                runner.on('end', function () {
                    if (shouldCover) {
                        var coverageFile = getCoverageFile(options.testsFile);
                        fs.writeFileSync(coverageFile, JSON.stringify(window.__coverage__));
                    }

                    cleanup();

                    runner.stats.failures.length
                        ? reject(new Error(runner.stats.failures.join(', ')))
                        : resolve();
                });
            });
        });
    });
}

function getCoverageFile(testsFile) {
    return './.nyc_output/' + md5Hex(testsFile) + '.json';
}

exports.generate = generate;
exports.runTests = runTests;
