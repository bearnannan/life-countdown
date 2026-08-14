// แปลงไฟล์ CSV ต้นฉบับ (เข้ารหัส TIS-620 / Windows-874) เป็น UTF-8
// เพื่อใช้เป็นแหล่งข้อมูลของแดชบอร์ด ไฟล์ต้นฉบับจะไม่ถูกแก้ไข
//
// วิธีใช้:
//   node scripts/convert-csv.mjs [ไฟล์ต้นฉบับ] [ไฟล์ปลายทาง]
//
// ค่าเริ่มต้น: "วาระ ผญบ - วาระ.csv" → "data/vara_utf8.csv"

import { readFile, writeFile } from 'node:fs/promises';

const src = process.argv[2] || 'วาระ ผญบ - วาระ.csv';
const dest = process.argv[3] || 'data/vara_utf8.csv';

const buffer = await readFile(src);
const text = new TextDecoder('windows-874').decode(buffer);
await writeFile(dest, text, 'utf8');
console.log(`แปลง ${src} → ${dest} เรียบร้อย (${text.length} ตัวอักษร)`);
