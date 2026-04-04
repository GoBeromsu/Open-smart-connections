export default {
  dev: {
    buildCommand: ['pnpm', 'run', 'dev:build'],
    deploy: {
      mode: 'delegate',
      envVar: 'DESTINATION_VAULTS',
    },
  },
  sync: {
    skipDestinations: [['eslint.config.mts']],
  },
  ci: {
    pushBranches: ['main'],
  },
  version: {
    stageFiles: ['package.json', 'manifest.json', 'versions.json'],
  },
  release: {
    pluginName: 'open-smart-connections',
    copyFiles: ['dist/main.js', 'dist/manifest.json', 'dist/styles.css'],
    publishFiles: [
      '${{ env.PLUGIN_NAME }}.zip',
      'dist/main.js',
      'dist/manifest.json',
      'dist/styles.css',
      'versions.json',
    ],
  },
};
