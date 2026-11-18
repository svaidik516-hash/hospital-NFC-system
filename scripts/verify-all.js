/**
 * Master Verification Suite
 * Executes all automated tests for Data Persistence (R1) & Email Notifications (R2)
 */

const { fork } = require('child_process');
const path = require('path');

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶️ Running ${path.basename(scriptPath)}...`);
    const child = fork(scriptPath, [], { stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
      }
    });
  });
}

async function runAll() {
  console.log('====================================================');
  console.log('🚀 RUNNING MASTER VERIFICATION SUITE');
  console.log('====================================================');

  const startTime = Date.now();
  await runScript(path.join(__dirname, 'verify-persistence.js'));
  await runScript(path.join(__dirname, 'verify-notifications.js'));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('====================================================');
  console.log(`🏆 ALL VERIFICATION SUITES PASSED in ${elapsed}s!`);
  console.log('====================================================\n');
}

runAll().catch(err => {
  console.error('\n❌ Master Verification Suite Failed:', err.message);
  process.exit(1);
});
