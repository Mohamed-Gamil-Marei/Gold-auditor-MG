import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

async function runDist() {
  // On non-Windows environments where Wine is not installed, fall back to electron-builder's
  // built-in pure-JS UninstallerReader.exec so NSIS installer .exe builds succeed without Wine.
  if (process.platform !== 'win32') {
    try {
      const { WineVmManager } = require('app-builder-lib/out/vm/WineVm');
      const { UninstallerReader } = require('app-builder-lib/out/targets/nsis/nsisUtil');
      const origExec = WineVmManager.prototype.exec;

      WineVmManager.prototype.exec = async function (file, args, options, isLogOutIfDebug) {
        try {
          return await origExec.call(this, file, args, options, isLogOutIfDebug);
        } catch (err) {
          if (String(err?.message || err).includes('ENOENT')) {
            const uninstallerPath = path.join(
              path.dirname(file),
              `${path.basename(file, 'exe')}__uninstaller.exe`
            );
            console.log(
              `[build-dist] Wine not installed; extracting NSIS uninstaller in pure JS -> ${uninstallerPath}`
            );
            await UninstallerReader.exec(file, uninstallerPath);
            return '';
          }
          throw err;
        }
      };
    } catch (e) {
      console.warn('[build-dist] Warning setting Wine fallback:', e);
    }
  }

  const builder = require('electron-builder');
  await builder.build({
    targets: builder.Platform.WINDOWS.createTarget('nsis', builder.Arch.x64),
  });
}

runDist().catch((err) => {
  console.error(err);
  process.exit(1);
});
