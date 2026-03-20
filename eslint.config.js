import { baseConfig } from './eslint.base.js'

export default [
	...baseConfig,
	// SC has an extensive existing codebase with console usage and `any` types.
	// Downgraded to warn until all instances are incrementally resolved.
	{
		files: ['src/**/*.ts', 'worker/**/*.ts'],
		rules: {
			'no-console': 'warn',
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
			],
		},
	},
]
