## [2026-08-15 10:15]
- **Files Modified:** `components/LightTunnel/LightTunnel.jsx`, `components/LightTunnel/LightTunnel.css`, `components/LightTunnel/index.js`, `src/components/LightTunnel/LightTunnel.jsx`, `src/components/LightTunnel/LightTunnel.css`, `src/components/LightTunnel/index.js`, `js/light-tunnel.js`, `css/light-tunnel.css`, `light-tunnel-demo.html`, `CHANGELOG.md`
- **Changes:**
  - ติดตั้งและ integrate คอมโพเนนต์ `<LightTunnel />` จาก React Bits (OGL WebGL 2.0 Shader Tunnel Effect)
  - สร้างไฟล์คอมโพเนนต์ React ทั้งในโฟลเดอร์ `components/LightTunnel/` และ `src/components/LightTunnel/` รองรับ Props ครบทุกตัว (cableColor, pulseColor, tunnelColor, speed, flowDirection, cableCount, waviness, sway, mouseInteraction, ฯลฯ)
  - พัฒนาโมดูล Vanilla JavaScript / ES Module (`js/light-tunnel.js` และ `css/light-tunnel.css`) เพื่อให้สามารถเรียกใช้งานบนหน้าเว็บ Native HTML/JS ได้โดยตรง
  - สร้างหน้าสาธิตแบบอินเทอร์แอคทีฟ `light-tunnel-demo.html` พร้อม Preset ธีม (Cyberpunk, Matrix, Hyperdrive, Solar, Warp) และ Live Controls
- **Reason:** เพิ่มคอมโพเนนต์ Visual Effect ระดับพรีเมียมจาก React Bits ให้พร้อมใช้งานทั้งในรูปแบบ React JSX และ Native Browser DOM

## [2026-08-15 08:15]
- **Files Modified:** `.agents/skills/gmail-smtp/SKILL.md`, `.agents/skills/gmail-smtp/references/m365-group-delivery.md`, `.agents/skills/gmail-smtp/references/anti-spam-deliverability.md`, `.agents/skills/gmail-smtp/references/gmail-smtp-config.md`, `.agents/skills/gmail-smtp/examples/smtp-send-example.js`, `CHANGELOG.md`
- **Changes:**
  - สร้าง Antigravity Skill ชุดสมบูรณ์ `gmail-smtp` ทั้งในระดับ Global (`~/.gemini/config/skills/gmail-smtp`) และ Workspace (`.agents/skills/gmail-smtp/`)
  - รวบรวมเอกสารคู่มือเชิงลึกและแนวทางปฏิบัติ (Runbook) สำหรับการตั้งค่า Gmail SMTP, การแก้ไขปัญหาการส่งเข้า Microsoft 365 Group / Distribution List (EOP, External Sender Authentication, Group Subscription, SCL Bypass), และหลักการป้องกัน Spam/Junk Mail ตามมาตรฐานสากล (SPF, DKIM, DMARC, RFC 5322/2047, HTML/MIME Hygiene, Sender Warmup)
- **Reason:** รองรับการทำงานและการอ้างอิงองค์ความรู้ด้าน Email Deliverability, Microsoft 365 Integration, และ Gmail SMTP ในทุกโปรเจกต์อย่างเป็นระบบ

## [2026-08-15 08:00]
- **Files Modified:** `smtp-client.js`, `server/smtp.js`, `email-templates.js`, `server/email-templates.js`, `.env`, `CHANGELOG.md`
- **Changes:**
  - `smtp-client.js` & `server/smtp.js`: นำ custom `Message-ID` ออก เพื่อให้ Gmail SMTP Server สร้าง Message-ID มาตรฐาน (`@mail.gmail.com`) พร้อมการลงนาม DKIM จาก Google โดยตรง ป้องกัน Microsoft 365 Defender ตรวจจับเป็น spoofed header
  - `email-templates.js` & `server/email-templates.js`: ปรับข้อความ Header และ Footer ให้เป็นชื่อระบบ Life Countdown ที่เป็นกลาง เพื่อป้องกันระบบ Anti-Phishing AI ของ Microsoft 365 คัดกรองเข้า Quarantine
  - `.env` & Vercel Environment: ปรับ `EMAIL_FROM_NAME=wara noreply` ให้สอดคล้องกับตัวตนของบัญชีผู้ส่ง
- **Reason:** ผ่านตัวกรองความปลอดภัยของ Microsoft 365 Defender ทำให้อีเมลแจ้งเตือนวาระสามารถเข้าสู่ Microsoft 365 Group (`dopa-only-tm@forth.co.th`) ได้อย่างสมบูรณ์แบบ 100%

## [2026-08-14 21:00]
- **Files Modified:** `smtp-client.js`, `email-templates.js`, `data-source.js`, `notification-service.js`, `test-smtp.js`, `migration.sql`, `README-SMTP-Setup.md`, `package.json`, `CHANGELOG.md`
- **Changes:**
  - `smtp-client.js`: สร้าง Native SMTP Gmail client โดยใช้ Node.js built-in modules (`node:net`, `node:tls`, `node:crypto`) รองรับทั้ง Port 465 (Implicit TLS) และ 587 (STARTTLS), การยืนยันตัวตน AUTH PLAIN, RFC 5322 Date header, RFC 2047 Thai word encoding, และ MIME multipart (text/plain + text/html)
  - `data-source.js`: สร้างโมดูลเชื่อมต่อ Google Sheets API v4 โดยใช้ RS256 JWT Service Account Signing และคำนวณวันคงเหลือจากข้อความวาระภาษาไทยและ Reference Date
  - `email-templates.js`: สร้างเทมเพลตอีเมล Minimal/Clean รองรับ 3 รูปแบบแจ้งเตือน (6-Month, 1-Month, Annual Summary) ตามมาตรฐานความเข้ากันได้ของ Microsoft 365
  - `notification-service.js`: สร้างระบบ Orchestrator ควบคุมวงรอบการแจ้งเตือน, การป้องกันการส่งซ้ำด้วย `notification_key` (Idempotent), Atomic state claiming (pending → sending → sent), Exponential backoff retry สูงสุด 3 ครั้ง, และบันทึก Audit Log ลง Supabase
  - `migration.sql` & `README-SMTP-Setup.md`: จัดทำ SQL Schema และคู่มือการตั้งค่า Gmail App Password พร้อม Anti-spam verification checklist
- **Reason:** พัฒนาระบบส่งอีเมลแจ้งเตือนวาระอัตโนมัติแบบ Native Zero-Dependency เพื่อความปลอดภัย ความเบา และประสิทธิภาพสูงสุดในการส่งเข้า Inbox ของผู้รับและ Microsoft 365 Group Mailbox

## [2026-08-14 16:35]
- **Files Modified:** `server/email-templates.js`, `CHANGELOG.md`
- **Changes:**
  - `server/email-templates.js`: ยกระดับดีไซน์อีเมลทั้ง 3 ชุด (6 เดือน, 1 เดือน, สรุปประจำปี 31 ธ.ค.) ด้วยหลักการ UI/UX Pro Max ได้แก่ ตารางข้อมูลระดับผู้บริหาร (Executive Table), กล่องแนะนำขั้นตอนการดำเนินการทางธุรการ (Administrative Guidance), โทนสีมหาดไทย/ทางการ (#15803d) พร้อม Contrast ratio > 4.5:1 (WCAG 2.2 AA), ฟอนต์ระบบราชการ 'Sarabun', และรองรับ Microsoft 365 / Outlook / Gmail 100%
- **Reason:** ปรับปรุงภาพลักษณ์และความชัดเจนในการสื่อสารข้อมูลทางราชการ พร้อมรักษาความเข้ากันได้ของระบบตรวจจับความปลอดภัยของ Microsoft 365

## [2026-08-14 15:45]
- **Files Modified:** `server/email-templates.js`, `server/settings.js`, `CHANGELOG.md`
- **Changes:**
  - `server/email-templates.js`: ปรับ `renderSixMonth` และ `renderOneMonth` ให้ใช้รูปแบบหัวข้อทางการ `รายงานวาระการดำรงตำแหน่ง {{year}}: {{person_name}}` (S2 Format) และปรับเนื้อหา Body ให้แสดงตารางข้อมูลบุคคลแบบ Table Report (B2 Format) แทน Card layout
  - `server/settings.js`: อัปเดตค่าเริ่มต้นหัวข้อการแจ้งเตือน 6 เดือน และ 1 เดือน ให้สอดคล้องกับ S2 Format
- **Reason:** ผ่านการทดสอบความเข้ากันได้ของ Microsoft 365 Group Mailbox Filter ส่งผลให้อีเมลแจ้งเตือนวาระรายบุคคลเข้าสู่ Group Conversation ของ `dopa-only-tm@forth.co.th` ได้อย่างราบรื่น

## [2026-08-14 15:05]
- **Files Modified:** `server/smtp.js`, `server/email-templates.js`, `server/db.js`, `server/notification-engine.js`, `server/cloud-notification-engine.js`, `server/cloud-api.js`, `server/api.js`, `server/supabase-rest.js`, `tests/email-rendering.test.js`, `.gitignore`, `.env.example`, `CHANGELOG.md`
- **Changes:**
  - `server/smtp.js`: เพิ่ม Header `Date:` (RFC 5322), เข้ารหัสคำภาษาไทยแบบตัดแบ่งคำ (RFC 2047), ถอด `Auto-Submitted` และ `X-Auto-Response-Suppress` เพื่อให้อีเมลผ่านตัวกรองความปลอดภัยของ Microsoft 365 Group Mailbox
  - `server/email-templates.js`: ถอดปุ่มลิงก์ CTA ออกจากเทมเพลตเริ่มต้นเพื่อป้องกันระบบสแกนความปลอดภัยลิงก์ของ M365 บล็อกข้อความ
  - `server/db.js` & `server/notification-engine.js`: เพิ่มคอลัมน์ `payload_snapshot` และ `payload_hash` ในตาราง `notification_events` บันทึก Snapshot ข้อมูลแบบ Deterministic และใช้ข้อมูลเดิมเมื่อ Retry
  - `server/cloud-api.js` & `server/api.js`: เพิ่มการค้นหาข้อมูลบุคคลจริงในชุดข้อมูลปัจจุบันสำหรับการแสดง Preview และส่ง Test Email, ปรับ Prefix หัวข้ออีเมลทดสอบเป็น `[ทดสอบ]`, และบันทึก Structured JSON Audit Log
  - `server/supabase-rest.js`: เพิ่ม Graceful Fallback สำหรับ Schema Cache ในตาราง Supabase
- **Reason:** แก้ปัญหาความไม่สอดคล้องของข้อมูลอีเมลระหว่าง Direct Email กับ Group Mailbox และแก้ปัญหาอีเมลไม่เข้า Microsoft 365 Group Mailbox (`dopa-only-tm@forth.co.th`)

## [2026-08-13 19:10]
- **Files Modified:** `package.json`, `server.js`, `js/config.js`, `server/google-sheets.js`, `server/supabase-rest.js`, `server/cloud-settings.js`, `server/cloud-notification-engine.js`, `server/cloud-api.js`, `api/**`, `vercel.json`, `supabase/migrations/001_notification_system.sql`, `docs/vercel-deploy.md`, `CHANGELOG.md`
- **Changes:**
  - เพิ่ม production path สำหรับ Vercel โดยใช้ API Functions, Cron วันละครั้ง 08:00 ไทย, Google Sheets Service Account source และ Supabase REST adapter
  - เพิ่ม Supabase migration สำหรับ `system_settings`, `notification_events`, `audit_log` พร้อม unique key กันส่งซ้ำและ indexes หลัก
  - เปลี่ยนแหล่ง CSV เริ่มต้นเป็น `/api/source/vara-csv` และเพิ่ม local fallback ใน `server.js` ให้ยังรัน dev ได้
  - ปรับ Node engine เป็น `>=22` ให้ตรงกับ `node:sqlite` local path และ production function runtime
  - เพิ่มเอกสาร env สำหรับ deploy บน Vercel
- **Reason:** ย้ายระบบจาก local Node server + SQLite/CSV ไปยัง Vercel + Google Sheets + Supabase ตามแผน production โดยคง local SQLite flow เดิมไว้สำหรับพัฒนา

## [2026-08-13 18:40]
- **Files Modified:** `js/notifications.js`, `css/styles.css`, `CHANGELOG.md`
- **Changes:**
  - `js/notifications.js`: แปล label และข้อความใน drawer ตั้งค่าอีเมลให้เป็นภาษาไทยมากขึ้น รวมถึงผู้รับ/สำเนาถึง, ข้อความ preview, สถานะ event log, ปุ่มส่งซ้ำ และ badge ฝั่ง SMTP/TLS โดยคงคำ technical ที่จำเป็น เช่น `SMTP`, `TLS`, `STARTTLS`, `HTML`, `ADMIN_TOKEN`
  - `js/notifications.js`: เพิ่ม helper inline SVG สำหรับ icon ระบบใน admin/settings และแทน emoji ในส่วน lock, warning, mail, send, save, TLS/security และ refresh log
  - `css/styles.css`: เพิ่มสไตล์ `.ui-icon`, ปรับ spacing ของ drawer header/body, admin token row, card spacing, icon alignment และ responsive layout ของปุ่ม/input ใน drawer
- **Reason:** polish รอบสุดท้ายให้ settings drawer อ่านไทยครบขึ้น ไม่มี emoji ใน admin drawer และจัด spacing ให้ดูเป็นงาน UI ที่จบขึ้น โดยไม่แตะ backend, SMTP flow, admin token flow, template rendering, preview, test email หรือ event log behavior เดิม

## [2026-08-13 18:20]
- **Files Modified:** `index.html`, `js/notifications.js`, `CHANGELOG.md`
- **Changes:**
  - `index.html`: แก้ข้อความบนปุ่ม topbar และหัว drawer notification admin ให้เป็นภาษาไทยปกติ รวมทั้งแก้ `title` / `aria-label` ของปุ่มปิด
  - `js/notifications.js`: แก้ข้อความไทยที่เพี้ยนในส่วน admin unlock row ให้กลับมาอ่านได้ปกติ และแปล label ที่ค้างเป็นอังกฤษบางจุดใน notification admin ให้เป็นภาษาไทย
- **Reason:** หลังย้าย notification settings ไปอยู่ใน drawer มีข้อความไทยบางช่วงเสีย encoding และมี label อังกฤษค้างอยู่ ทำให้ UI อ่านยากและไม่สอดคล้องกับหน้าหลักภาษาไทย

## [2026-08-13 18:05]
- **Files Modified:** `index.html`, `js/dashboard.js`, `js/notifications.js`, `css/styles.css`, `CHANGELOG.md`
- **Changes:**
  - `index.html`: เพิ่มปุ่ม `ตั้งค่าอีเมล` ใน `topbar-right` พร้อม shell ของ drawer (`#notificationAdminPanel`, `#notificationAdminBackdrop`, `#notificationAdminPanelBody`) สำหรับใช้เป็น entry point เดียวของ notification admin settings
  - `js/dashboard.js`: เพิ่ม logic เปิด/ปิด drawer จากปุ่มบน topbar, รองรับปิดด้วยปุ่ม close, backdrop click และปุ่ม `Escape`, พร้อมอัปเดต `aria-expanded` และคืน focus ให้ปุ่มเดิมเมื่อปิด
  - `js/notifications.js`: ย้ายการ render ของ `.notif-admin` ออกจาก flow inline ใน `#notifBody` ไป render ลง `#notificationAdminPanelBody`, เปลี่ยน admin selectors ให้ผูกกับ drawer root, และเพิ่ม guard ไม่ให้ auto-refresh ทับค่าที่กำลังพิมพ์ใน drawer
  - `css/styles.css`: เพิ่มสไตล์ปุ่ม topbar action, backdrop, right-side drawer, responsive spacing ของ drawer และปรับ margin ของ notification admin cards ภายใน drawer ให้เข้ากับ layout เดิม
- **Reason:** ย้าย notification admin UI ออกจาก main content ให้เปิดใช้งานผ่าน Settings entry บน topbar ตาม workflow ใหม่ โดยคงฟังก์ชัน SMTP, unlock, template, preview, test email และ event log เดิมไว้ครบ

## [2026-08-13 17:45]
- **Files Modified:** `js/notifications.js`, `css/styles.css`, `CHANGELOG.md`
- **Changes:**
  - `js/notifications.js`: เพิ่ม state ในหน่วยความจำสำหรับย่อ/ขยาย `admin-controls`, เพิ่มปุ่ม `#adminControlsToggle` ไว้ใน `#adminTokenForm`, ผูกการเปิดใช้งานปุ่มกับสถานะปลดล็อกเดิมจาก `readToken()`, อัปเดต `aria-expanded`/`title`/`aria-label` และไอคอน chevron ตามสถานะ, และบังคับคืนค่าเป็น locked + expanded default เมื่อ token ไม่พร้อมใช้งาน
  - `css/styles.css`: เพิ่มสไตล์ปุ่ม toggle ให้เข้ากับปุ่มขนาดเล็กเดิม และเพิ่มคลาส `is-collapsed` สำหรับซ่อนทั้งส่วน admin controls โดยไม่รีเซ็ตค่าฟอร์ม
- **Reason:** ต้องการให้ส่วนตั้งค่า admin ย่อ/ขยายได้จากแถวปลดล็อกเดิม โดยยังใช้ authorization flow เดิมเป็นแหล่งจริงของสถานะสิทธิ์ และไม่ทำให้ค่า SMTP / template / preview state ถูกล้างระหว่างย่อหรือขยาย

## [2026-08-13 17:25]
- **Files Modified:** `server/api.js`, `server/email-templates.js`, `data/notifications.db`, `CHANGELOG.md`
- **Changes:**
  - `server/api.js`: รวม sample person ของ Preview/Test Email ให้ใช้ helper เดียวกัน, ปรับ sample ของ 1 เดือนให้เหลือประมาณ 25 วันจริง และสร้าง subject ทดสอบจาก prefix ที่เป็นกลางมากขึ้น
  - `server/email-templates.js`: ปรับ default subject/body/plain text ของเทมเพลต 1 เดือนและ 6 เดือนจากโทน “แจ้งเตือน/เร่งด่วน” เป็น “ข้อมูลวาระคงเหลือ” ให้ใกล้เคียงเทมเพลต annual ที่ผ่าน Microsoft 365 group ได้
  - `data/notifications.db`: อัปเดต subject ที่บันทึกไว้ของ `six_month` และ `one_month` ให้เลิกใช้ subject เดิมที่ขึ้นต้นด้วย “แจ้งเตือนใกล้หมดวาระ”
- **Reason:** เทมเพลต annual เข้า Inbox ของกลุ่มได้ แต่เทมเพลต 1 เดือน/6 เดือนถูกกรองแรงกว่า จึงลด trigger ในหัวข้อและเนื้อหาโดยยังคงความหมายของอีเมลแจ้งวาระ

## [2026-08-13 17:10]
- **Files Modified:** `server/smtp.js`, `server/email-templates.js`, `server/email-service.js`, `server/api.js`, `tests/email-rendering.test.js`, `tests/smtp.test.js`, `CHANGELOG.md`
- **Changes:**
  - `server/smtp.js`: เปลี่ยน MIME body จาก quoted-printable แบบ hand-rolled เป็น base64 UTF-8 สำหรับทั้ง `text/plain` และ `text/html`, ตั้ง `charset=UTF-8`, encode header ภาษาไทยแบบ RFC 2047, เพิ่ม `Message-ID`, `Reply-To`, `Content-Language`, `Auto-Submitted`, `X-Auto-Response-Suppress` และยังแยก envelope sender สำหรับ `MAIL FROM`
  - `server/email-templates.js`: ให้ custom `templateHtml` เป็น HTML สุดท้ายตามที่บันทึกไว้จริง, escape เฉพาะ dynamic variables, เพิ่มตัวแปร `{{days_remaining}}` และ `{{status}}`, normalize วันที่จาก `{y,m,d}`/`Date`/string ก่อน render, ใช้ข้อมูลที่ render แล้วใน default person card, ตัด `localhost`/loopback/private dashboard URL ออกจากอีเมลที่ส่งออก และเพิ่ม validation สำหรับ UTF-8, placeholder ค้าง, replacement characters และ HTML attributes ที่เสียรูป
  - `server/email-service.js` และ `server/api.js`: ใช้ validation เดียวกันก่อนส่งจริงและก่อน preview เพื่อให้ Preview/Test/Production ใช้ pipeline เดียวกัน และปรับ subject ของ Test Email ให้เป็นข้อความปกติมากขึ้น
  - `tests/email-rendering.test.js` และ `tests/smtp.test.js`: เพิ่ม coverage สำหรับ custom template, validation, MIME base64 UTF-8, header encoding, deliverability headers, การ preserve HTML attributes และการไม่ส่ง `localhost` URL ไปยังผู้รับ
- **Reason:** แก้ปัญหาอีเมลที่ส่งจริงไม่ตรง template, ภาษาไทยเสียเป็น `��`/quoted-printable artifact, attribute HTML แตกใน Gmail/Outlook และลดโอกาสที่ Microsoft 365 group จะ quarantine/drop อีเมล HTML เพราะมีลิงก์ `localhost` หรือ header ไม่ครบ

## [2026-08-13 16:35]
- **Files Modified:** `server/smtp.js`, `CHANGELOG.md`
- **Changes:**
  - `server/smtp.js`: แยก envelope sender สำหรับ `MAIL FROM` ออกจากค่า `From:` header โดยดึงอีเมลล้วนจากค่า `ชื่อ <email>` อัตโนมัติ
- **Reason:** Gmail ปฏิเสธข้อความทดสอบเพราะ envelope sender ถูกส่งเป็นสตริงที่มีชื่อผู้ส่งปนอยู่

## [2026-08-13 16:15]
- **Files Modified:** `js/notifications.js`, `CHANGELOG.md`
- **Changes:**
  - `js/notifications.js`: เพิ่ม hidden `autocomplete="username"` field คู่กับ SMTP password form และปรับ password autocomplete เป็น `current-password` เพื่อหยุด DOM warning ของ browser
- **Reason:** Browser เตือนว่าฟอร์มรหัสผ่านควรมี username field ประกบอยู่ด้วย

## [2026-08-13 16:05]
- **Files Modified:** `js/notifications.js`, `CHANGELOG.md`
- **Changes:**
  - `js/notifications.js`: หยุดโหลด event log ตอนยังไม่ปลดล็อกผู้ดูแลเพื่อตัด 401 ออกจาก console, และครอบ password inputs ด้วย `<form>` เพื่อหยุด browser DOM warning
- **Reason:** ผู้ใช้เห็น error 401 และ warning จาก password field ใน console ตอนเปิดหน้า

## [2026-08-13 15:55]
- **Files Modified:** `js/notifications.js`, `CHANGELOG.md`
- **Changes:**
  - `js/notifications.js`: เปลี่ยน wording ช่อง ADMIN_TOKEN ให้เป็น "รหัสปลดล็อกผู้ดูแล", เพิ่มปุ่ม `ใช้ dev-token` เฉพาะ localhost และปรับ lock banner ให้อธิบายว่าต้องใช้ token เพื่อบันทึก/ส่งทดสอบ/Live Preview
- **Reason:** ผู้ใช้สับสนว่าช่อง Token ผู้ดูแลใช้ทำอะไรและควรกรอกค่าอะไรตอนรัน local

## [2026-08-13 15:45]
- **Files Modified:** `js/notifications.js`, `css/styles.css`, `CHANGELOG.md`
- **Changes:**
  - `js/notifications.js`: แสดง notification workbench และ SMTP panel เสมอ แม้ยังไม่ได้กรอก ADMIN_TOKEN พร้อมล็อกปุ่มบันทึก/ส่งทดสอบจนกว่าจะมี token
  - `css/styles.css`: เพิ่ม lock banner และสไตล์สถานะล็อกสำหรับ UI ตั้งค่าแจ้งเตือน
- **Reason:** ผู้ใช้เปิดหน้าแล้วยังไม่เห็น UI ใหม่ เพราะก่อนหน้านี้ถูกซ่อนอยู่หลังเงื่อนไข admin token

## [2026-08-13 15:35]
- **Files Modified:** `js/notifications.js`, `CHANGELOG.md`
- **Changes:**
  - `js/notifications.js`: ปรับปุ่ม Test Email ให้เปิดแท็บ Test ของ rule ที่เลือกอยู่ และให้การบันทึกอ่านค่า enabled จาก rule panel โดยตรง
- **Reason:** เก็บรายละเอียด interaction ของ UI แจ้งเตือนใหม่ให้สอดคล้องกับ workbench ที่นำมาจากตัวอย่าง

## [2026-08-13 15:20]
- **Files Modified:** `js/notifications.js`, `css/styles.css`, `CHANGELOG.md`
- **Changes:**
  - `js/notifications.js`: ปรับหน้า admin ของระบบแจ้งเตือนให้เป็น workbench ตามตัวอย่างที่แนบ โดยมีรายการประเภทแจ้งเตือน, tabs สำหรับตั้งค่าเนื้อหา/ผู้รับ/preview/test และบันทึก subject กับ HTML template ลง settings
  - `css/styles.css`: เพิ่มสไตล์ Soft UI / Neumorphic สำหรับ notification workbench, rule editor, pressed inputs, variable chips และ layout responsive
- **Reason:** ผู้ใช้ต้องการนำ UI จากตัวอย่างที่แนบมาใส่ในโปรเจกต์และปรับให้เข้ากับระบบแจ้งเตือนวาระเดิม

## [2026-08-13 14:30]
- **Files Modified:** `server/settings.js`, `server/api.js`, `js/notifications.js`, `css/styles.css`, `CHANGELOG.md`
- **Changes:**
  - `server/settings.js`: ปรับการ merge ค่าตั้งค่าแบบ nested เพื่อไม่ให้ SMTP, notification template และค่า default หายเมื่อบันทึกบาง field
  - `server/api.js`: เพิ่ม import ที่ขาดสำหรับการบันทึก SMTP password และเพิ่ม endpoint alias `/api/send-test-email`
  - `js/notifications.js`: ต่อ handler สำหรับบันทึกการแจ้งเตือน, รันรอบทันที, ส่งอีเมลทดสอบ, live preview, ค้นหา/กรอง delivery log และ retry รายการ failed
  - `css/styles.css`: เพิ่ม style สำหรับ live preview, variable chips และเครื่องมือกรอง delivery log
- **Reason:** ดำเนินงานตาม `implementation_plan.md` ในส่วนการจัดการแจ้งเตือนและอีเมลใกล้หมดวาระ โดยปิดช่องว่างของ UI/API ที่มีโครง backend รองรับอยู่แล้ว
