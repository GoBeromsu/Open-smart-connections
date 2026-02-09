export default {
  buildCommand: ['pnpm', 'run', 'dev:build'],
  deploy: {
    mode: 'delegate',
    envVar: 'DESTINATION_VAULTS',
  },
}
