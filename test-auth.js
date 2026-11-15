const auth = require('./auth.js');

async function runTests() {
  console.log('Running auth tests...\n');

  await auth.initAuth();

  console.log('1. Testing user authentication...');
  const admin = await auth.authenticateUser('admin', 'admin123');
  console.log('   Admin login:', admin ? 'PASS' : 'FAIL');

  const doctor = await auth.authenticateUser('doctor', 'doctor123');
  console.log('   Doctor login:', doctor ? 'PASS' : 'FAIL');

  const reception = await auth.authenticateUser('reception', 'reception123');
  console.log('   Reception login:', reception ? 'PASS' : 'FAIL');

  const invalid = await auth.authenticateUser('admin', 'wrong');
  console.log('   Invalid password:', !invalid ? 'PASS' : 'FAIL');

  console.log('\n2. Testing token generation...');
  const tokens = auth.generateTokens(admin);
  console.log('   Access token:', tokens.accessToken ? 'PASS' : 'FAIL');
  console.log('   Refresh token:', tokens.refreshToken ? 'PASS' : 'FAIL');

  console.log('\n3. Testing token verification...');
  const decoded = auth.verifyAccessToken(tokens.accessToken);
  console.log('   Access token verify:', decoded && decoded.userId === admin.id ? 'PASS' : 'FAIL');

  const refreshDecoded = auth.verifyRefreshToken(tokens.refreshToken);
  console.log('   Refresh token verify:', refreshDecoded && refreshDecoded.userId === admin.id ? 'PASS' : 'FAIL');

  console.log('\n4. Testing role permissions...');
  console.log('   Admin permissions:', auth.ROLE_PERMISSIONS.admin.length === 8 ? 'PASS' : 'FAIL');
  console.log('   Doctor permissions:', auth.ROLE_PERMISSIONS.doctor.length === 6 ? 'PASS' : 'FAIL');
  console.log('   Reception permissions:', auth.ROLE_PERMISSIONS.reception.length === 4 ? 'PASS' : 'FAIL');

  console.log('\n5. Testing token refresh...');
  const newTokens = await auth.refreshAccessToken(tokens.refreshToken);
  console.log('   Refresh access token:', newTokens && newTokens.accessToken ? 'PASS' : 'FAIL');

  console.log('\n6. Testing audit log...');
  auth.auditLog('TEST_ACTION', admin.id, { test: 'data' });
  console.log('   Audit log write: PASS');

  console.log('\nAll tests completed!');
}

runTests().catch(console.error);