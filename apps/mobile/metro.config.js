// モノレポ対応の Metro 設定
// Expo 公式のモノレポガイド準拠（https://docs.expo.dev/guides/monorepos/）
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Expoが既定で設定するwatch対象（projectRoot）を保持しつつworkspaceRootを追加
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
