const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  const rootDir = __dirname;
  const pkgPath = path.join(rootDir, 'package.json');
  const nodeModulesDir = path.join(rootDir, 'node_modules');

  if (!fs.existsSync(pkgPath)) {
    process.exit(0);
  }

  if (!fs.existsSync(nodeModulesDir)) {
    console.log('\x1b[33m[Frontend Setup] Chưa có node_modules. Đang tự động chạy npm install...\x1b[0m');
    execSync('npm install', { stdio: 'inherit', cwd: rootDir, shell: true });
    process.exit(0);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  const missing = [];
  for (const dep of Object.keys(allDeps)) {
    const depPath = path.join(nodeModulesDir, ...dep.split('/'));
    if (!fs.existsSync(depPath)) {
      missing.push(dep);
    }
  }

  if (missing.length > 0) {
    console.log(
      `\x1b[33m[Frontend Setup] Phát hiện thiếu ${missing.length} thư viện (${missing.join(', ')}). Đang tự động chạy npm install...\x1b[0m`
    );
    execSync('npm install', { stdio: 'inherit', cwd: rootDir, shell: true });
    console.log('\x1b[32m[Frontend Setup] Cài đặt hoàn tất!\x1b[0m');
  }
} catch (err) {
  console.warn('[Frontend Setup] Cảnh báo kiểm tra thư viện:', err.message);
}
