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
// file on disk is ids.ts. Prefer platform-specific files (sodium.native.ts)
// so iOS/Android never load libsodium-wrappers / wasm2js.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath || '';
  const realOrigin = origin && fs.existsSync(origin) ? fs.realpathSync(origin) : origin;
  if (
    realOrigin.startsWith(protocolSrc + path.sep) &&
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js')
  ) {
    const dir = path.dirname(realOrigin);
    const withoutJs = moduleName.replace(/\.js$/, '');
    const candidates = [];
    if (platform === 'ios' || platform === 'android') {
      candidates.push(path.resolve(dir, `${withoutJs}.native.ts`));
      candidates.push(path.resolve(dir, `${withoutJs}.${platform}.ts`));
    }
    candidates.push(path.resolve(dir, `${withoutJs}.ts`));
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        return { type: 'sourceFile', filePath };
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
