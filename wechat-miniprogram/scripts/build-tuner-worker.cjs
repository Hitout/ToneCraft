const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Worker 的依赖必须位于线程目录内，打包同一个检测器供线程独立加载。
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'miniprogram/core/tuner/yin-detector.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS },
}).outputText;
fs.writeFileSync(path.join(root, 'miniprogram/workers/tuner/yin-detector.js'), output);
