import { spawn } from 'child_process';
import http from 'http';

function waitForVite(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve(true);
        })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error('Timeout waiting for Vite dev server on ' + url));
          } else {
            setTimeout(check, 400);
          }
        });
    };
    check();
  });
}

async function runElectronDev() {
  console.log('[electron:dev] Building Electron main & preload (.cjs)...');
  await new Promise((resolve, reject) => {
    const buildProc = spawn('npm', ['run', 'build:electron'], {
      stdio: 'inherit',
      shell: true,
    });
    buildProc.on('exit', (code) => (code === 0 ? resolve(true) : reject(new Error('build:electron failed'))));
  });

  console.log('[electron:dev] Starting Vite server on http://localhost:3000...');
  const viteProc = spawn('npx', ['vite', '--port', '3000'], {
    stdio: 'inherit',
    shell: true,
  });

  try {
    await waitForVite('http://localhost:3000');
    console.log('[electron:dev] Vite is ready! Launching Electron window...');
    const electronProc = spawn('npx', ['electron', '.'], {
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ELECTRON_START_URL: 'http://localhost:3000',
      },
    });

    electronProc.on('exit', (code) => {
      viteProc.kill();
      process.exit(code ?? 0);
    });
  } catch (err) {
    console.error(err);
    viteProc.kill();
    process.exit(1);
  }
}

runElectronDev();
