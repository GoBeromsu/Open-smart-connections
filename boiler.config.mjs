export default {
  dev: {
    buildCommand: ['pnpm', 'run', 'dev:build'],
    deploy: {
      mode: 'delegate',
      envVar: 'DESTINATION_VAULTS',
    },
  },
  sync: {
    skipDestinations: [
      ['src', 'shared', 'plugin-notices.ts'],
      ['src', 'shared', 'plugin-logger.ts'],
    ],
  },
  ci: {
    pushBranches: ['main'],
  },
  version: {
    stageFiles: ['manifest.json', 'versions.json'],
  },
  release: {
    pluginName: 'open-smart-connections',
    copyFiles: ['dist/main.js', 'dist/manifest.json', 'dist/styles.css'],
    publishFiles: [
      '${{ env.PLUGIN_NAME }}.zip',
      'dist/main.js',
      'dist/manifest.json',
      'dist/styles.css',
    ],
  },
};
