# MediScan NFC — Hospital Patient Management System (`hospital-NFC-system`)

A full-stack, contactless healthcare patient management system powered by **NFC (Near Field Communication)** smart cards and local SQLite database storage.

---

## 🌟 Key Features

1. **🏥 Reception Kiosk (`/reception.html`)**
   - **Contactless Tap**: When a patient arrives, they tap their NFC card on the reception device or USB reader.
   - **Automatic Arrival Verification**: Checks for today's appointment, marks status as **Arrived**, updates the queue, and creates/links an active hospital visit.
   - **Safety Alerts**: Prominently highlights critical patient allergies (e.g. Penicillin, Peanuts, Sulfa) in an emergency banner upon tap.
   - **Live Queue**: Real-time waiting list for receptionists showing appointment time, patient name, doctor, and arrival status.
   - **Walk-in Support**: Automatically creates a walk-in consultation if the patient doesn't have a pre-scheduled appointment.

2. **👨‍⚕️ Doctor Dashboard (`/doctor.html`)**
   - **One-Tap Patient File**: Doctor places the card on their desk reader -> complete medical history instantly loads on screen.
   - **Complete Medical Dossier**: Shows age, gender, blood group, emergency contacts, chronic conditions, and previous visits.
   - **Prescription & Medication History**: Full history of all past prescriptions and medications.
   - **Live Consultation**:
     - Record & Save Vitals (Blood Pressure, Heart Rate, Temp, SpO2, Weight).
     - Enter Clinical Symptoms, Diagnosis, and Notes.
     - Add and submit new prescriptions directly saved to the patient file.
     - Review past lab reports and record new test results.
   - **Checkout**: Discharges the patient with timestamped check-out.

3. **📩 Follow-up Appointments & Multi-Channel Transmission (Email & WhatsApp)**
   - **Next Appointment Scheduling**: In the Doctor Dashboard, the physician can set a follow-up appointment date (with one-click pills: `+1 Week`, `+2 Weeks`, `+1 Month`, `+3 Months`), time, department, and instructions.
   - **Full Email Medical Dossier**: Automatically formats and dispatches a branded HTML email to the patient with:
     - Consultation summary (Doctor, Department, Diagnosis, Vitals, Notes).
     - Full table of all prescribed medications (dosages, frequencies, durations, instructions).
     - Prominent highlighted banner with their next appointment date, time, and instructions to bring their NFC card.
     - 24/7 Hospital helpline & emergency assistance contact.
     - Interactive in-app viewer to preview the exact rendered HTML email.
   - **WhatsApp Instant Transmission**:
     - Automatically generates a formatted WhatsApp message with bold formatting, emojis, bulleted prescriptions, and next appointment details.
     - Creates a direct click-to-chat deep-link (`https://api.whatsapp.com/send?phone=...&text=...`) to open directly in WhatsApp Web or mobile app.
   - **Persistent Notification Logs**: All emails and WhatsApp dispatches are recorded in the local SQLite `notifications` table.

4. **📋 Admin Panel (`/admin.html`)**
   - **Patient Registration**: Issues and assigns unique NFC card UIDs (e.g., `NFC-CARD-001`, `NFC-4F2A109B`).
   - **Card Summary Preview**: Generates an interactive digital preview of the NFC card issued to the patient.
   - **Patient Directory**: Searchable list by patient name, phone number, or card UID.
   - **Appointment Scheduling**: Schedule visits by department, date, time, and doctor.
   - **Doctor Management**: Add and manage hospital physicians and medical departments.

4. **📊 Real-time Dashboard (`/index.html`)**
   - Live hospital statistics: Total Registered Patients, Today's Appointments, Today's Arrivals, and Active Visits.
   - Quick launch cards to Reception, Doctor Desk, and Administration.

---

## 🚀 How to Run the Software

### 1. Start the Server
Open terminal in `c:\Desktop\proj` and run:
```bash
npm start
```
The server will start on: **`http://localhost:3000`**

### 2. Access the Portals
- **Hospital Home / Dashboard**: [http://localhost:3000/index.html](http://localhost:3000/index.html)
- **Reception Kiosk**: [http://localhost:3000/reception.html](http://localhost:3000/reception.html)
- **Doctor Consultation**: [http://localhost:3000/doctor.html](http://localhost:3000/doctor.html)
- **Admin & Registration**: [http://localhost:3000/admin.html](http://localhost:3000/admin.html)

---

## 💳 Pre-loaded Test NFC Cards

The system automatically initializes test patient cards with realistic medical histories:

| NFC Card UID | Patient Name | Department | Today's Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **`NFC-CARD-001`** | **Johnathan Vance** | Cardiology (Dr. Sarah Johnson) | Scheduled (10:00 AM) | Severe Penicillin Allergy, Hypertension history |
| **`NFC-CARD-002`** | **Eleanor Rigby** | General Medicine (Dr. Michael Chen) | Scheduled (11:30 AM) | Asthma, Sulfa Drug Allergy |
| **`NFC-CARD-003`** | **David Miller** | General Medicine (Dr. Michael Chen) | Scheduled (02:00 PM) | Type 2 Diabetes, Routine checkup |

*(You can either use the **Quick Test Tap** buttons on the screen or type any of the Card UIDs into the input field to simulate an NFC tap).*

---

## 📡 Hardware & NFC Reader Compatibility

The software is built with hybrid NFC detection:
1. **Physical NFC Card Readers (USB/ACR122U/HID)**: Most USB desktop NFC readers act as keyboard emulation (HID wedge) or PC/SC devices. They automatically type the card's UID directly into the input field.
2. **Web NFC API**: Native Android Chrome and supported browser devices communicate with NFC tags directly via the Web NFC standard (`NDEFReader`).
3. **Manual / Barcode / Simulation**: Allows manual typing, 2D QR/Barcode scanner input, or one-click simulation buttons.

---

## 🛠️ Technology Stack
- **Backend**: Node.js & Express
- **Database**: Local SQLite via `sql.js` (stored at `data/hospital.db`)
- **Frontend**: Vanilla JavaScript (ES6+), Semantic HTML5, CSS3 Variables Design System, FontAwesome Icons.

