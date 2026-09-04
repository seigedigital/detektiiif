process.env.BABEL_ENV = 'development';
process.env.NODE_ENV = 'development';
process.env.ASSET_PATH = '/';

const path = require('path');
const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');

const createWebpackConfig = require('../webpack.config');
const env = require('./env');
const { getBuildPath, normalizeTarget } = require('./manifest');

const target = normalizeTarget(process.argv[2] || 'chrome');
const host = '127.0.0.1';
const config = createWebpackConfig({ mode: 'development', target });
delete config.chromeExtensionBoilerplate;

const compiler = webpack(config);
const server = new WebpackDevServer(
  {
    hot: false,
    client: false,
    host,
    port: env.PORT,
    static: {
      directory: getBuildPath(target),
    },
    devMiddleware: {
      publicPath: `http://${host}:${env.PORT}/`,
      writeToDisk: true,
    },
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    allowedHosts: 'all',
  },
  compiler
);

(async () => {
  await server.start();
  console.log(`Serving ${target} build at http://${host}:${env.PORT}/`);
})();
