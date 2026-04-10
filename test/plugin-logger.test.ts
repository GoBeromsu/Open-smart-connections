import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginLogger } from '../src/ui/plugin-logger';

describe('PluginLogger', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('routes info logging through console.debug', () => {
		const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const logger = new PluginLogger('test');
		logger.info('hello');

		expect(debugSpy).toHaveBeenCalled();
		expect(infoSpy).not.toHaveBeenCalled();
	});

	it('serializes Error objects into readable error output', () => {
		const logger = new PluginLogger('test');
		logger.error('something went wrong', new Error('boom'));

		const logged = errorSpy.mock.calls[0]?.[0] as string;
		expect(logged).toContain('boom');
		expect(logged).not.toContain('[object Object]');
	});

	it('serializes non-Error error details without [object Object]', () => {
		const logger = new PluginLogger('test');
		logger.error('oops', { code: 42 });

		const logged = errorSpy.mock.calls[0]?.[0] as string;
		expect(logged).not.toContain('[object Object]');
	});
});
