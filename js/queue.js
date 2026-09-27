// คิวเพลง: เก็บลำดับเพลงที่สุ่มแล้ว และตำแหน่งเพลงปัจจุบัน
// ไฟล์นี้ไม่ยุ่งกับหน้าจอหรือ YouTube เลย เพื่อให้ต่อยอดเฟสหน้าได้ง่าย

// สุ่มลำดับแบบ Fisher–Yates (ทุกลำดับมีโอกาสออกเท่ากัน) คืน array ใหม่
export function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Queue {
  constructor(videoIds) {
    this.ids = shuffle(videoIds);
    this.index = 0;
  }

  get current() { return this.ids[this.index]; }
  get size() { return this.ids.length; }
  get position() { return this.index + 1; }   // เริ่มนับที่ 1 สำหรับแสดงบนจอ
  get isEmpty() { return this.ids.length === 0; }
  get hasNext() { return this.index < this.ids.length - 1; }
  get hasPrev() { return this.index > 0; }

  next() {
    if (this.hasNext) this.index++;
    return this.current;
  }

  prev() {
    if (this.hasPrev) this.index--;
    return this.current;
  }

  // ตัดเพลงปัจจุบันทิ้ง (ใช้กับเพลงที่เล่นไม่ได้) แล้วขยับไปเพลงข้างเคียง
  // direction = 1 ไปข้างหน้า, -1 ย้อนหลัง; ถ้าทางนั้นหมดแล้วจะไปอีกทางแทน
  removeCurrent(direction = 1) {
    this.ids.splice(this.index, 1);
    // หลัง splice เพลงถัดไปเลื่อนมาอยู่ที่ index เดิมแล้ว จึงขยับเฉพาะตอนย้อนหลัง
    if (direction < 0 && this.index > 0) this.index--;
    if (this.index > this.ids.length - 1) this.index = Math.max(0, this.ids.length - 1);
    return this.current;
  }
}
