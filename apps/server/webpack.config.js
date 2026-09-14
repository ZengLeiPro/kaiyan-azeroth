const nodeExternals = require('webpack-node-externals');
const { join } = require('path');

module.exports = (options) => {
  return {
    ...options,
    target: 'node',
    externals: [
      nodeExternals({
        // 关键修复：将以 @ky-azeroth 开头的内部包放入白名单，使其被 Webpack 打包进 dist
        allowlist: [/^@ky-azeroth/],
      }),
    ],
    output: {
      ...options.output,
      path: join(__dirname, 'dist'),
      filename: 'main.js',
    },
  };
};
