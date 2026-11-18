/**
 * Verification Script: Patient Email & WhatsApp Notification Dispatch
 * Validates Requirement R2:
 * - HTML email template rendering
 * - PDF medical summary and prescription generation
 * - Nodemailer transport execution
 * - Error resilience with clean credentials
 */

require('dotenv').config();
const notifications = require('../notifications.js');

async function testNotifications() {
  console.log('====================================================');
  console.log('🧪 VERIFYING NOTIFICATION DISPATCH (EMAIL & PDF)');
  console.log('====================================================\n');

  const testPatient = {
    id: 999,
    card_uid: 'CARD_NOTIF_TEST',
    first_name: 'Alex',
    last_name: 'Johnson',
    age: 29,
    gender: 'Non-binary',
    blood_group: 'B+',
    contact_email: process.env.GMAIL_USER || 'alex.johnson.test@example.com',
    contact_phone: '+1 555-0188',
    allergies: 'Latex'
  };

  const testVisit = {
    id: 888,
    doctor_name: 'Dr. Sarah Connor',
    department: 'General Medicine',
    diagnosis: 'Acute seasonal allergic rhinitis',
    symptoms: 'Sneezing, nasal congestion, watery eyes',
    vitals: JSON.stringify({ blood_pressure: '120/80', temperature: '98.6', heart_rate: '72' }),
    notes: 'Prescribed antihistamines and nasal spray; advised allergen avoidance.'
  };

  const testPrescriptions = [
    {
      medicine_name: 'Cetirizine 10mg',
      dosage: '1 tablet',
      frequency: 'Once daily at bedtime',
      duration: '14 days',
      instructions: 'Take with water after dinner'
    },
    {
      medicine_name: 'Fluticasone Nasal Spray',
      dosage: '2 sprays per nostril',
      frequency: 'Once daily in the morning',
      duration: '30 days',
      instructions: 'Blow nose gently before administering'
    }
  ];

  const testAppointment = {
    appointment_date: '2026-12-01',
    appointment_time: '10:30 AM',
    doctor_name: 'Dr. Sarah Connor',
    department: 'General Medicine',
    reason: 'Follow-up symptom evaluation'
  };

  // Step 1: Verify PDF Generation
  console.log('1. Testing PDF Generation...');
  const pdfBuffer = await notifications.generateMedicalSummaryPDF({
    patient: testPatient,
    doctorName: testVisit.doctor_name,
    department: testVisit.department,
    visit: testVisit,
    prescriptions: testPrescriptions,
    appointment: testAppointment
  });
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 1000) {
    throw new Error('PDF Generation failed or returned empty buffer');
  }
  console.log(`   ✅ PDF generated successfully (${pdfBuffer.length} bytes, starts with: ${pdfBuffer.slice(0, 5).toString()})`);

  // Step 2: Verify HTML Email Rendering
  console.log('\n2. Testing HTML Email Generation...');
  const html = notifications.generateEmailHTML({
    patient: testPatient,
    doctorName: testVisit.doctor_name,
    department: testVisit.department,
    visit: testVisit,
    prescriptions: testPrescriptions,
    appointment: testAppointment
  });
  if (!html.includes('Cetirizine') || !html.includes('Fluticasone') || !html.includes('CARD_NOTIF_TEST')) {
    throw new Error('HTML Email does not contain expected patient / prescription details');
  }
  console.log('   ✅ HTML Email rendered with complete clinical and prescription data.');

  // Step 3: Verify WhatsApp Message Rendering
  console.log('\n3. Testing WhatsApp Deep-link & Formatter...');
  const wa = notifications.generateWhatsAppMessage({
    patient: testPatient,
    doctorName: testVisit.doctor_name,
    department: testVisit.department,
    visit: testVisit,
    prescriptions: testPrescriptions,
    appointment: testAppointment
  });
  if (!wa.whatsappUrl || !wa.whatsappUrl.startsWith('https://api.whatsapp.com/send')) {
    throw new Error('WhatsApp URL was not formatted correctly');
  }
  console.log('   ✅ WhatsApp message formatted with deep-link.');

  // Step 4: Dispatch Email via sendPatientEmail
  console.log('\n4. Testing Email Dispatch via Transporter...');
  const dispatchResult = await notifications.sendPatientEmail({
    patient: testPatient,
    doctorName: testVisit.doctor_name,
    department: testVisit.department,
    visit: testVisit,
    prescriptions: testPrescriptions,
    appointment: testAppointment,
    targetEmail: testPatient.contact_email
  });

  if (!dispatchResult.success) {
    throw new Error('Email dispatch returned success: false');
  }
  console.log(`   ✅ Email dispatched successfully!`);
  console.log(`      Recipient: ${dispatchResult.recipient}`);
  console.log(`      Message ID: ${dispatchResult.messageId}`);
  console.log(`      PDF Attachment included: ${dispatchResult.hasPdfAttachment}`);

  console.log('\n====================================================');
  console.log('🎉 NOTIFICATION VERIFICATION: ALL TESTS PASSED!');
  console.log('====================================================\n');
}

testNotifications().catch(err => {
  console.error('\n❌ Notification Verification Failed:', err);
  process.exit(1);
});
