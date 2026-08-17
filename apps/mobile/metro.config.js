const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const protocolSrc = path.resolve(workspaceRoot, 'packages/protocol/src');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.resolve(workspaceRoot, 'packages/protocol')];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'packages/protocol/node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// @hop/protocol is TypeScript ESM: source files import "./ids.js" while the
// file on disk is ids.ts. Metro does not rewrite that specifier, so iOS
// bundling fails on the first re-export from packages/protocol/src/index.ts.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath || '';
  const realOrigin = origin && fs.existsSync(origin) ? fs.realpathSync(origin) : origin;
  if (
    realOrigin.startsWith(protocolSrc + path.sep) &&
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js')
  ) {
    const tsPath = path.resolve(path.dirname(realOrigin), moduleName.replace(/\.js$/, '.ts'));
    if (fs.existsSync(tsPath)) {
      return { type: 'sourceFile', filePath: tsPath };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
