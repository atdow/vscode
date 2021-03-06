/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { generateUuid } from 'vs/base/common/uuid';
import { isWindows } from 'vs/base/common/platform';
import { ILogService } from 'vs/platform/log/common/log';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';

function getUnixShellEnvironment(logService: ILogService): Promise<typeof process.env> {
	const promise = new Promise<typeof process.env>((resolve, reject) => {
		const runAsNode = process.env['ELECTRON_RUN_AS_NODE'];
		logService.trace('getUnixShellEnvironment#runAsNode', runAsNode);

		const noAttach = process.env['ELECTRON_NO_ATTACH_CONSOLE'];
		logService.trace('getUnixShellEnvironment#noAttach', noAttach);

		const mark = generateUuid().replace(/-/g, '').substr(0, 12);
		const regex = new RegExp(mark + '(.*)' + mark);

		const env = {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
			ELECTRON_NO_ATTACH_CONSOLE: '1'
		};

		const command = `'${process.execPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
		logService.trace('getUnixShellEnvironment#env', env);
		logService.trace('getUnixShellEnvironment#spawn', command);

		const child = spawn(process.env.SHELL!, ['-ilc', command], {
			detached: true,
			stdio: ['ignore', 'pipe', process.stderr],
			env
		});

		const buffers: Buffer[] = [];
		child.on('error', () => resolve({}));
		child.stdout.on('data', b => buffers.push(b));

		child.on('close', code => {
			if (code !== 0) {
				return reject(new Error('Failed to get environment'));
			}

			const raw = Buffer.concat(buffers).toString('utf8');
			logService.trace('getUnixShellEnvironment#raw', raw);

			const match = regex.exec(raw);
			const rawStripped = match ? match[1] : '{}';

			try {
				const env = JSON.parse(rawStripped);

				if (runAsNode) {
					env['ELECTRON_RUN_AS_NODE'] = runAsNode;
				} else {
					delete env['ELECTRON_RUN_AS_NODE'];
				}

				if (noAttach) {
					env['ELECTRON_NO_ATTACH_CONSOLE'] = noAttach;
				} else {
					delete env['ELECTRON_NO_ATTACH_CONSOLE'];
				}

				// https://github.com/microsoft/vscode/issues/22593#issuecomment-336050758
				delete env['XDG_RUNTIME_DIR'];

				logService.trace('getUnixShellEnvironment#result', env);
				resolve(env);
			} catch (err) {
				logService.error('getUnixShellEnvironment#error', err);
				reject(err);
			}
		});
	});

	// swallow errors
	return promise.catch(() => ({}));
}

let shellEnvPromise: Promise<typeof process.env> | undefined = undefined;

/**
 * We need to get the environment from a user's shell.
 * This should only be done when Code itself is not launched
 * from within a shell.
 */
export function getShellEnvironment(logService: ILogService, environmentService: INativeEnvironmentService): Promise<typeof process.env> {
	if (!shellEnvPromise) {
		if (environmentService.args['force-disable-user-env']) {
			logService.trace('getShellEnvironment(): skipped (--force-disable-user-env)');
			shellEnvPromise = Promise.resolve({});
		} else if (isWindows) {
			logService.trace('getShellEnvironment(): skipped (Windows)');
			shellEnvPromise = Promise.resolve({});
		} else if (process.env['VSCODE_CLI'] === '1' && !environmentService.args['force-user-env']) {
			logService.trace('getShellEnvironment(): skipped (VSCODE_CLI is set)');
			shellEnvPromise = Promise.resolve({});
		} else {
			if (process.env['VSCODE_CLI'] === '1') {
				logService.trace('getShellEnvironment(): running (--force-user-env)');
			} else {
				logService.trace('getShellEnvironment(): running (macOS/Linux)');
			}
			shellEnvPromise = getUnixShellEnvironment(logService);
		}
	}

	return shellEnvPromise;
}
