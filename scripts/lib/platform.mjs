const targets = {
  'win32-x64': { platform: 'windows-x64', rust: 'x86_64-pc-windows-msvc', label: 'Windows x64', binary: 'session-tree.exe' },
  'darwin-arm64': { platform: 'macos-arm64', rust: 'aarch64-apple-darwin', label: 'Apple Silicon Mac', binary: 'session-tree' },
  'darwin-x64': { platform: 'macos-x64', rust: 'x86_64-apple-darwin', label: 'Intel Mac', binary: 'session-tree' },
};
export function hostTarget() {
  const id = process.platform + '-' + process.arch, target = targets[id];
  if (!target) throw new Error('Build or verify on Windows x64, Apple Silicon Mac or Intel Mac.');
  return { id, ...target };
}
