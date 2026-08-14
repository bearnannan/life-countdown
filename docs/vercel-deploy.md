# Vercel Deployment

## Environment Variables

ตั้งค่าใน Vercel Project Settings:

```env
ADMIN_TOKEN=
CRON_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_SHEETS_ID=1cq0Cal0O2Q3dCQ3FaPAJz9TnUKtsolTEOMiPva_pm-Q
GOOGLE_SHEETS_RANGE=A:Z
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=wara.noreply.app@gmail.com
SMTP_PASS=
EMAIL_FROM=wara.noreply.app@gmail.com
EMAIL_FROM_NAME=ระบบแจ้งเตือนวาระ
DASHBOARD_URL=https://<vercel-production-domain>
```

`GOOGLE_PRIVATE_KEY` ให้ใส่ค่า private key แบบมี `\n` หรือ paste multi-line ตามที่ Vercel รองรับ

## Supabase

รัน SQL migration:

```sql
supabase/migrations/001_notification_system.sql
```

ตารางเปิด RLS ไว้ แต่ production API ใช้ `SUPABASE_SERVICE_ROLE_KEY` ฝั่ง Vercel Function เท่านั้น ห้ามส่ง key นี้ไป frontend

## Cron

Vercel Cron รันที่ `/api/cron/notifications`

```json
{
  "schedule": "0 1 * * *"
}
```

`01:00 UTC` = `08:00 Asia/Bangkok`
