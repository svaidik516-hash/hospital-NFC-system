/**
 * Notification Service for MediScan NFC Hospital System
 * Handles generating and sending:
 * 1. Rich HTML Medical & Prescription Summaries with Follow-up Appointment via Email
 * 2. Formatted Messages & Click-to-Chat Deep-links via WhatsApp
 */

require('dotenv').config();
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

// ── Email Transporter ──────────────────────────────────────────────────────────
// Defaults to Gmail if GMAIL_USER & GMAIL_APP_PASSWORD are provided,
// or custom SMTP, or local direct simulation transporter.
let transporter = null;
let currentTransporterType = null;

function resetTransporter() {
  transporter = null;
  currentTransporterType = null;
}

async function getTransporter() {
  const hasGmail = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER);

  // If transporter was initialized as jsonTransport simulation but real credentials are now present, re-init
  if (transporter && currentTransporterType === 'preview' && (hasGmail || hasSmtp)) {
    transporter = null;
  }

  if (transporter) return transporter;

  // 1. Gmail service (recommended for ease of setup)
  if (hasGmail) {
    const cleanPass = (process.env.GMAIL_APP_PASSWORD || '').replace(/["'\s\r\n]/g, '');
    const cleanUser = (process.env.GMAIL_USER || '').trim().toLowerCase();
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: cleanUser,
        pass: cleanPass,
      },
      connectionTimeout: 8000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
    currentTransporterType = 'gmail';
    console.log(`[Notification Service] Configured Gmail transporter for: ${cleanUser}`);
  }
  // 2. Custom SMTP provider (SendGrid, Mailgun, AWS SES, etc.)
  else if (hasSmtp) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 8000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
    currentTransporterType = 'smtp';
    console.log(`[Notification Service] Configured SMTP transporter for: ${process.env.SMTP_HOST}`);
  }
  // 3. Simulated direct JSON transport (for local testing & preview without credentials)
  else {
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
    currentTransporterType = 'preview';
    console.log('[Notification Service] Using local preview transporter (configure .env for live email delivery)');
  }
  return transporter;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return 'Not scheduled';
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    const [y, m, d] = dateStr.trim().split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return dateObj.toLocaleDateString('en-US', {
      timeZone: 'UTC',
      weekday: 'long', year: 'numeric', month: 'short', day: 'numeric'
    });
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'short', day: 'numeric'
  });
}

function cleanPhoneNumber(phone) {
  if (!phone) return '';
  // Remove non-numeric characters except +
  let cleaned = phone.replace(/[^0-9]/g, '');
  // Default country code 1 if 10 digits
  if (cleaned.length === 10) cleaned = '1' + cleaned;
  return cleaned;
}

// ── HTML Email Template Generator ─────────────────────────────────────────────

function generateEmailHTML({ patient, doctorName, department, visit, prescriptions, appointment }) {
  const prescriptionsHTML = (prescriptions && prescriptions.length > 0)
    ? prescriptions.map((p, idx) => `
        <tr style="border-bottom: 1px solid #E2E8F0;">
          <td style="padding: 12px 14px; font-weight: 600; color: #1E293B;">
            ${idx + 1}. ${p.medicine_name}
          </td>
          <td style="padding: 12px 14px; color: #475569;">${p.dosage || 'Standard'}</td>
          <td style="padding: 12px 14px; color: #475569;">${p.frequency || 'As directed'}</td>
          <td style="padding: 12px 14px; color: #475569;">${p.duration || '—'}</td>
          <td style="padding: 12px 14px; color: #0284C7;">${p.instructions || 'Follow doctor directions'}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="5" style="padding: 16px; text-align: center; color: #94A3B8;">No medicines prescribed for this visit.</td></tr>`;

  let vitalsHTML = 'None recorded';
  if (visit && visit.vitals) {
    try {
      const v = typeof visit.vitals === 'string' ? JSON.parse(visit.vitals) : visit.vitals;
      const parts = [];
      if (v.blood_pressure) parts.push(`<strong>BP:</strong> ${v.blood_pressure} mmHg`);
      if (v.temperature) parts.push(`<strong>Temp:</strong> ${v.temperature} °F`);
      if (v.heart_rate) parts.push(`<strong>HR:</strong> ${v.heart_rate} bpm`);
      if (v.spo2) parts.push(`<strong>SpO2:</strong> ${v.spo2}%`);
      if (v.weight) parts.push(`<strong>Weight:</strong> ${v.weight} kg`);
      if (parts.length > 0) vitalsHTML = parts.join(' &bull; ');
    } catch (e) {
      vitalsHTML = visit.vitals;
    }
  }

  const appointmentBox = appointment ? `
    <div style="background: linear-gradient(135deg, #0077B6, #00B4D8); color: #FFFFFF; border-radius: 12px; padding: 22px; margin-top: 24px; box-shadow: 0 6px 18px rgba(0, 119, 182, 0.25);">
      <div style="display: flex; align-items: center; gap: 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.9;">
        📅 Scheduled Follow-Up Appointment
      </div>
      <h2 style="margin: 8px 0 12px; font-size: 22px; font-weight: 700;">
        ${formatDate(appointment.appointment_date)} at ${appointment.appointment_time || '10:00 AM'}
      </h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 14px; opacity: 0.95;">
        <div><strong>Doctor:</strong> ${appointment.doctor_name || doctorName || 'Attending Physician'}</div>
        <div><strong>Department:</strong> ${appointment.department || department || 'General Medicine'}</div>
        <div style="grid-column: 1 / -1; margin-top: 4px;"><strong>Reason / Notes:</strong> ${appointment.reason || 'Follow-up consultation'}</div>
      </div>
      <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.25); font-size: 13px;">
        💡 <em>Please tap your NFC Card (<strong>${patient.card_uid}</strong>) on the reception kiosk when you arrive to auto check-in.</em>
      </div>
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Medical Summary & Follow-up Appointment</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; margin: 0; padding: 24px; color: #1E293B;">
  <div style="max-width: 680px; margin: 0 auto; background: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #E2E8F0;">
    
    <!-- Header -->
    <div style="background: #005A8D; padding: 28px; color: #FFFFFF;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">🏥 MediScan NFC Hospital</h1>
            <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.85;">Digital Patient Care & Electronic Health Record</p>
          </td>
          <td align="right">
            <span style="font-family: monospace; font-size: 13px; font-weight: 700; background: rgba(255,255,255,0.18); padding: 6px 12px; border-radius: 6px;">
              💳 ${patient.card_uid}
            </span>
          </td>
        </tr>
      </table>
    </div>

    <!-- Patient Banner -->
    <div style="padding: 24px; border-bottom: 1px solid #E2E8F0; background: #F1F5F9;">
      <table width="100%">
        <tr>
          <td>
            <h2 style="margin: 0; font-size: 20px; color: #0F172A;">${patient.first_name} ${patient.last_name}</h2>
            <p style="margin: 4px 0 0; font-size: 14px; color: #64748B;">
              Age: ${patient.age || '—'} &bull; Gender: ${patient.gender || '—'} &bull; Blood Group: <strong>${patient.blood_group || '—'}</strong>
            </p>
          </td>
          <td align="right" style="font-size: 13px; color: #64748B;">
            Date: <strong>${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
          </td>
        </tr>
      </table>
    </div>

    <!-- Consultation Details -->
    <div style="padding: 24px;">
      <h3 style="margin-top: 0; font-size: 16px; color: #0077B6; text-transform: uppercase; letter-spacing: 0.5px;">
        👨‍⚕️ Consultation Summary
      </h3>
      <table width="100%" style="font-size: 14px; margin-bottom: 20px; line-height: 1.6;">
        <tr>
          <td width="30%" style="color: #64748B;">Attending Doctor:</td>
          <td><strong>${doctorName || (visit ? visit.doctor_name : 'Attending Physician')}</strong> (${department || (visit ? visit.department : 'General')})</td>
        </tr>
        <tr>
          <td style="color: #64748B;">Diagnosis:</td>
          <td><strong style="color: #0077B6;">${(visit && visit.diagnosis) ? visit.diagnosis : 'Routine clinical examination'}</strong></td>
        </tr>
        ${(visit && visit.symptoms) ? `
        <tr>
          <td style="color: #64748B;">Symptoms:</td>
          <td>${visit.symptoms}</td>
        </tr>` : ''}
        <tr>
          <td style="color: #64748B;">Recorded Vitals:</td>
          <td>${vitalsHTML}</td>
        </tr>
        ${(visit && visit.notes) ? `
        <tr>
          <td style="color: #64748B;">Clinical Notes:</td>
          <td>${visit.notes}</td>
        </tr>` : ''}
      </table>

      <!-- Prescriptions Table -->
      <h3 style="margin: 24px 0 12px; font-size: 16px; color: #0077B6; text-transform: uppercase; letter-spacing: 0.5px;">
        💊 Prescribed Medications
      </h3>
      <div style="border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden;">
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px; text-align: left; border-collapse: collapse;">
          <thead>
            <tr style="background: #F8FAFC; border-bottom: 2px solid #E2E8F0; color: #475569;">
              <th style="padding: 10px 14px;">Medicine</th>
              <th style="padding: 10px 14px;">Dosage</th>
              <th style="padding: 10px 14px;">Frequency</th>
              <th style="padding: 10px 14px;">Duration</th>
              <th style="padding: 10px 14px;">Instructions</th>
            </tr>
          </thead>
          <tbody>
            ${prescriptionsHTML}
          </tbody>
        </table>
      </div>

      <!-- Follow-up Appointment Box -->
      ${appointmentBox}

      <!-- Emergency & Contact Info -->
      <div style="margin-top: 32px; padding: 16px; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; font-size: 13px; color: #92400E;">
        <strong>⚠️ Need assistance or experiencing an emergency?</strong><br>
        Call the 24/7 Hospital Helpline at <strong>+1 (800) 555-0199</strong> or visit our Emergency Department immediately.
      </div>
    </div>

    <!-- Footer -->
    <div style="background: #F8FAFC; padding: 20px; text-align: center; font-size: 12px; color: #94A3B8; border-top: 1px solid #E2E8F0;">
      <p style="margin: 0;">MediScan NFC Hospital Management System &bull; Electronic Health Record</p>
      <p style="margin: 4px 0 0;">This email contains confidential medical information intended solely for ${patient.first_name} ${patient.last_name}.</p>
    </div>
  </div>
</body>
</html>
  `;
}

// ── WhatsApp Formatter & Deep-Link Generator ──────────────────────────────────

function generateWhatsAppMessage({ patient, doctorName, department, visit, prescriptions, appointment }) {
  const lines = [];

  lines.push(`🏥 *MediScan Hospital — Patient Medical Summary*`);
  lines.push(`Hello *${patient.first_name} ${patient.last_name}* (Card: \`${patient.card_uid}\`)`);
  lines.push(``);
  lines.push(`👨‍⚕️ *Doctor:* ${doctorName || (visit ? visit.doctor_name : 'Attending Doctor')} (${department || (visit ? visit.department : 'General')})`);
  lines.push(`📋 *Diagnosis:* ${(visit && visit.diagnosis) ? visit.diagnosis : 'Clinical Consultation'}`);

  if (visit && visit.vitals) {
    try {
      const v = typeof visit.vitals === 'string' ? JSON.parse(visit.vitals) : visit.vitals;
      const vArr = [];
      if (v.blood_pressure) vArr.push(`BP: ${v.blood_pressure}`);
      if (v.heart_rate) vArr.push(`HR: ${v.heart_rate} bpm`);
      if (v.temperature) vArr.push(`Temp: ${v.temperature}°F`);
      if (vArr.length > 0) lines.push(`🩺 *Vitals:* ${vArr.join(' | ')}`);
    } catch(e) {}
  }

  if (prescriptions && prescriptions.length > 0) {
    lines.push(``);
    lines.push(`💊 *Prescribed Medicines:*`);
    prescriptions.forEach((p, i) => {
      lines.push(`${i + 1}. *${p.medicine_name}* ${p.dosage ? `(${p.dosage})` : ''}`);
      lines.push(`   • ${p.frequency || 'As directed'} for ${p.duration || 'prescribed duration'}`);
      if (p.instructions) lines.push(`   • Instructions: ${p.instructions}`);
    });
  }

  if (appointment) {
    lines.push(``);
    lines.push(`📅 *Your Next Follow-up Appointment:*`);
    lines.push(`• Date: *${formatDate(appointment.appointment_date)}*`);
    lines.push(`• Time: *${appointment.appointment_time || '10:00 AM'}*`);
    lines.push(`• Doctor: ${appointment.doctor_name || doctorName || 'Physician'}`);
    lines.push(`• Department: ${appointment.department || department || 'General'}`);
    if (appointment.reason) lines.push(`• Note: ${appointment.reason}`);
    lines.push(``);
    lines.push(`💡 *Tip:* Please tap your NFC Card on the reception reader upon arrival.`);
  }

  lines.push(``);
  lines.push(`📞 24/7 Helpline: +1 (800) 555-0199`);
  lines.push(`_Thank you for choosing MediScan NFC Hospital._`);

  const fullText = lines.join('\n');
  const cleanPhone = cleanPhoneNumber(patient.contact_phone);
  const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(fullText)}`;

  return {
    text: fullText,
    whatsappUrl,
    cleanPhone,
  };
}

// ── Medical Summary PDF Generator ────────────────────────────────────────────

function generateMedicalSummaryPDF({ patient, doctorName, department, visit, prescriptions, appointment, hospitalPhone, senderEmail }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const primaryColor = '#0077B6';
      const darkColor = '#0F172A';
      const grayColor = '#475569';
      const lightGray = '#F8FAFC';
      const alertColor = '#DC2626';

      // Header Banner
      doc.rect(40, 40, 515, 60).fill('#005A8D');
      doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold').text('MEDISCAN NFC HOSPITAL', 55, 52);
      doc.fontSize(9).font('Helvetica').text('Digital Electronic Health Record & Medical Prescription', 55, 75);
      doc.fontSize(10).font('Helvetica-Bold').text(`CARD: ${patient.card_uid}`, 380, 55, { align: 'right', width: 160 });
      doc.fontSize(8).font('Helvetica').text(`Date: ${new Date().toLocaleDateString('en-US')}`, 380, 75, { align: 'right', width: 160 });

      // Patient Demographics Box
      doc.rect(40, 110, 515, 62).fill(lightGray).stroke('#CBD5E1');
      doc.fillColor(darkColor).fontSize(14).font('Helvetica-Bold').text(`${patient.first_name} ${patient.last_name}`, 55, 120);
      doc.fontSize(9).font('Helvetica').fillColor(grayColor)
        .text(`Age: ${patient.age || '—'}  |  Gender: ${patient.gender || '—'}  |  Blood Group: ${patient.blood_group || '—'}`, 55, 138)
        .text(`Phone: ${patient.contact_phone || '—'}  |  Email: ${patient.contact_email || '—'}`, 55, 152);

      let currentY = 182;

      // Allergy Alert if present
      if (patient.allergies && patient.allergies.trim()) {
        doc.rect(40, currentY, 515, 24).fill('#FEF2F2').stroke('#FCA5A5');
        doc.fillColor(alertColor).fontSize(9).font('Helvetica-Bold')
          .text(`CRITICAL ALLERGIES: ${patient.allergies}`, 50, currentY + 7);
        currentY += 32;
      }

      // Attending Physician & Diagnosis
      doc.fillColor(primaryColor).fontSize(10.5).font('Helvetica-Bold').text('CLINICAL CONSULTATION & DIAGNOSIS', 40, currentY);
      currentY += 15;
      doc.rect(40, currentY, 515, 42).fill('#FFFFFF').stroke('#E2E8F0');
      doc.fillColor(darkColor).fontSize(9).font('Helvetica-Bold')
        .text('Attending Physician: ', 50, currentY + 8, { continued: true })
        .font('Helvetica').text(`${doctorName || (visit && visit.doctor_name) || 'Attending Physician'} (${department || 'General Medicine'})`)
        .font('Helvetica-Bold').text('Clinical Diagnosis: ', 50, currentY + 22, { continued: true })
        .font('Helvetica').text(`${(visit && visit.diagnosis) || 'Routine Clinical Consultation'}`);
      currentY += 52;

      // Vitals if present
      if (visit && visit.vitals) {
        let vObj = {};
        try { vObj = typeof visit.vitals === 'string' ? JSON.parse(visit.vitals) : visit.vitals; } catch(e){}
        const vitalsList = [];
        if (vObj.blood_pressure) vitalsList.push(`BP: ${vObj.blood_pressure} mmHg`);
        if (vObj.heart_rate) vitalsList.push(`Heart Rate: ${vObj.heart_rate} bpm`);
        if (vObj.temperature) vitalsList.push(`Temp: ${vObj.temperature} °F`);
        if (vObj.spo2) vitalsList.push(`SpO2: ${vObj.spo2}%`);
        if (vObj.weight) vitalsList.push(`Weight: ${vObj.weight} kg`);

        if (vitalsList.length > 0) {
          doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text('OBJECTIVE VITALS & MEASUREMENTS', 40, currentY);
          currentY += 14;
          doc.rect(40, currentY, 515, 22).fill(lightGray).stroke('#E2E8F0');
          doc.fillColor(grayColor).fontSize(8.5).font('Helvetica').text(vitalsList.join('   |   '), 50, currentY + 6);
          currentY += 32;
        }
      }

      // Prescriptions Table
      doc.fillColor(primaryColor).fontSize(10.5).font('Helvetica-Bold').text('PRESCRIBED MEDICATIONS', 40, currentY);
      currentY += 15;

      // Table Header
      doc.rect(40, currentY, 515, 20).fill('#0077B6');
      doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold');
      doc.text('#', 48, currentY + 6);
      doc.text('Medicine Name', 68, currentY + 6);
      doc.text('Dosage', 210, currentY + 6);
      doc.text('Frequency', 280, currentY + 6);
      doc.text('Duration', 360, currentY + 6);
      doc.text('Instructions', 430, currentY + 6);
      currentY += 20;

      if (prescriptions && prescriptions.length > 0) {
        prescriptions.forEach((rx, idx) => {
          const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
          doc.rect(40, currentY, 515, 22).fill(bg).stroke('#E2E8F0');
          doc.fillColor(darkColor).fontSize(8).font('Helvetica');
          doc.text(`${idx + 1}`, 48, currentY + 6);
          doc.font('Helvetica-Bold').text(rx.medicine_name, 68, currentY + 6, { width: 135 });
          doc.font('Helvetica').text(rx.dosage || 'Standard', 210, currentY + 6);
          doc.text(rx.frequency || 'As directed', 280, currentY + 6);
          doc.text(rx.duration || '—', 360, currentY + 6);
          doc.fillColor('#0284C7').text(rx.instructions || 'Follow directions', 430, currentY + 6, { width: 120 });
          currentY += 22;
        });
      } else {
        doc.rect(40, currentY, 515, 22).fill('#FFFFFF').stroke('#E2E8F0');
        doc.fillColor(grayColor).fontSize(8.5).font('Helvetica').text('No medications prescribed during this visit.', 50, currentY + 6);
        currentY += 22;
      }
      currentY += 15;

      // Follow-up Appointment Box (if present)
      if (appointment) {
        doc.rect(40, currentY, 515, 45).fill('#F0F9FF').stroke('#BAE6FD');
        doc.fillColor(primaryColor).fontSize(9.5).font('Helvetica-Bold').text('NEXT FOLLOW-UP APPOINTMENT', 50, currentY + 7);
        doc.fillColor(darkColor).fontSize(8.5).font('Helvetica')
          .text(`Date: ${appointment.appointment_date} at ${appointment.appointment_time || '10:00 AM'}`, 50, currentY + 20)
          .text(`Consultant: ${appointment.doctor_name || doctorName || 'Physician'} (${appointment.department || department || 'General'})`, 50, currentY + 31);
        currentY += 55;
      }

      // Footer Notes & Signature Area
      const footerY = 740;
      doc.strokeColor('#CBD5E1').lineWidth(0.5).moveTo(40, footerY).lineTo(555, footerY).stroke();
      doc.fillColor(grayColor).fontSize(7.5).font('Helvetica')
        .text(`Helpline: ${hospitalPhone || process.env.HOSPITAL_PHONE || '+1 (555) 234-5678'}  |  Email: ${senderEmail || process.env.GMAIL_USER || 'info@mediscan-nfc.hospital'}`, 40, footerY + 8)
        .text('Official digital EHR & e-prescription issued by MediScan NFC Hospital System.', 40, footerY + 18);

      doc.fillColor(darkColor).fontSize(8.5).font('Helvetica-Bold').text('Authorized Physician Signature', 390, footerY + 8, { align: 'right', width: 160 });
      doc.font('Helvetica').fontSize(8).text(doctorName || 'Attending Physician', 390, footerY + 20, { align: 'right', width: 160 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Main Dispatch Functions ───────────────────────────────────────────────────

async function sendPatientEmail({ patient, doctorName, department, visit, prescriptions, appointment, targetEmail }) {
  const toEmail = (targetEmail || patient.contact_email || '').trim();
  if (!toEmail) {
    throw new Error('No email address available for patient');
  }

  const senderEmail = process.env.GMAIL_USER || process.env.SMTP_USER || 'noreply@mediscan-nfc.hospital';
  const hospitalName = process.env.HOSPITAL_NAME || 'MediScan Hospital';
  const hospitalPhone = process.env.HOSPITAL_PHONE || '+1 (555) 234-5678';

  const htmlContent = generateEmailHTML({ patient, doctorName, department, visit, prescriptions, appointment });
  const subject = `${hospitalName}: Prescription & Medical Summary (${patient.card_uid})`;

  // Generate official PDF attachment
  let pdfBuffer = null;
  try {
    pdfBuffer = await generateMedicalSummaryPDF({
      patient,
      doctorName,
      department,
      visit,
      prescriptions,
      appointment,
      hospitalPhone,
      senderEmail
    });
  } catch (pdfErr) {
    console.warn('[PDF Generator] Could not build PDF attachment:', pdfErr.message);
  }

  const mailOptions = {
    from: `"${hospitalName}" <${senderEmail}>`,
    to: toEmail,
    subject,
    html: htmlContent,
  };

  if (pdfBuffer) {
    mailOptions.attachments = [
      {
        filename: `Medical_Summary_${patient.card_uid}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }
    ];
  }

  const mailTransporter = await getTransporter();
  const info = await mailTransporter.sendMail(mailOptions);

  return {
    success: true,
    messageId: info.messageId,
    recipient: toEmail,
    subject,
    htmlContent,
    hasPdfAttachment: !!pdfBuffer,
  };
}

async function sendPatientWhatsApp({ patient, doctorName, department, visit, prescriptions, appointment, targetPhone }) {
  const phone = targetPhone || patient.contact_phone;
  const { text, whatsappUrl, cleanPhone } = generateWhatsAppMessage({
    patient, doctorName, department, visit, prescriptions, appointment
  });

  return {
    success: true,
    recipient: phone,
    cleanPhone,
    text,
    whatsappUrl,
    sentAt: new Date().toISOString(),
  };
}

module.exports = {
  getTransporter,
  resetTransporter,
  sendPatientEmail,
  sendPatientWhatsApp,
  generateEmailHTML,
  generateWhatsAppMessage,
  generateMedicalSummaryPDF,
};

