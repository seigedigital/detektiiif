const { build } = require('./build');
const { TARGETS } = require('./manifest');

async function main() {
  for (const target of TARGETS) {
    console.log(`\nBuilding ${target} MV3 extension...`);
    await build(target);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
