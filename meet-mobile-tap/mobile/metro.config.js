const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repositoryRoot = path.resolve(projectRoot, "..");
const config = getDefaultConfig(projectRoot);

// The mobile client consumes the same validated room-data contract as the
// monitor and browser. Keep native package resolution anchored in mobile.
config.watchFolders = [repositoryRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

module.exports = config;
