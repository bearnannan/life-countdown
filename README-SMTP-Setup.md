# SMTP Setup Guide — Life Countdown Notification Engine

## สารบัญ
1. [Google App Password Setup](#1-google-app-password-setup)
2. [Environment Variables Reference](#2-environment-variables-reference)
3. [Supabase Migration](#3-supabase-migration)
4. [Anti-Spam Checklist](#4-anti-spam-checklist)
5. [Testing & Verification](#5-testing--verification)
6. [Troubleshooting](#6-troubleshooting)
7. [DKIM/DMARC/SPF Notes](#7-dkimdmarcspf-notes)

---

## 1. Google App Password Setup

> **สำคัญ:** Gmail ไม่อนุญาตให้ใช้รหัสผ่านบัญชีปกติสำหรับ SMTP อีกต่อไป ต้องใช้ **App Password** (16 ตัวอักษร) เท่านั้น

### ขั้นตอน:

1. **เปิด 2-Step Verification** (ถ้ายังไม่ได้เปิด)
   - ไปที่ https://myaccount.google.com/security
   - เลื่อนไปหา "2-Step Verification" → เปิดใช้งาน
   - ทำตามขั้นตอนยืนยันตัวตน

2. **สร้าง App Password**
   - ไปที่ https://myaccount.google.com/apppasswords
   - (ถ้าไม่เห็นเมนูนี้ ให้เปิด 2-Step Verification ก่อน)
   - ตั้งชื่อ App: `Life Countdown SMTP`
   - คลิก "Create"
   - **คัดลอก 16 ตัวอักษร** ที่แสดง (เช่น `abcd efgh ijkl mnop`)
   - ⚠️ ลบช่องว่างออก → `abcdefghijklmnop`

3. **ใส่ใน .env**
   ```
   SMTP_PASS=abcdefghijklmnop
   ```

### ข้อควรระวัง:
- App Password จะแสดงครั้งเดียว — ถ้าหาย ต้องสร้างใหม่
- ห้ามใช้รหัสผ่านบัญชี Google ปกติ
- ถ้าบัญชีเป็น Google Workspace (องค์กร) อาจต้องให้ Admin อนุมัติ

---

## 2. Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SMTP_HOST` | ✅ | `smtp.gmail.com` | SMTP server hostname |
| `SMTP_PORT` | ✅ | `465` | 465 (Implicit TLS) or 587 (STARTTLS) |
| `SMTP_SECURE` | ✅ | `true` | `true` for port 465, `false` for 587 |
| `SMTP_USER` | ✅ | — | Full Gmail address |
| `SMTP_PASS` | ✅ | — | 16-char Google App Password |
| `EMAIL_FROM` | ❌ | `SMTP_USER` | Sender email (usually same as SMTP_USER) |
| `EMAIL_FROM_NAME` | ❌ | `ระบบแจ้งเตือนวาระ` | Sender display name (Thai supported) |
| `SUPABASE_URL` | ✅ | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | Supabase service role key (server-side only!) |
| `GOOGLE_SHEETS_ID` | ✅ | — | Google Sheets spreadsheet ID |
| `GOOGLE_SHEETS_RANGE` | ❌ | `A:Z` | Sheet range to fetch |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ✅ | — | Service account email |
| `GOOGLE_PRIVATE_KEY` | ✅ | — | PEM-encoded RS256 private key |
| `DASHBOARD_URL` | ❌ | — | URL to dashboard (included in emails) |
| `CRON_SECRET` | ❌* | — | Bearer token for Vercel Cron (*required in production) |
| `SHEETS_COLUMN_MAP` | ❌ | — | JSON mapping if sheet headers differ from defaults |

### SMTP Port Quick Reference:

| Port | Protocol | `SMTP_SECURE` | Note |
|------|----------|---------------|------|
| 465 | Implicit TLS | `true` | ✅ Gmail recommended, ง่ายกว่า |
| 587 | STARTTLS | `false` | ✅ RFC recommended, ใช้ได้ดี |

---

## 3. Supabase Migration

### วิธีรัน migration:

1. เปิด Supabase Dashboard → SQL Editor
2. Copy เนื้อหาจาก `supabase/migrations/001_notification_system.sql`
3. วาง และกด **Run**
4. ตรวจสอบว่าสร้างสำเร็จ:
   - Tables: `system_settings`, `notification_events`, `audit_log`
   - Functions: `claim_notification`, `mark_notification_sent`, `mark_notification_failed`

### ตรวจสอบ initial data:
```sql
SELECT * FROM system_settings;
```

ควรเห็น 4 rows: `admin_emails`, `notification_enabled`, `six_month_threshold`, `one_month_threshold`

---

## 4. Anti-Spam Checklist

### ✅ สิ่งที่ระบบทำแล้ว (Built-in):

| # | มาตรการ | รายละเอียด |
|---|---------|-----------|
| 1 | `Date:` header | RFC 5322 format ทุกอีเมล |
| 2 | `Message-ID:` header | UUID-based, unique ทุกฉบับ |
| 3 | `MIME-Version: 1.0` | ถูกต้องตามมาตรฐาน |
| 4 | Multipart/alternative | ส่งทั้ง text/plain + text/html |
| 5 | RFC 2047 Thai encoding | ชื่อภาษาไทยใน From/Subject ไม่เพี้ยน |
| 6 | No `Auto-Submitted` | ไม่ถูก M365 จัดเป็น bot |
| 7 | No `Precedence: bulk` | ไม่ถูกจัดเป็น bulk mail |
| 8 | No `X-Mailer` | ไม่เปิดเผยเครื่องมือส่ง |
| 9 | Inline styles only | ไม่มี external CSS/JS |
| 10 | Table-based HTML | รองรับ enterprise email clients |

### 📝 สิ่งที่ต้องทำเพิ่ม (ผู้ดูแลระบบ):

- [ ] **Warm up sender**: เริ่มส่ง 5-10 ฉบับ/วันแรก แล้วค่อยเพิ่มปริมาณ
- [ ] **ตั้ง DASHBOARD_URL** ใน .env เพื่อให้ลิงก์ในอีเมลทำงาน
- [ ] **ตรวจ Inbox Placement**: ส่งทดสอบไปทั้ง Gmail และ Outlook/M365 Group
- [ ] **ไม่ใช้หัวข้อ spam-trigger**: หลีกเลี่ยงคำว่า "URGENT!!!", "ฟรี", "คลิกที่นี่"

---

## 5. Testing & Verification

### ทดสอบ SMTP:
```bash
# ตรวจ connectivity อย่างเดียว
node test-smtp.js --check

# ส่ง test email
node test-smtp.js --send your-email@gmail.com
```

### Inbox Placement Checklist:

#### Gmail:
- [ ] อีเมลอยู่ใน **Inbox** (ไม่ใช่ Spam)
- [ ] อีเมลไม่อยู่ใน **Promotions** tab
- [ ] ชื่อภาษาไทยแสดงถูกต้อง
- [ ] ลิงก์ Dashboard ทำงาน (ถ้ามี)

#### Microsoft 365 / Outlook:
- [ ] อีเมลอยู่ใน **Inbox** (ไม่ใช่ Junk)
- [ ] M365 Group Mailbox ได้รับอีเมล
- [ ] อีเมลไม่ถูก quarantine
- [ ] ชื่อภาษาไทยแสดงถูกต้อง

### รัน Notification Cycle:
```bash
# รันรอบแจ้งเตือนปกติ
npm run notify

# บังคับรัน annual summary (ไม่ต้องรอ 31 ธ.ค.)
node notification-service.js --annual
```

---

## 6. Troubleshooting

### ปัญหาที่พบบ่อย:

| อาการ | สาเหตุ | วิธีแก้ |
|-------|--------|---------|
| `535 Authentication failed` | App Password ไม่ถูก | สร้าง App Password ใหม่ |
| `Connection timeout` | Firewall block | ลองเปลี่ยน port 465 ↔ 587 |
| `Certificate error` | TLS issue | ตรวจ system time, อัปเดต Node.js |
| `550 Relay denied` | ส่งจาก domain อื่น | ใช้ EMAIL_FROM เดียวกับ SMTP_USER |
| อีเมลเข้า Spam | ส่งครั้งแรก/ปริมาณเยอะ | Warm up sender ก่อน |
| อีเมลเข้า Junk (M365) | Header ไม่ถูก | ตรวจว่าไม่มี Auto-Submitted |
| ชื่อไทยเป็น `???` | Encoding ไม่ถูก | ตรวจ Content-Transfer-Encoding: base64 |
| `Duplicate key` error | ส่งซ้ำ | ปกติ — ระบบ dedup ทำงานถูกต้อง |

### Debug SMTP Conversation:
```bash
# เปิด debug mode ใน test-smtp.js (เปิดอยู่แล้วโดย default)
node test-smtp.js --send your-email@gmail.com
```
จะเห็น SMTP conversation ทั้งหมด:
```
→ C: EHLO gmail.com
← S: 250-smtp.gmail.com at your service
← S: 250-AUTH PLAIN LOGIN
→ C: AUTH PLAIN ****
← S: 235 Accepted
...
```

---

## 7. DKIM/DMARC/SPF Notes

### เมื่อใช้ Gmail (@gmail.com):
- **SPF**: Google จัดการให้แล้ว ✅
- **DKIM**: Google sign ให้โดยอัตโนมัติ ✅
- **DMARC**: ไม่ต้องตั้งค่าเพิ่ม ✅

### เมื่อใช้ Custom Domain (อนาคต):
หากเปลี่ยนจาก @gmail.com เป็น @yourdomain.th ต้องตั้งค่า DNS เพิ่ม:

1. **SPF Record** (TXT):
   ```
   v=spf1 include:_spf.google.com ~all
   ```

2. **DKIM**: ตั้งค่าผ่าน Google Workspace Admin Console

3. **DMARC Record** (TXT):
   ```
   _dmarc.yourdomain.th  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.th"
   ```
   - เริ่มด้วย `p=none` (monitor) ก่อน แล้วค่อยเปลี่ยนเป็น `p=quarantine` หรือ `p=reject`

---

## สถาปัตยกรรมไฟล์

```
life-countdown/
├── .env                      # Environment variables (DO NOT commit)
├── package.json              # ESM config + scripts
├── supabase/migrations/      # Supabase schema migrations
├── smtp-client.js            # Native SMTP engine (node:net + node:tls)
├── email-templates.js        # Email template builder (3 types)
├── data-source.js            # Google Sheets JWT fetcher
├── notification-service.js   # Notification orchestrator
├── test-smtp.js              # SMTP test script
└── README-SMTP-Setup.md      # This file
```
