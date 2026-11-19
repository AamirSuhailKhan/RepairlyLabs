import {randomBytes} from 'node:crypto';
// Reservations are committed before inserting a request; a failed request burns its ID.
// Keep this ledger in the same persistent database and include it in backups.
export function createReferenceAllocator(db, randomHex=()=>randomBytes(4).toString('hex').toUpperCase()) {
 db.exec(`CREATE TABLE IF NOT EXISTS rl_reference_registry(ref TEXT PRIMARY KEY COLLATE NOCASE, reserved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 INSERT OR IGNORE INTO rl_reference_registry(ref) SELECT ref FROM bookings;
 INSERT OR IGNORE INTO rl_reference_registry(ref) SELECT ref FROM orders;
 CREATE TRIGGER IF NOT EXISTS rl_register_booking AFTER INSERT ON bookings BEGIN INSERT OR IGNORE INTO rl_reference_registry(ref) VALUES(NEW.ref); END;
 CREATE TRIGGER IF NOT EXISTS rl_register_order AFTER INSERT ON orders BEGIN INSERT OR IGNORE INTO rl_reference_registry(ref) VALUES(NEW.ref); END;`);
 const reserve=db.prepare('INSERT OR IGNORE INTO rl_reference_registry(ref) VALUES(?)');
 return function allocate(kind){
  const prefix=({KM:'RLM',RLM:'RLM',KP:'RLP',RLP:'RLP'})[kind];
  if(!prefix)throw new Error('Invalid reference type');
  const date=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'2-digit',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=t=>date.find(x=>x.type===t).value;
  for(let i=0;i<128;i++){
   const suffix=randomHex();if(!/^[0-9A-F]{8}$/.test(suffix))throw new Error('Invalid reference entropy');
   const ref=`${prefix}-${part('year')}${part('month')}${part('day')}-${suffix}`;
   if(reserve.run(ref).changes===1)return ref;
  }
  throw Object.assign(new Error('Could not allocate a reference; please retry.'),{status:503});
 };
}
