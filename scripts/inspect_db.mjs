import { openDatabase } from '../src/data.mjs';
const db = openDatabase();

console.log('--- DATABASE INSPECTION ---');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
console.log('Tables:', tables);

for (const tbl of ['admins', 'admin_users', 'admin_credentials', 'admin_owner', 'admin_profiles', 'admin_recovery', 'admin_verified_recovery', 'sessions', 'audit', 'rl_audit']) {
  if (tables.includes(tbl)) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${tbl})`).all().map(c => c.name);
      console.log(`Table ${tbl} columns:`, cols);
      // Select non-password columns
      const safeCols = cols.filter(c => !c.includes('password') && !c.includes('secret') && !c.includes('token') && !c.includes('hash'));
      const rows = db.prepare(`SELECT ${safeCols.length ? safeCols.join(', ') : 'count(*) as count'} FROM ${tbl}`).all();
      console.log(`Table ${tbl} data:`, rows);
    } catch (e) {
      console.error(`Error querying ${tbl}:`, e.message);
    }
  }
}

if (tables.includes('bookings')) {
  const count = db.prepare('SELECT count(*) as c FROM bookings').get().c;
  console.log('Bookings total count:', count);
  const rows = db.prepare('SELECT id, ref, name, phone, brand, model, created_at FROM bookings ORDER BY id DESC LIMIT 10').all();
  console.log('Last 10 bookings:', rows);
}

if (tables.includes('rl_part_inquiries')) {
  const cols = db.prepare(`PRAGMA table_info(rl_part_inquiries)`).all().map(c => c.name);
  console.log('rl_part_inquiries cols:', cols);
  const count = db.prepare('SELECT count(*) as c FROM rl_part_inquiries').get().c;
  console.log('rl_part_inquiries total count:', count);
  const rows = db.prepare(`SELECT ${cols.slice(0, 8).join(', ')} FROM rl_part_inquiries ORDER BY id DESC LIMIT 10`).all();
  console.log('Last 10 rl_part_inquiries:', rows);
}

if (tables.includes('orders')) {
  const count = db.prepare('SELECT count(*) as c FROM orders').get().c;
  console.log('Orders total count:', count);
  const rows = db.prepare('SELECT id, ref, name, phone, created_at FROM orders ORDER BY id DESC LIMIT 10').all();
  console.log('Last 10 orders:', rows);
}

process.exit(0);
