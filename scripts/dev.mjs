// Starts the API and the web app together on Windows, macOS and Linux; Ctrl+C stops both.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = ['server', 'client'].map((ws) =>
  spawn(npm, ['run', 'dev', '--workspace', ws], { stdio: 'inherit', shell: process.platform === 'win32' }),
);
const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', (code) => { if (code) { stop(); process.exitCode = code; } }));
