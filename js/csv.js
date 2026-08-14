// ============================================================
// CSV parser แบบ RFC 4180
// - รองรับฟิลด์ในเครื่องหมายคำพูด (",) และเครื่องหมายคำพูดคู่ ("""")
// - รองรับบรรทัดใหม่ภายในฟิลด์ (ข้อมูลจริงมีฟิลด์โทรศัพท์ที่มี \n)
// - รองรับ CRLF / LF และ BOM
// ============================================================

/**
 * แยกข้อความ CSV เป็น array ของแถว (array ของฟิลด์)
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const s = String(text).replace(/^\uFEFF/, ''); // ตัด BOM

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // ข้าม CR (จัดการ CRLF)
    } else {
      field += c;
    }
  }

  // แถวสุดท้าย (ถ้ายังมีข้อมูลเหลือ)
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  // ตัดแถวว่าง (เช่น หลัง newline ท้ายไฟล์)
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}
