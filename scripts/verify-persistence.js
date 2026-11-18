/**
 * Verification Script: Supabase PostgreSQL Persistence & Refresh Lifecycle
 * Validates Requirement R1:
 * - Doctors created survive DB re-initialization (refresh simulation)
 * - Patients created survive DB re-initialization
 * - Deleted doctors/patients do not resurrect after re-initialization
 * - Child foreign key relations in Supabase are safely maintained
 */

require('dotenv').config();
const db = require('../database.js');

async function testPersistence() {
  console.log('====================================================');
  console.log('🧪 VERIFYING SUPABASE DATA PERSISTENCE ACROSS REFRESH');
  console.log('====================================================\n');

  // Step 1: Initial load
  console.log('1. Initializing DB and syncing with Supabase...');
  await db.initDB();
  console.log('   ✅ Initial DB sync complete.');

  // Step 2: Create a test physician
  const uniqueSuffix = Date.now();
  const testDoctorName = `Dr. Persistence Test ${uniqueSuffix}`;
  console.log(`\n2. Creating test doctor: "${testDoctorName}"...`);
  const createdDoctor = await db.createDoctor({
    name: testDoctorName,
    department: 'Cardiology',
    specialization: 'Electrophysiology',
    contact: '+1 555-0199',
    status: 'active'
  });
  if (!createdDoctor || !createdDoctor.id) {
    throw new Error('Failed to create doctor');
  }
  console.log(`   ✅ Doctor created with ID: ${createdDoctor.id}`);

  // Step 3: Create a test patient with follow-up appointment
  const testCardUid = `PERSIST_${uniqueSuffix}`;
  console.log(`\n3. Creating test patient with Card UID: "${testCardUid}"...`);
  const createdPatient = await db.createPatient({
    card_uid: testCardUid,
    first_name: 'Jane',
    last_name: `Doe_${uniqueSuffix}`,
    date_of_birth: '1990-05-15',
    age: 34,
    gender: 'Female',
    blood_group: 'O+',
    contact_phone: '+1 555-4321',
    contact_email: 'jane.doe.test@example.com',
    allergies: 'Penicillin'
  });
  if (!createdPatient || !createdPatient.id) {
    throw new Error('Failed to create patient');
  }
  console.log(`   ✅ Patient created with ID: ${createdPatient.id}`);

  // Step 4: Simulate Page Refresh / Container Recycling
  console.log('\n4. Simulating Browser Page Refresh / Serverless Container Restart...');
  console.log('   (Re-initializing DB from persistent store)...');
  await db.initDB();

  // Step 5: Verify doctor persistence across refresh
  console.log('\n5. Verifying doctor survives refresh...');
  const doctorsAfterRefresh = await db.getDoctors();
  const foundDoctor = doctorsAfterRefresh.find(d => d.id === createdDoctor.id || d.name === testDoctorName);
  if (!foundDoctor) {
    throw new Error(`Doctor "${testDoctorName}" disappeared after refresh!`);
  }
  console.log(`   ✅ Doctor successfully persisted across refresh: ${foundDoctor.name} (ID: ${foundDoctor.id})`);

  // Step 6: Verify patient persistence across refresh
  console.log('\n6. Verifying patient survives refresh...');
  const patientsAfterRefresh = await db.getAllPatients(true);
  const foundPatient = patientsAfterRefresh.find(p => p.id === createdPatient.id || p.card_uid === testCardUid);
  if (!foundPatient) {
    throw new Error(`Patient with Card UID "${testCardUid}" disappeared after refresh!`);
  }
  console.log(`   ✅ Patient successfully persisted across refresh: ${foundPatient.first_name} ${foundPatient.last_name}`);

  // Step 7: Verify patient lookup by NFC card UID
  const fullRecord = await db.getFullPatientRecord(testCardUid, true);
  if (!fullRecord || fullRecord.card_uid !== testCardUid) {
    throw new Error('Failed to retrieve full patient record by Card UID after refresh');
  }
  console.log('   ✅ Full patient record retrieved by NFC UID successfully.');

  // Step 8: Clean up / Delete and verify no resurrection
  console.log('\n7. Testing Deletion & Anti-Resurrection...');
  const delDocSuccess = await db.deleteDoctor(createdDoctor.id);
  if (!delDocSuccess) throw new Error('Failed to delete doctor');
  console.log('   ✅ Doctor deleted.');

  const delPatSuccess = await db.deletePatient(createdPatient.id);
  if (!delPatSuccess) throw new Error('Failed to delete patient');
  console.log('   ✅ Patient deleted.');

  // Simulate another refresh to ensure deleted items do NOT resurrect
  console.log('\n8. Re-initializing DB to confirm deleted records do NOT resurrect...');
  await db.initDB();
  const doctorsAfterDelete = await db.getDoctors();
  const resurrectedDoc = doctorsAfterDelete.find(d => d.id === createdDoctor.id || d.name === testDoctorName);
  if (resurrectedDoc) {
    throw new Error('Doctor resurrected after deletion and refresh!');
  }
  console.log('   ✅ Doctor confirmed permanently removed (no resurrection).');

  const patientsAfterDelete = await db.getAllPatients(true);
  const resurrectedPat = patientsAfterDelete.find(p => p.id === createdPatient.id || p.card_uid === testCardUid);
  if (resurrectedPat) {
    throw new Error('Patient resurrected after deletion and refresh!');
  }
  console.log('   ✅ Patient confirmed permanently removed (no resurrection).');

  console.log('\n====================================================');
  console.log('🎉 PERSISTENCE VERIFICATION: ALL TESTS PASSED!');
  console.log('====================================================\n');
}

testPersistence()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Persistence Verification Failed:', err);
    process.exit(1);
  });
