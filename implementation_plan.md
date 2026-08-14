# แผนการดำเนินงาน: สร้างและปรับปรุงระบบจัดการการแจ้งเตือนและตั้งค่าอีเมลใกล้หมดวาระ

แผนงานนี้จัดทำขึ้นเพื่อสร้างและปรับปรุงหน้าจัดการ **"การแจ้งเตือนและอีเมล — ใกล้หมดวาระ" (Term Expiration Notification & Email Settings)** สำหรับผู้ใหญ่บ้าน กำนัน และผู้ช่วยผู้ใหญ่บ้าน ให้สมบูรณ์ รัดกุม ปลอดภัย และตรงตามสถาปัตยกรรมพร้อมดีไซน์ Neumorphic / Soft UI ของระบบเดิม

---

## User Review Required

> [!IMPORTANT]
> - **การไม่มี Sidebar / Navigation Drawer**: หน้านี้ถูกออกแบบเป็นหน้าจัดการเดี่ยว (Standalone Settings Page) ภายในแอปพลิเคชันเดิมตามข้อกำหนด โดยปรับแต่งโครงสร้าง Header, Cards, Forms, Live Preview และ Delivery Logs อย่างเป็นระเบียบ
> - **การป้องกันอีเมลซ้ำ (Idempotence & Duplication Rule)**: ระบบใช้ `notification_key` (เช่น `TERM_EXPIRATION_6_MONTHS:{personId}:{termEndDate}`) บน SQLite Table `notification_events` พร้อม UNIQUE constraint และระบบ Atomic Claiming เพื่อรับประกันว่าไม่มีการส่งซ้ำแม้รันพร้อมกัน
> - **แหล่งความจริงของวันหมดวาระ**: คำนวณจาก `daysLeft = termEndDate - currentDate` (เวลาประเทศไทย Asia/Bangkok) โดยใช้ `termEndDate` เป็นหลัก ไม่ใช้ค่าประมาณการย้อนหลัง

---

## Proposed Changes

### Backend Services & API

#### [MODIFY] [server/settings.js](file:///d:/APP/life-countdown/server/settings.js)
- เพิ่มโครงสร้างค่าเริ่มต้นสำหรับเทมเพลตอีเมลที่ปรับแต่งได้ (Custom Subject & HTML/Text Templates) สำหรับ 6 เดือน, 1 เดือน และสรุปประจำปี
- เพิ่มการรองรับการกรองบทบาทเป้าหมาย (`roles`: `village_headman`, `kamnan`, `assistant_village_headman`) และการกำหนดผู้รับแบบยืดหยุ่น (To, CC, BCC, Admin, Custom, `includePerson`)
- เพิ่มการสร้างคีย์ `TERM_EXPIRATION_6_MONTHS:{personId}:{termEndDate}`, `TERM_EXPIRATION_1_MONTH:{personId}:{termEndDate}`, `TERM_EXPIRATION_ANNUAL_SUMMARY:{year}`

#### [MODIFY] [server/email-templates.js](file:///d:/APP/life-countdown/server/email-templates.js)
- พัฒนาระบบแทนที่ตัวแปรแบบไดนามิก (Template Variable Interpolator) รองรับตัวแปรทั้งหมด:
  - `{{person_name}}`, `{{position}}`, `{{village}}`, `{{subdistrict}}`, `{{district}}`, `{{province}}`, `{{term_start_date}}`, `{{term_end_date}}`, `{{days_left}}`, `{{months_left}}`, `{{notification_type}}`, `{{year}}`, `{{total_count}}`, `{{six_month_count}}`, `{{one_month_count}}`, `{{expired_count}}`, `{{incomplete_count}}`, `{{action_url}}`
- ปรับปรุงให้สามารถรับทั้งเทมเพลตที่กำหนดเอง หรือใช้ Rich Soft UI Email Layout เริ่มต้นเป็น fallback

#### [MODIFY] [server/notification-engine.js](file:///d:/APP/life-countdown/server/notification-engine.js)
- อัปเดต `loadPeople` และ `processPersonReminder` ให้ตรวจสอบสิทธิ์ตามบทบาทที่เลือก (`roles`) และคำนวณสถิติจำนวนผู้มีสิทธิ์ (Eligible Recipients Breakdown)
- เพิ่มระบบรองรับการส่งอีเมลทดสอบด้วยข้อมูลจำลอง (Sample Data) สำหรับทั้ง 3 ประเภทโดยไม่ส่งผลกระทบต่อบันทึกจริง
- อัปเดต `buildAnnualSummary` ให้สรุปจำนวนรวม, 6 เดือน, 1 เดือน, หมดวาระแล้ว, ข้อมูลไม่สมบูรณ์ อย่างถูกต้อง

#### [MODIFY] [server/api.js](file:///d:/APP/life-countdown/server/api.js)
- ปรับปรุง `/api/notifications/status` ให้ส่งคืนสถิติผู้มีสิทธิ์ (Eligible Counts), สถิติการส่ง (Delivery Stats), และรายละเอียดคอนฟิกสำหรับหน้า UI
- เพิ่ม Endpoint `/api/notifications/preview` สำหรับเรนเดอร์ Live Preview ของเทมเพลต
- เพิ่ม Endpoint `/api/notifications/retry` สำหรับการสั่งลองส่งใหม่ (Retry) รายการที่ล้มเหลว
- เพิ่ม Endpoint `/api/send-test-email` ที่รองรับการทดสอบประเภทการแจ้งเตือน 6m, 1m, annual

---

### Frontend & Styling (Neumorphism / Soft UI)

#### [MODIFY] [css/styles.css](file:///d:/APP/life-countdown/css/styles.css)
- ปรับแต่งสไตล์ Soft UI / Neumorphism:
  - การ์ดมนนุ่ม (Soft Rounded Cards) พร้อมเงาซ้อนมิติ (`box-shadow: 6px 6px 16px rgba(15,23,42,0.06), -4px -4px 12px rgba(255,255,255,0.9)`)
  - ช่องกรอกข้อมูลแบบบุ๋ม/กดลง (Pressed / Inset Inputs: `box-shadow: inset 2px 2px 5px rgba(0,0,0,0.05), inset -2px -2px 5px rgba(255,255,255,0.8)`)
  - ชิปตัวแปรแบบกดได้ (Variable UI Chips) ที่มี hover effect และความเงา
  - ส่วนแสดงผลแท็บ (Tabs UX: 📝 ตั้งค่าเนื้อหา, 👥 ผู้รับ, 👁️ Live Preview, 🧪 Test Email)
  - Layout Grid Responsive สำหรับ Desktop ( multi-column), Tablet (2-column), Mobile (1-column stack)

#### [MODIFY] [js/notifications.js](file:///d:/APP/life-countdown/js/notifications.js)
- ปรับปรุงคอมโพเนนต์การจัดการการแจ้งเตือนทั้งหมด ให้สร้าง UI ตามข้อกำหนด 17 ข้อ:
  - Page Header พร้อม Mail Icon, Live System Clock, Last Sync, Notification Service Active status
  - Overview KPI Cards 5 การ์ด (ทั้งหมด, 6 เดือน, 1 เดือน, หมดวาระแล้ว, ข้อมูลไม่สมบูรณ์)
  - Card A (6-Month), Card B (1-Month), Card C (Annual Summary) พร้อมสวิตช์ Toggle, Threshold, Target Roles Checkboxes, Schedule, Email Subject/Body Editors, Dynamic Variable Insertion Chips, Eligibility & Delivery Stats, Action Buttons
  - Recipient Rules Editor (Primary, CC, BCC, Admin, Custom, Include Person, Syntax Validation & Duplicate Warning)
  - Live Preview Panel ที่อัปเดตแบบเรียลไทม์เมื่อเปลี่ยนตัวแปรหรือข้อความ
  - Test Email Modal / Panel ที่ส่งข้อความทดสอบโดยใช้ตัวแปรตัวอย่าง
  - Delivery Logs Table พร้อม ค้นหา (Search), กรอง (Filter by status/type), จัดเรียง (Sort), ปุ่มรีเฟรช และปุ่มสั่ง Retry
  - Confirmation Dialogs ก่อนทำการสั่งรันหรือบันทึกข้อมูลสำคัญ

#### [MODIFY] [index.html](file:///d:/APP/life-countdown/index.html)
- ปรับโครงสร้างหน้าหลักให้แสดงผลหน้า "การแจ้งเตือนและอีเมล — ใกล้หมดวาระ" แบบไร้ Sidebar / Navigation โดยเน้นการจัดวาง Header, KPIs, Settings Cards, Live Preview, และ Activity Log อย่างเป็นระเบียบ

---

## Verification Plan

### Automated Tests
- รัน `npm test` เพื่อตรวจสอบระบบเดิม
- เขียนสคริปต์ทดสอบตรรกะคำนวณวันหมดวาระ การแทนที่ตัวแปรในเทมเพลต และความถูกต้องของ `notification_key`

### Manual Verification
1. **การตรวจสอบ UI/UX**:
   - ตรวจสอบรูปแบบ Neumorphism / Soft UI (การ์ดมน, ช่องกรอกกดลง, สีนุ่มนวล, Icon Lucide style)
   - ตรวจสอบความถูกต้องของการย่อขยายหน้าจอ (Desktop, Tablet, Mobile)
2. **การทดสอบฟังก์ชันตั้งค่าและการแทนที่ตัวแปร**:
   - คลิกชิปตัวแปร `{{person_name}}` ฯลฯ เพื่อทดสอบว่าถูกแทรกลงใน Subject / Body หรือไม่
   - สลับแท็บ Live Preview เพื่อตรวจสอบว่าข้อความแสดงผลไดนามิกถูกต้อง
3. **การทดสอบการส่งอีเมลและห้ามส่งซ้ำ**:
   - ทดสอบส่งอีเมลทดสอบ (Test Email) สำหรับทั้ง 6m, 1m, annual summary
   - ทดสอบกด "รันรอบทันที" และตรวจสอบ `notification_events` table ว่าบันทึก key ถูกต้องและไม่เกิดการส่งซ้ำ (Idempotency check)
4. **การทดสอบ Delivery Log & Retry**:
   - ทดสอบการค้นหา กรองสถานะ (Sent/Failed/Pending/Skipped) และการสั่ง Retry
