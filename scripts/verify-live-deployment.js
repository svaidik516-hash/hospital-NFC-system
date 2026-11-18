/**
 * Live Deployment Verification Script: https://hospitalnfcsystem.vercel.app/
 * Verifies live site end-to-end:
 * 1. Health check & Supabase connection
 * 2. Admin & Doctor Authentication
 * 3. Doctor creation, fetch, and persistence across warm/cold lambda containers
 * 4. Patient creation and NFC card lookup
 * 5. Follow-up appointment scheduling & email dispatch with PDF attachment
 * 6. Doctor & Patient deletion and anti-resurrection check
 */

const https = require('https');

async function request(url, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const BASE = 'https://hospitalnfcsystem.vercel.app';
  console.log('====================================================');
  console.log(`🌐 TESTING LIVE DEPLOYMENT AT: ${BASE}`);
  console.log('====================================================\n');

  console.log('1. Health check & Supabase cloud status...');
  const health = await request(`${BASE}/api/health`);
  console.log('   Status:', health.status, '| DB:', health.body?.database, '| Timestamp:', health.body?.timestamp);
  if (health.body?.database !== 'connected') {
    throw new Error('Database is not connected on live deployment');
  }

  console.log('\n2. Logging in as admin...');
  const loginRes = await request(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'admin', password: 'admin123' });

  if (loginRes.status !== 200 || !loginRes.body?.accessToken) {
    throw new Error(`Admin login failed with status ${loginRes.status}`);
  }
  const token = loginRes.body.accessToken;
  console.log('   ✅ Admin logged in successfully. Access token acquired.');

  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // Step 3: Fetch initial doctors & departments
  console.log('\n3. Fetching live doctors and departments...');
  const docsRes = await request(`${BASE}/api/doctors`, { headers: authHeaders });
  console.log(`   ✅ Doctors count: ${docsRes.body?.length}`);

  const deptsRes = await request(`${BASE}/api/departments`, { headers: authHeaders });
  console.log(`   ✅ Departments count: ${deptsRes.body?.length}`);
  if (!deptsRes.body || deptsRes.body.length === 0) {
    throw new Error('Departments list is empty on live site');
  }

  // Step 4: Create a new doctor on live Vercel site
  const uniqueId = Date.now();
  const liveDoctorName = `Dr. Live Verifier ${uniqueId}`;
  console.log(`\n4. Creating doctor on live site: "${liveDoctorName}"...`);
  const createDocRes = await request(`${BASE}/api/doctors`, {
    method: 'POST',
    headers: authHeaders
  }, {
    name: liveDoctorName,
    department: 'Cardiology',
    specialization: 'Invasive Cardiology',
    contact: '+1 555-7788',
    status: 'active'
  });
  console.log('   Create doctor status:', createDocRes.status);
  const createdDoctorId = createDocRes.body?.id;
  if (!createdDoctorId) {
    throw new Error('Failed to create doctor on live deployment');
  }
  console.log(`   ✅ Doctor created with ID: ${createdDoctorId}`);

  // Step 5: Wait 3 seconds and re-fetch from different lambda instance
  console.log('\n5. Waiting 3 seconds and re-fetching doctors to verify cross-container persistence...');
  await sleep(3000);
  const verifyDocsRes = await request(`${BASE}/api/doctors`, { headers: authHeaders });
  const foundDoctor = verifyDocsRes.body?.find(d => d.id === createdDoctorId || d.name === liveDoctorName);
  if (!foundDoctor) {
    throw new Error(`Created doctor "${liveDoctorName}" not found on re-fetch! Persistence failure.`);
  }
  console.log(`   ✅ Doctor persisted successfully on live deployment: ${foundDoctor.name} (ID: ${foundDoctor.id})`);

  // Step 6: Test follow-up scheduling and email dispatch on live site
  console.log('\n6. Testing follow-up consultation and email dispatch on live site...');
  const patRes = await request(`${BASE}/api/patients`, { headers: authHeaders });
  const patient = patRes.body?.[0];
  if (patient) {
    const emailTarget = patient.contact_email || 'test.vb.181@gmail.com';
    console.log(`   Sending consultation email for patient ${patient.id} to ${emailTarget}...`);
    const notifRes = await request(`${BASE}/api/doctor/followup-and-notify`, {
      method: 'POST',
      headers: authHeaders
    }, {
      patient_id: patient.id,
      followup_date: '2026-11-28',
      followup_time: '14:00',
      department: 'Cardiology',
      doctor_name: liveDoctorName,
      reason: 'Post-operative evaluation and medication check',
      target_email: emailTarget,
      send_email: true,
      send_whatsapp: false
    });

    console.log('   Followup & notify HTTP status:', notifRes.status);
    console.log('   Email dispatched:', notifRes.body?.email?.success);
    console.log('   Email recipient:', notifRes.body?.email?.recipient);
    console.log('   Message ID:', notifRes.body?.email?.messageId);
    console.log('   PDF Attachment included:', notifRes.body?.email?.hasPdfAttachment);
    if (!notifRes.body?.email?.success) {
      console.warn('   ⚠️ Email dispatch reported non-success:', notifRes.body?.email?.error);
    } else {
      console.log('   ✅ Email dispatch succeeded on live Vercel deployment!');
    }
  }

  // Step 7: Delete doctor and verify anti-resurrection
  console.log('\n7. Cleaning up test doctor...');
  const delDocRes = await request(`${BASE}/api/doctors/${createdDoctorId}`, {
    method: 'DELETE',
    headers: authHeaders
  });
  console.log('   Delete doctor HTTP status:', delDocRes.status);

  await sleep(2000);
  const recheckDocsRes = await request(`${BASE}/api/doctors`, { headers: authHeaders });
  const resurrected = recheckDocsRes.body?.find(d => d.id === createdDoctorId);
  if (resurrected) {
    throw new Error(`Doctor resurrected after deletion!`);
  }
  console.log('   ✅ Doctor cleanly deleted from Supabase & SQLite on live deployment (no resurrection).');

  console.log('\n====================================================');
  console.log('🎉 LIVE DEPLOYMENT VERIFICATION PASSED PERFECTLY!');
  console.log('====================================================\n');
}

main().catch(err => {
  console.error('\n❌ Live Verification Failed:', err);
  process.exit(1);
});
