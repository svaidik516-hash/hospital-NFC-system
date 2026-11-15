# MediScan NFC — System Architecture, Data Flow & Functional Diagrams

This document outlines the **Data Flow Diagrams (DFD Level 0 and Level 1)**, **Functional Architecture**, **Sequence of Operations**, and **Database Entity Relationships** for the MediScan NFC Hospital Patient Management System.

---

## 1. Data Flow Diagram (DFD)

### 1.1 DFD Level 0 — Context Diagram
Shows the high-level boundary of the entire system, external entities, and primary data exchanges.

```mermaid
flowchart TD
    %% External Entities
    Patient(["👤 Patient"])
    Receptionist(["👩‍💼 Receptionist"])
    Doctor(["👨‍⚕️ Attending Physician"])
    Admin(["🔐 Hospital Admin"])
    EmailService(["✉️ Email Service (SMTP / Nodemailer)"])
    WhatsAppGateway(["💬 WhatsApp Click-to-Chat / Gateway"])

    %% Core System
    MediScanCore[["🏥 MediScan NFC Hospital System\n(Express.js + Local SQLite Engine)"]]

    %% Data Flows
    Admin -->|"Patient demographics, NFC Card UID, Doctor profiles"| MediScanCore
    MediScanCore -->|"Issued NFC Smart Card preview, Registered directory"| Admin

    Patient -->|"Taps physical NFC card (UID transmission)"| MediScanCore
    MediScanCore -->|"Check-in confirmation, Waiting queue position"| Patient

    Receptionist -->|"Manual UID override, Queue management"| MediScanCore
    MediScanCore -->|"Real-time queue list, Allergy alerts, Appointment status"| Receptionist

    Doctor -->|"NFC Card scan, Vitals, Diagnosis, Prescriptions, Follow-up"| MediScanCore
    MediScanCore -->|"Full EHR dossier, Past visits, Prescriptions, Lab history"| Doctor

    MediScanCore -->|"HTML digital medical summary & follow-up receipt"| EmailService
    EmailService -->|"Delivered email to patient inbox"| Patient

    MediScanCore -->|"Formatted medical summary & next appointment link"| WhatsAppGateway
    WhatsAppGateway -->|"Delivered message to patient mobile"| Patient
```

---

### 1.2 DFD Level 1 — Detailed Process Data Flow
Illustrates data movement between internal processes and SQLite database tables.

```mermaid
flowchart LR
    %% External Entities
    E_Admin(["Admin"])
    E_Patient(["Patient / Card"])
    E_Reception(["Reception"])
    E_Doctor(["Doctor"])
    E_Email(["Email"])
    E_WA(["WhatsApp"])

    %% Processes
    P1["P1.0\nPatient Enrollment\n& NFC Assignment"]
    P2["P2.0\nContactless Check-In\n& Queue Triage"]
    P3["P3.0\nEHR Dossier\nRetrieval"]
    P4["P4.0\nConsultation, Vitals\n& E-Prescribing"]
    P5["P5.0\nFollow-Up Booking\n& Dispatch Engine"]

    %% Data Stores (Tables)
    D1[("D1: patients")]
    D2[("D2: appointments")]
    D3[("D3: visits")]
    D4[("D4: prescriptions")]
    D5[("D5: lab_reports")]
    D6[("D6: notifications")]

    %% Flows for P1.0
    E_Admin -->|"Name, DOB, Allergies, Card UID"| P1
    P1 -->|"Store new patient record"| D1
    P1 -->|"Pre-book scheduled visit"| D2

    %% Flows for P2.0
    E_Patient -.->|"NFC Card Tap (UID)"| P2
    E_Reception -->|"Manual UID Input"| P2
    P2 <-->|"Validate Card UID"| D1
    P2 <-->|"Query today's appointment"| D2
    P2 -->|"Update appointment status to 'arrived'"| D2
    P2 -->|"Create active visit (status='checked_in')"| D3
    P2 -->|"Display verified arrival & allergy banner"| E_Reception

    %% Flows for P3.0
    E_Doctor -->|"Scan Card UID at Doctor Desk"| P3
    P3 <-->|"Fetch patient profile"| D1
    P3 <-->|"Fetch longitudinal visits"| D3
    P3 <-->|"Fetch previous medications"| D4
    P3 <-->|"Fetch pathology results"| D5
    P3 -->|"Render 7-section clinical dossier"| E_Doctor

    %% Flows for P4.0
    E_Doctor -->|"Input BP, Temp, HR, SpO2, Weight"| P4
    E_Doctor -->|"Input Diagnosis & Progress Notes"| P4
    E_Doctor -->|"Add Prescriptions (Dosage, Frequency)"| P4
    P4 -->|"Update visit vitals & diagnosis"| D3
    P4 -->|"Commit prescribed medications"| D4

    %% Flows for P5.0
    E_Doctor -->|"Set next appointment date & trigger notify"| P5
    P5 -->|"Create follow-up appointment"| D2
    P5 <-->|"Gather patient email, phone, visit summary"| D1
    P5 <-->|"Gather committed prescriptions"| D4
    P5 -->|"Send HTML Medical Dossier"| E_Email
    P5 -->|"Send Formatted Summary Deep-Link"| E_WA
    P5 -->|"Log delivery audit record"| D6
```

---

## 2. Functional Block Diagram

Decomposes the system into its architectural layers, subsystems, and functional components:

```mermaid
flowchart TD
    subgraph PresentationLayer ["1. Presentation Layer (Client Browser UI)"]
        UI_Dash["Landing Dashboard\n(index.html / dashboard.js)"]
        UI_Rec["Reception Kiosk\n(reception.html / reception.js)"]
        UI_Doc["Doctor Workstation\n(doctor.html / doctor.js)"]
        UI_Admin["Admin Registry\n(admin.html / admin.js)"]
        UI_CSS["Enterprise Theme Engine\n(style.css Design System)"]
    end

    subgraph HardwareLayer ["2. Hardware Interfacing & Ingestion Layer"]
        NFC_Web["Web NFC API\n(NDEFReader / Tag Ingestion)"]
        NFC_HID["USB Desktop Reader\n(HID Keyboard Emulation)"]
        NFC_Sim["Simulation Badges\n(Quick-Tap Testing Chips)"]
    end

    subgraph APILayer ["3. Application & REST Routing Layer (server.js)"]
        API_Patient["/api/patients\n(CRUD, Search, Card Lookup)"]
        API_Checkin["/api/checkin\n(Arrival, Triage, Walk-in)"]
        API_Visits["/api/visits\n(Vitals, Notes, Checkout)"]
        API_Rx["/api/prescriptions\n(Medication Staging & Commit)"]
        API_Appt["/api/appointments\n(Queue, Schedules, Follow-ups)"]
        API_Notif["/api/doctor/followup-and-notify\n(Email & WhatsApp Dispatch)"]
    end

    subgraph ServiceLayer ["4. Business Logic & Notification Engine (notifications.js)"]
        SVC_Email["Nodemailer HTML Engine\n(Dossier Generator & SMTP Sender)"]
        SVC_WA["WhatsApp Deep-Link Formatter\n(Markdown & Click-to-Chat URL)"]
        SVC_Audit["Delivery Audit & Preview Engine\n(/api/notifications/view-email/:id)"]
    end

    subgraph DataLayer ["5. Persistence & Local Storage Engine (database.js)"]
        DB_Core["SQLite WASM Engine (sql.js)"]
        DB_Storage[("Local Binary Database File\ndata/hospital.db")]
        T_Patients["patients table"]
        T_Visits["visits table"]
        T_Prescriptions["prescriptions table"]
        T_Appointments["appointments table"]
        T_Doctors["doctors table"]
        T_Labs["lab_reports table"]
        T_Notifs["notifications table"]
    end

    %% Connections
    PresentationLayer <--> HardwareLayer
    PresentationLayer <--> APILayer
    APILayer <--> ServiceLayer
    APILayer <--> DataLayer
    DB_Core <--> DB_Storage
    DB_Core --- T_Patients
    DB_Core --- T_Visits
    DB_Core --- T_Prescriptions
    DB_Core --- T_Appointments
    DB_Core --- T_Doctors
    DB_Core --- T_Labs
    DB_Core --- T_Notifs
```

---

## 3. End-to-End Operational Sequence Diagram

Traces a patient's complete lifecycle: registration, arrival tap, consultation, e-prescribing, and multi-channel transmission.

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Hospital Admin
    actor Patient as Patient (with NFC Card)
    actor Receptionist as Receptionist
    actor Doctor as Doctor
    participant UI as Frontend Browser UI
    participant Server as Express Server (server.js)
    participant DB as SQLite DB (database.js)
    participant Notif as Notification Engine (notifications.js)

    %% 1. Registration
    Note over Admin, DB: PHASE 1: Patient Enrollment & Card Issuance
    Admin->>UI: Enter Demographics, Allergies & click "Generate NFC UID"
    UI->>Server: POST /api/patients {first_name, last_name, card_uid, allergies...}
    Server->>DB: createPatient(data)
    DB-->>Server: Return created patient record
    Server-->>UI: 201 Created & Digital Card preview
    Admin->>Patient: Hand over programmed NFC Smart Card

    %% 2. Reception Arrival
    Note over Patient, DB: PHASE 2: Contactless Arrival Check-in
    Patient->>UI: Taps NFC Card on Reception Reader (e.g. NFC-CARD-001)
    UI->>Server: POST /api/checkin {card_uid: "NFC-CARD-001"}
    Server->>DB: getPatientByCardUID(uid)
    Server->>DB: markArrival(patientId)
    DB->>DB: Update appointment status = 'arrived'
    DB->>DB: Create visit with status = 'checked_in'
    DB-->>Server: Return {patient, appointment, visit}
    Server-->>UI: 200 OK (Patient info + Allergy banner)
    UI-->>Receptionist: Display verified check-in & update Today's Queue

    %% 3. Doctor Consultation
    Note over Doctor, DB: PHASE 3: Physician Dossier Retrieval
    Doctor->>UI: Taps patient NFC card at Doctor Desk
    UI->>Server: GET /api/patients/card/NFC-CARD-001
    Server->>DB: getFullPatientRecord(uid)
    DB-->>Server: Patient + Past Visits + Prescriptions + Labs + Appointments
    Server-->>UI: 200 OK (Populate 7 clinical sections)
    UI-->>Doctor: Display full medical dossier & previous medications

    %% 4. Documentation & Prescriptions
    Note over Doctor, DB: PHASE 4: Clinical Examination & E-Prescribing
    Doctor->>UI: Input Vitals (BP, Temp, HR) & click "Save Vitals"
    UI->>Server: PUT /api/visits/:id {vitals: JSON}
    Server->>DB: updateVisit(id, data)
    Doctor->>UI: Input Diagnosis & Notes & click "Save Visit Info"
    UI->>Server: PUT /api/visits/:id {diagnosis, symptoms, notes}
    Server->>DB: updateVisit(id, data)
    Doctor->>UI: Stage Medicines (e.g. Amlodipine 5mg) & click "Finalize Prescriptions"
    UI->>Server: POST /api/prescriptions {visit_id, medicine_name, dosage...}
    Server->>DB: createPrescription(data)

    %% 5. Follow-up & Notifications
    Note over Doctor, Notif: PHASE 5: Follow-Up Scheduling & Multi-Channel Dispatch
    Doctor->>UI: Select follow-up (+1 Month) & click "Schedule & Send to Patient"
    UI->>Server: POST /api/doctor/followup-and-notify {followup_date, send_email, send_whatsapp...}
    Server->>DB: createAppointment({status: 'scheduled', appointment_date: '2026-12-15'...})
    
    par Email Dispatch
        Server->>Notif: sendPatientEmail({patient, visit, prescriptions, appointment})
        Notif->>Notif: Render branded HTML dossier
        Notif-->>Server: Email delivered
        Server->>DB: createNotification({channel: 'email', status: 'sent'})
    and WhatsApp Transmission
        Server->>Notif: sendPatientWhatsApp({patient, visit, prescriptions, appointment})
        Notif->>Notif: Format WhatsApp markdown & generate wa.me link
        Notif-->>Server: WhatsApp payload prepared
        Server->>DB: createNotification({channel: 'whatsapp', status: 'sent'})
    end

    Server-->>UI: 200 OK {success: true, email, whatsapp, appointment}
    UI-->>Doctor: Display green delivery verification & WhatsApp click-to-open link
    Doctor->>UI: Click "Complete Consultation & Discharge"
    UI->>Server: PUT /api/visits/:id {status: 'completed', check_out_time}
    Server->>DB: updateVisit(id, {status: 'completed'})
```

---

## 4. Database Entity-Relationship (ER) Diagram

Represents the relational schema within `data/hospital.db`:

```mermaid
erDiagram
    PATIENTS ||--o{ VISITS : "has"
    PATIENTS ||--o{ APPOINTMENTS : "books"
    PATIENTS ||--o{ PRESCRIPTIONS : "receives"
    PATIENTS ||--o{ LAB_REPORTS : "undergoes"
    PATIENTS ||--o{ NOTIFICATIONS : "receives"

    VISITS ||--o{ PRESCRIPTIONS : "contains"
    VISITS ||--o{ LAB_REPORTS : "orders"
    VISITS ||--o{ NOTIFICATIONS : "triggers"

    APPOINTMENTS ||--o{ NOTIFICATIONS : "notified_for"

    PATIENTS {
        INTEGER id PK "Auto Increment"
        TEXT card_uid UK "Unique NFC Chip ID"
        TEXT first_name "Required"
        TEXT last_name "Required"
        TEXT date_of_birth "YYYY-MM-DD"
        INTEGER age "Calculated"
        TEXT gender "Male / Female / Other"
        TEXT blood_group "A+, B+, O+, AB+, etc."
        TEXT contact_phone "Patient Mobile"
        TEXT contact_email "Patient Email"
        TEXT emergency_contact_name "Emergency Contact"
        TEXT emergency_contact_phone "Emergency Phone"
        TEXT emergency_contact_relation "Relation"
        TEXT address "Mailing Address"
        TEXT allergies "Penicillin, Peanuts, etc."
        TEXT chronic_conditions "Hypertension, Asthma, etc."
        TEXT insurance_id "Policy ID"
        TEXT registered_at "Timestamp"
        TEXT updated_at "Timestamp"
    }

    VISITS {
        INTEGER id PK "Auto Increment"
        INTEGER patient_id FK "References PATIENTS"
        TEXT visit_date "YYYY-MM-DD"
        TEXT check_in_time "Arrival Timestamp"
        TEXT check_out_time "Discharge Timestamp"
        TEXT department "Cardiology, General, etc."
        TEXT doctor_name "Attending Physician"
        TEXT diagnosis "Primary ICD Assessment"
        TEXT symptoms "Chief Complaints"
        TEXT vitals "JSON string (BP, Temp, HR, SpO2, Weight)"
        TEXT notes "Doctor Progress Notes"
        TEXT status "checked_in / in_progress / completed"
        TEXT created_at "Timestamp"
    }

    PRESCRIPTIONS {
        INTEGER id PK "Auto Increment"
        INTEGER visit_id FK "References VISITS"
        INTEGER patient_id FK "References PATIENTS"
        TEXT medicine_name "Drug Name"
        TEXT dosage "e.g. 5mg, 500mg"
        TEXT frequency "Once daily, BID, TID, etc."
        TEXT duration "e.g. 7 days, 30 days"
        TEXT instructions "e.g. Take after meals"
        TEXT prescribed_by "Doctor Name"
        TEXT prescribed_at "Timestamp"
    }

    APPOINTMENTS {
        INTEGER id PK "Auto Increment"
        INTEGER patient_id FK "References PATIENTS"
        TEXT appointment_date "YYYY-MM-DD"
        TEXT appointment_time "HH:MM"
        TEXT department "Specialty Department"
        TEXT doctor_name "Assigned Doctor"
        TEXT reason "Clinical Purpose"
        TEXT status "scheduled / arrived / completed / cancelled"
        TEXT arrived_at "Check-in Timestamp"
        TEXT created_at "Timestamp"
    }

    DOCTORS {
        INTEGER id PK "Auto Increment"
        TEXT name "Full Name"
        TEXT department "Department"
        TEXT specialization "Specialty"
        TEXT contact "Contact Info"
        TEXT status "active / inactive"
    }

    LAB_REPORTS {
        INTEGER id PK "Auto Increment"
        INTEGER patient_id FK "References PATIENTS"
        INTEGER visit_id FK "References VISITS"
        TEXT test_name "Test Name"
        TEXT result "Measured Value"
        TEXT normal_range "Reference Interval"
        TEXT status "pending / completed"
        TEXT notes "Pathologist Remarks"
        TEXT created_at "Timestamp"
    }

    NOTIFICATIONS {
        INTEGER id PK "Auto Increment"
        INTEGER patient_id FK "References PATIENTS"
        INTEGER visit_id FK "References VISITS"
        INTEGER appointment_id FK "References APPOINTMENTS"
        TEXT channel "email / whatsapp"
        TEXT recipient "Email Address or Phone"
        TEXT subject "Subject line or tag"
        TEXT content "HTML body or WhatsApp text"
        TEXT status "sent / failed"
        TEXT sent_at "Timestamp"
    }
```

---

## 5. Function & API Endpoint Mapping Reference

| Client UI Action | JavaScript Event Trigger | REST API Endpoint | Backend Function (`database.js` / `notifications.js`) | Target SQLite Table |
| :--- | :--- | :--- | :--- | :--- |
| **Register Patient** | `patientRegistrationForm.onsubmit` | `POST /api/patients` | `createPatient(data)` | `patients` |
| **NFC Card Tap (Reception)** | `handleCardScan(uid)` | `POST /api/checkin` | `getPatientByCardUID()`, `markArrival()` | `patients`, `appointments`, `visits` |
| **NFC Card Tap (Doctor)** | `loadPatientRecord(uid)` | `GET /api/patients/card/:uid` | `getFullPatientRecord(uid)` | `patients`, `visits`, `prescriptions`, `labs` |
| **Save Vitals** | `vitalsForm.onsubmit` | `PUT /api/visits/:id` | `updateVisit(id, {vitals})` | `visits` |
| **Save Diagnosis & Notes**| `currentVisitForm.onsubmit` | `PUT /api/visits/:id` | `updateVisit(id, {diagnosis, notes})` | `visits` |
| **Commit Prescription** | `btnSubmitPrescription.onclick` | `POST /api/prescriptions` | `createPrescription(data)` | `prescriptions` |
| **Schedule & Transmit** | `followupForm.onsubmit` | `POST /api/doctor/followup-and-notify` | `createAppointment()`, `sendPatientEmail()`, `sendPatientWhatsApp()`, `createNotification()` | `appointments`, `notifications` |
| **View Sent Email** | `btnPreviewEmail.onclick` | `GET /api/notifications/view-email/:id` | `getNotificationById(id)` | `notifications` |
| **Conclude Consultation** | `btnCheckoutPatient.onclick` | `PUT /api/visits/:id` | `updateVisit(id, {status: 'completed'})` | `visits` |
