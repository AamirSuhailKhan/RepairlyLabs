import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const DEFAULT_SETTINGS = {
  business_name: 'RepairlyLabs', tagline: 'Care for every connection.', city: 'Varanasi',
  phone: '', whatsapp: '', email: '', address: '', hours: '',
  instagram: '', map_url: '', pickup_enabled: '1', delivery_enabled: '0',
  announcement: 'Repair appointments and spare-part requests are open.',
  terms: 'Parts are confirmed for compatibility, stock, and final pricing before fulfillment. Repair quotations follow inspection. Repair payments are requested only after quotation approval; QR transfers require independent verification.',
  warranty: 'Warranty coverage, if any, depends on the specific repair or component and is confirmed in writing before service.',
  privacy_contact: 'Use the contact form to ask about personal information, correction, or deletion of your request records.'
};
const CATALOG = {
  Apple: ['iPhone 17 Pro Max','iPhone 17 Pro','iPhone 17','iPhone 16 Pro Max','iPhone 16 Pro','iPhone 16 Plus','iPhone 16','iPhone 16e','iPhone 15 Pro Max','iPhone 15 Pro','iPhone 15 Plus','iPhone 15','iPhone 14 Pro Max','iPhone 14 Pro','iPhone 14 Plus','iPhone 14','iPhone 13 Pro Max','iPhone 13 Pro','iPhone 13','iPhone 13 mini','iPhone 12 Pro Max','iPhone 12 Pro','iPhone 12','iPhone 11','iPhone SE (2022)'],
  Samsung: ['Galaxy S25 Ultra','Galaxy S25+','Galaxy S25','Galaxy S24 Ultra','Galaxy S24+','Galaxy S24','Galaxy S23 Ultra','Galaxy S23 FE','Galaxy S23','Galaxy S22 Ultra','Galaxy Z Fold6','Galaxy Z Flip6','Galaxy A56','Galaxy A55','Galaxy A54','Galaxy A35','Galaxy A34','Galaxy A25','Galaxy A16','Galaxy A15','Galaxy M55','Galaxy M35','Galaxy M34','Galaxy M14','Galaxy F55','Galaxy F15'],
  OnePlus: ['OnePlus 13','OnePlus 13R','OnePlus 12','OnePlus 12R','OnePlus 11','OnePlus 11R','OnePlus 10 Pro','OnePlus 10R','OnePlus Nord 4','OnePlus Nord 3','OnePlus Nord CE4','OnePlus Nord CE4 Lite','OnePlus Nord CE3','OnePlus Nord CE3 Lite','OnePlus Nord 2T'],
  Xiaomi: ['Xiaomi 15 Ultra','Xiaomi 15','Xiaomi 14 Ultra','Xiaomi 14','Xiaomi 14 Civi','Xiaomi 13 Pro','Xiaomi 12 Pro','Mi 11X'],
  Redmi: ['Redmi Note 14 Pro+','Redmi Note 14 Pro','Redmi Note 14','Redmi Note 13 Pro+','Redmi Note 13 Pro','Redmi Note 13','Redmi Note 12 Pro','Redmi Note 12','Redmi Note 11','Redmi 13 5G','Redmi 12 5G','Redmi 14C','Redmi A3'],
  POCO: ['POCO F7 Pro','POCO F6','POCO F6 Pro','POCO X7 Pro','POCO X7','POCO X6 Pro','POCO X6','POCO X5 Pro','POCO M7 Pro','POCO M6 Pro','POCO C75','POCO C65'],
  Vivo: ['Vivo X200 Pro','Vivo X200','Vivo X100 Pro','Vivo X100','Vivo X90 Pro','Vivo X90','Vivo X80 Pro','Vivo X80','Vivo X70 Pro+','Vivo X60 Pro','Vivo V50','Vivo V40 Pro','Vivo V40','Vivo V40e','Vivo V30 Pro','Vivo V30','Vivo V30e','Vivo V29 Pro','Vivo V29','Vivo V29e','Vivo V27 Pro','Vivo V27','Vivo V25 Pro','Vivo V25','Vivo V23 Pro','Vivo V23 5G','Vivo V21 5G','Vivo V20','Vivo T3 Ultra','Vivo T3 Pro 5G','Vivo T3 5G','Vivo T3x 5G','Vivo T2 Pro 5G','Vivo T2 5G','Vivo T2x 5G','Vivo T1 5G','Vivo T1 Pro','Vivo T1x','Vivo Y300 5G','Vivo Y200 Pro 5G','Vivo Y200e 5G','Vivo Y200 5G','Vivo Y58 5G','Vivo Y56 5G','Vivo Y36','Vivo Y35','Vivo Y28 5G','Vivo Y27','Vivo Y22','Vivo Y21','Vivo Y20','Vivo Y18','Vivo Y17s','Vivo Y16','Vivo Y15','Vivo Y12'],
  OPPO: ['OPPO Find X8 Pro','OPPO Find X8','OPPO Reno13 Pro','OPPO Reno13','OPPO Reno12 Pro','OPPO Reno12','OPPO Reno11 Pro','OPPO Reno11','OPPO F27 Pro+','OPPO F27 Pro','OPPO A79','OPPO A59'],
  Realme: ['Realme GT 7 Pro','Realme GT 6','Realme GT 6T','Realme 14 Pro+','Realme 14 Pro','Realme 13 Pro+','Realme 13 Pro','Realme 12 Pro+','Realme 12 Pro','Realme P3 Pro','Realme P2 Pro','Realme Narzo 70 Pro','Realme C67','Realme C65'],
  Motorola: ['motorola edge 60 Pro','motorola edge 60 Fusion','motorola edge 50 Ultra','motorola edge 50 Pro','motorola edge 50 Fusion','motorola edge 40','moto g85','moto g64','moto g45','moto g35','moto g24','razr 50 Ultra','razr 50'],
  Google: ['Pixel 9 Pro XL','Pixel 9 Pro','Pixel 9','Pixel 9a','Pixel 8 Pro','Pixel 8','Pixel 8a','Pixel 7 Pro','Pixel 7','Pixel 7a','Pixel 6a'],
  Nothing: ['Phone (3)','Phone (3a) Pro','Phone (3a)','Phone (2a) Plus','Phone (2a)','Phone (2)','Phone (1)','CMF Phone 2 Pro','CMF Phone 1'],
  iQOO: ['iQOO 13','iQOO 12','iQOO Neo 10R','iQOO Neo 9 Pro','iQOO Z10','iQOO Z9s Pro','iQOO Z9s','iQOO Z9','iQOO Z7 Pro'],
  Infinix: ['Infinix GT 20 Pro','Infinix Note 40 Pro+','Infinix Note 40 Pro','Infinix Note 40','Infinix Zero 40','Infinix Hot 50','Infinix Smart 8'],
  TECNO: ['TECNO Camon 30 Premier','TECNO Camon 30','TECNO POVA 6 Pro','TECNO POVA 6','TECNO Spark 20 Pro','TECNO Spark 20'],
  Lava: ['Lava Agni 3','Lava Agni 2','Lava Blaze Curve','Lava Blaze X','Lava Blaze 3','Lava Yuva 5G','Lava O2'],
  Nokia: ['Nokia G42','Nokia G21','Nokia C32','Nokia C22','Nokia 5.4','Nokia 6.1 Plus'],
  ASUS: ['ROG Phone 8 Pro','ROG Phone 7','Zenfone 10','ROG Phone 6'],
  HONOR: ['HONOR 200 Pro','HONOR 200','HONOR X9b','HONOR 90']
};
export const CATEGORIES = ['Display & Touch','Battery','Charging Port','Camera','Back Panel','Speaker & Audio','Buttons & Flex','Other'];
const SERVICE_SEED = [
 ['display','Screen & display repair','Cracks, no display, green lines or touch issues. We inspect the panel and explain compatible replacement choices.','monitor-smartphone','Most requested'],
 ['battery','Battery replacement','Fast drain, unexpected shutdowns, swollen batteries or charging that will not last.','battery-charging',''],
 ['charging','Charging & port repair','Loose charging ports, interrupted charging, connector damage and charging-circuit diagnosis.','plug-zap',''],
 ['water','Liquid damage assessment','A device exposed to liquid needs careful inspection. Outcomes depend on the damage found.','droplets',''],
 ['camera','Camera & lens repair','Blurry shots, broken camera glass, focus problems and camera module issues.','camera',''],
 ['speaker','Speaker & microphone repair','Crackling sound, weak audio, microphone faults and earpiece problems.','volume-2',''],
 ['software','Software troubleshooting','Boot loops, frozen screens, OS problems and device setup or backup guidance.','settings-2',''],
 ['backglass','Back panel & body repair','Broken back glass, damaged frames, loose buttons and cosmetic component replacement.','layers-3','']
];
const PRODUCT_SEED = [
 ['OLED Display Assembly','Samsung','Galaxy S24','Display & Touch','Compatible option',5799,8,'display'],
 ['Battery Replacement Pack','Apple','iPhone 13','Battery','Compatible option',1999,12,'battery'],
 ['Charging Port Flex','OnePlus','OnePlus 12R','Charging Port','Compatible option',799,16,'port'],
 ['AMOLED Display Module','Redmi','Redmi Note 13 Pro','Display & Touch','Compatible option',2599,11,'display'],
 ['Back Panel Replacement','Apple','iPhone 14','Back Panel','Compatible option',1399,9,'panel'],
 ['Front Camera Module','Realme','Realme 12 Pro+','Camera','Compatible option',1199,7,'camera'],
 ['Battery Replacement Pack','Vivo','Vivo V30','Battery','Compatible option',1199,10,'battery'],
 ['Loudspeaker Module','OPPO','OPPO Reno11','Speaker & Audio','Compatible option',649,15,'speaker'],
 ['USB-C Charging Sub-board','POCO','POCO X6 Pro','Charging Port','Compatible option',849,7,'port'],
 ['LCD Display Assembly','Motorola','moto g85','Display & Touch','Compatible option',2399,6,'display'],
 ['Battery Replacement Pack','Google','Pixel 8','Battery','Compatible option',2599,5,'battery'],
 ['Back Panel Replacement','Nothing','Phone (2a)','Back Panel','Compatible option',1299,6,'panel'],
 ['Rear Camera Lens Glass','iQOO','iQOO 12','Camera','Compatible option',499,14,'camera'],
 ['Power Button Flex Cable','Samsung','Galaxy A54','Buttons & Flex','Compatible option',399,18,'flex'],
 ['AMOLED Display Assembly','OnePlus','OnePlus 11R','Display & Touch','Compatible option',4399,7,'display'],
 ['Charging Port Flex','Apple','iPhone 12','Charging Port','Compatible option',1099,11,'port'],
 ['Battery Replacement Pack','Redmi','Redmi Note 12','Battery','Compatible option',999,12,'battery'],
 ['Ear Speaker Module','Apple','iPhone 11','Speaker & Audio','Compatible option',749,10,'speaker'],
 ['Display Assembly','Infinix','Infinix Hot 50','Display & Touch','Compatible option',1899,7,'display'],
 ['Back Panel Replacement','Lava','Lava Agni 2','Back Panel','Compatible option',899,5,'panel']
];
export function openDatabase(dir = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/data' : join(process.cwd(),'data'))) {
 mkdirSync(dir,{recursive:true});
 const dbPath = join(dir,'repairlylabs.sqlite');
 if (!existsSync(dbPath) && process.env.VERCEL) {
  const seedFile = join(process.cwd(),'data','repairlylabs.sqlite');
  if (existsSync(seedFile)) {
   try { copyFileSync(seedFile, dbPath); } catch {}
  }
 }
 const db = new DatabaseSync(dbPath);
 db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS devices(id INTEGER PRIMARY KEY, brand TEXT NOT NULL, model TEXT NOT NULL, UNIQUE(brand,model));
 CREATE INDEX IF NOT EXISTS idx_devices_brand ON devices(brand);
 CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,description TEXT NOT NULL,icon TEXT NOT NULL DEFAULT 'wrench',tag TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,sku TEXT UNIQUE NOT NULL,name TEXT NOT NULL,brand TEXT NOT NULL,model TEXT NOT NULL,category TEXT NOT NULL,grade TEXT NOT NULL DEFAULT 'Ask for details',price INTEGER NOT NULL CHECK(price>=0),stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),active INTEGER NOT NULL DEFAULT 1,featured INTEGER NOT NULL DEFAULT 0,sample INTEGER NOT NULL DEFAULT 1,description TEXT NOT NULL DEFAULT '',image_kind TEXT NOT NULL DEFAULT 'display',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS idx_products_search ON products(brand,category,active);
 CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY,ref TEXT UNIQUE NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL,brand TEXT NOT NULL,model TEXT NOT NULL,issue TEXT NOT NULL,method TEXT NOT NULL,date TEXT NOT NULL DEFAULT '',locality TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',quote INTEGER,admin_note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS idx_bookings_ref ON bookings(ref,phone);
 CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,ref TEXT UNIQUE NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL,locality TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',mode TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',subtotal INTEGER NOT NULL,admin_note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS idx_orders_ref ON orders(ref,phone);
 CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),product_id INTEGER NOT NULL REFERENCES products(id),sku TEXT NOT NULL,name TEXT NOT NULL,unit_price INTEGER NOT NULL,quantity INTEGER NOT NULL,sample INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS contacts(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',message TEXT NOT NULL,read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS admins(username TEXT PRIMARY KEY,password_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,username TEXT NOT NULL REFERENCES admins(username),csrf TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,username TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
 // Non-destructive schema migration for installations created before consent logging.
 for(const table of ['bookings','orders','contacts']){
  if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='consent_at')) db.exec(`ALTER TABLE ${table} ADD COLUMN consent_at TEXT NOT NULL DEFAULT ''`);
 }
 const bookingColumns=new Set(db.prepare('PRAGMA table_info(bookings)').all().map(c=>c.name));
 for(const [key,definition] of Object.entries({email:"TEXT NOT NULL DEFAULT ''",pin:"TEXT NOT NULL DEFAULT ''",slot:"TEXT NOT NULL DEFAULT ''",whatsapp:'INTEGER NOT NULL DEFAULT 0'}))if(!bookingColumns.has(key))db.exec(`ALTER TABLE bookings ADD COLUMN ${key} ${definition}`);
 db.exec(`UPDATE devices SET brand='Vivo' WHERE brand COLLATE NOCASE = 'vivo'; UPDATE devices SET brand='Realme' WHERE brand COLLATE NOCASE = 'realme'; UPDATE products SET brand='Vivo' WHERE brand COLLATE NOCASE = 'vivo'; UPDATE products SET brand='Realme' WHERE brand COLLATE NOCASE = 'realme';`);
 seed(db); db.prepare("UPDATE settings SET value=? WHERE key='terms' AND value=?").run(DEFAULT_SETTINGS.terms,'Parts are confirmed for compatibility, stock, and final pricing before fulfillment. Repair quotations follow inspection. No payment is collected online.');return db;
}
function seed(db) {
 const putSetting=db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
 for(const [key,value] of Object.entries(DEFAULT_SETTINGS)) putSetting.run(key,value);
 const putDevice=db.prepare('INSERT OR IGNORE INTO devices(brand,model) VALUES(?,?)');
 for(const [brand,models] of Object.entries(CATALOG)) for(const model of models) putDevice.run(brand,model);
 if(db.prepare('SELECT COUNT(*) AS n FROM services').get().n===0){
  const stmt=db.prepare('INSERT INTO services(slug,title,description,icon,tag,sort_order) VALUES(?,?,?,?,?,?)');
  SERVICE_SEED.forEach((s,i)=>stmt.run(...s,i));
 }
 if(db.prepare('SELECT COUNT(*) AS n FROM products').get().n===0){
  const stmt=db.prepare('INSERT INTO products(sku,name,brand,model,category,grade,price,stock,featured,sample,image_kind,description) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  PRODUCT_SEED.forEach((p,i)=>stmt.run('DEMO-'+String(i+1).padStart(3,'0'),p[0],p[1],p[2],p[3],p[4],p[5],p[6],Number(i<6),1,p[7],'Illustrative spare-part listing. Staff must verify exact device variant, component grade, price, stock and warranty before confirmation.'));
 }
}
export function getSettings(db){return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(({key,value})=>[key,value]));}
export function passwordHash(password){const salt=randomBytes(16).toString('hex'); const hash=scryptSync(password,salt,64).toString('hex'); return `${salt}:${hash}`;}
export function verifyPassword(password,stored){try {const [salt,hex]=stored.split(':'); const a=scryptSync(password,salt,64), b=Buffer.from(hex,'hex');return a.length===b.length&&timingSafeEqual(a,b);}catch{return false;}}
export function hashToken(token){return createHash('sha256').update(token).digest('hex');}
export function randomToken(bytes=32){return randomBytes(bytes).toString('base64url');}
export function publicRef(kind){return `${kind}-${new Date().toISOString().slice(2,10).replace(/-/g,'')}-${randomBytes(4).toString('hex').toUpperCase()}`;}
export { CATALOG, DEFAULT_SETTINGS };
