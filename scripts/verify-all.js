/**
 * Master Verification Suite
 * Executes automated tests for Data Persistence (R1) & Email Notifications (R2)
 * Supports CLI flags: --local, --live, --db-only, --email-only, --all
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
  const args = process.argv.slice(2);
  const isLive = args.includes('--live');
  const isDbOnly = args.includes('--db-only') || args.includes('--persistence-only');
  const isEmailOnly = args.includes('--email-only') || args.includes('--notifications-only');
  const isAll = args.includes('--all');

  console.log('====================================================');
  console.log('🚀 RUNNING MASTER VERIFICATION SUITE');
  console.log(`   Flags: ${args.length > 0 ? args.join(' ') : '--local (default)'}`);
  console.log('====================================================');

  const startTime = Date.now();

  if (isLive) {
    await runScript(path.join(__dirname, 'verify-live-deployment.js'));
  } else if (isDbOnly) {
    await runScript(path.join(__dirname, 'verify-persistence.js'));
  } else if (isEmailOnly) {
    await runScript(path.join(__dirname, 'verify-notifications.js'));
  } else if (isAll) {
    await runScript(path.join(__dirname, 'verify-persistence.js'));
    await runScript(path.join(__dirname, 'verify-notifications.js'));
    await runScript(path.join(__dirname, 'verify-live-deployment.js'));
  } else {
    // Default / --local mode
    await runScript(path.join(__dirname, 'verify-persistence.js'));
    await runScript(path.join(__dirname, 'verify-notifications.js'));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('====================================================');
  console.log(`🏆 ALL VERIFICATION SUITES PASSED in ${elapsed}s!`);
  console.log('====================================================\n');
}

runAll().catch(err => {
  console.error('\n❌ Master Verification Suite Failed:', err.message);
  process.exit(1);
});
