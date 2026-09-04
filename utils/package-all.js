process.env.BABEL_ENV = 'production';
process.env.NODE_ENV = 'production';
process.env.ASSET_PATH = '/';

const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');

const { build } = require('./build');
const {
  TARGETS,
  getBuildPath,
  getPackageBaseName,
  normalizeTarget,
} = require('./manifest');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(args) {
  if (args.length === 0) {
    return { targets: TARGETS, outDir: path.join(repoRoot, 'dist') };
  }

  try {
    const target = normalizeTarget(args[0]);
    return {
      targets: [target],
      outDir: path.resolve(repoRoot, args[1] || 'dist'),
    };
  } catch {
    return { targets: TARGETS, outDir: path.resolve(repoRoot, args[0]) };
  }
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed.`);
  }
}

function zipBuild(target, outDir) {
  const buildPath = getBuildPath(target);
  const zipPath = path.join(outDir, `${getPackageBaseName(target)}.zip`);

  fs.removeSync(zipPath);
  run('zip', ['-qr', zipPath, '.'], { cwd: buildPath });

  return zipPath;
}

function packageFirefoxSource(outDir) {
  const sourcePath = path.join(
    outDir,
    `${getPackageBaseName('firefox')}-source.tar.gz`
  );

  fs.removeSync(sourcePath);
  run(
    'tar',
    [
      '--exclude',
      './.git',
      '--exclude',
      './build',
      '--exclude',
      './dist',
      '--exclude',
      './node_modules',
      '-czf',
      sourcePath,
      '.',
    ],
    { cwd: repoRoot }
  );

  return sourcePath;
}

async function main() {
  const { targets, outDir } = parseArgs(process.argv.slice(2));
  fs.ensureDirSync(outDir);

  const artifacts = [];

  for (const target of targets) {
    console.log(`\nPackaging ${target} MV3 extension...`);
    await build(target);
    artifacts.push(zipBuild(target, outDir));
  }

  if (targets.includes('firefox')) {
    artifacts.push(packageFirefoxSource(outDir));
  }

  console.log('\nCreated artifacts:');
  for (const artifact of artifacts) {
    console.log(`- ${path.relative(repoRoot, artifact)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
