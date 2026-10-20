const path = require('path');
const fileSystem = require('fs-extra');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

const env = require('./utils/env');
const {
  getBuildPath,
  normalizeTarget,
  stringifyManifest,
} = require('./utils/manifest');

const ASSET_PATH = process.env.ASSET_PATH || '/';

const fileExtensions = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'eot',
  'otf',
  'svg',
  'ttf',
  'woff',
  'woff2',
];

module.exports = function createWebpackConfig(options = {}) {
  const target = normalizeTarget(options.target || process.env.EXTENSION_TARGET);
  const mode = options.mode || process.env.NODE_ENV || 'development';
  const outputPath = getBuildPath(target);
  const alias = {};
  const secretsPath = path.join(__dirname, `secrets.${env.NODE_ENV}.js`);

  if (fileSystem.existsSync(secretsPath)) {
    alias.secrets = secretsPath;
  }

  const config = {
    mode,
    entry: {
      options: path.join(__dirname, 'src', 'pages', 'Options', 'index.js'),
      miradorpage: path.join(
        __dirname,
        'src',
        'pages',
        'MiradorPage',
        'index.js'
      ),
      popup: path.join(__dirname, 'src', 'pages', 'Popup', 'index.jsx'),
      background: path.join(__dirname, 'src', 'pages', 'Background', 'index.js'),
    },
    chromeExtensionBoilerplate: {
      notHotReload: ['background'],
    },
    output: {
      path: outputPath,
      filename: '[name].bundle.js',
      clean: true,
      publicPath: ASSET_PATH,
    },
    module: {
      rules: [
        {
          test: /\.(css|scss)$/,
          use: [
            {
              loader: 'style-loader',
            },
            {
              loader: 'css-loader',
            },
            {
              loader: 'sass-loader',
              options: {
                sourceMap: true,
              },
            },
          ],
        },
        {
          test: new RegExp(`.(${fileExtensions.join('|')})$`),
          loader: 'file-loader',
          options: {
            name: '[name].[ext]',
          },
          exclude: /node_modules/,
        },
        {
          test: /\.html$/,
          loader: 'html-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.(js|jsx)$/,
          use: [
            {
              loader: 'source-map-loader',
            },
            {
              loader: 'babel-loader',
            },
          ],
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      symlinks: false,
      alias,
      extensions: fileExtensions
        .map((extension) => `.${extension}`)
        .concat(['.js', '.jsx', '.ts', '.tsx', '.css']),
    },
    plugins: [
      new webpack.ProgressPlugin(),
      new webpack.EnvironmentPlugin(['NODE_ENV']),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'src/themes/active/manifest.common.json',
            to: path.join(outputPath, 'manifest.json'),
            force: true,
            transform: () => Buffer.from(stringifyManifest(target)),
          },
          {
            from: 'src/themes/active/images/icon-34.png',
            to: path.join(outputPath, 'icon-34.png'),
            force: true,
          },
          {
            from: 'src/themes/active/images/icon-128.png',
            to: path.join(outputPath, 'icon-128.png'),
            force: true,
          },
        ],
      }),
      new HtmlWebpackPlugin({
        template: path.join(__dirname, 'src', 'pages', 'Options', 'index.html'),
        filename: 'options.html',
        chunks: ['options'],
        cache: false,
      }),
      new HtmlWebpackPlugin({
        template: path.join(__dirname, 'src', 'pages', 'Popup', 'index.html'),
        filename: 'popup.html',
        chunks: ['popup'],
        cache: false,
      }),
      new HtmlWebpackPlugin({
        template: path.join(
          __dirname,
          'src',
          'pages',
          'MiradorPage',
          'index.html'
        ),
        filename: 'miradorpage.html',
        chunks: ['miradorpage'],
        cache: false,
      }),
    ],
    infrastructureLogging: {
      level: 'info',
    },
  };

  if (mode === 'development') {
    config.devtool = 'cheap-module-source-map';
  } else {
    config.optimization = {
      minimize: true,
      minimizer: [
        new TerserPlugin({
          extractComments: false,
        }),
      ],
    };
  }

  return config;
};
