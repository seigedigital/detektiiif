process.env.BABEL_ENV = process.env.BABEL_ENV || 'production';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.ASSET_PATH = process.env.ASSET_PATH || '/';

const webpack = require('webpack');

const createWebpackConfig = require('../webpack.config');
const { normalizeTarget } = require('./manifest');

function build(targetArg) {
  const target = normalizeTarget(targetArg || process.argv[2] || 'chrome');
  const config = createWebpackConfig({
    mode: process.env.NODE_ENV,
    target,
  });

  delete config.chromeExtensionBoilerplate;
  config.mode = process.env.NODE_ENV;

  return new Promise((resolve, reject) => {
    webpack(config, (err, stats) => {
      if (err) {
        reject(err);
        return;
      }

      const output = stats.toString({
        colors: true,
        chunks: false,
        modules: false,
        children: false,
      });

      if (output) {
        console.log(output);
      }

      if (stats.hasErrors()) {
        reject(new Error(`Webpack build failed for ${target}.`));
        return;
      }

      resolve(stats);
    });
  });
}

if (require.main === module) {
  build().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { build };
