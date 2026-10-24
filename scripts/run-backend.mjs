import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const binary = fileURLToPath(new URL('../plugins/session-tree/bin/session-tree' + (process.platform === 'win32' ? '.exe' : ''), import.meta.url));
const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message + '\nBuild the backend first: npm run build:backend'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
