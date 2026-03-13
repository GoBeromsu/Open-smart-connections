export default {
  dev: {
    buildCommand: ['pnpm', 'run', 'dev:build'],
    deploy: {
      mode: 'delegate',
      envVar: 'DESTINATION_VAULTS',
    },
  },
  ci: {
    pushBranches: ['main'],
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
