/**
 * jsonDB.js - JSON Database Utility
 * Semua operasi baca/tulis ke file JSON
 */

const fs = require('fs');
const path = require('path');

class JsonDB {
  constructor(filePath, defaultData = {}) {
    this.filePath = path.resolve(filePath);
    this.defaultData = defaultData;
    this._ensureFile();
  }

  _ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(this.defaultData, null, 2), 'utf8');
    }
  }

  read() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { ...this.defaultData };
    }
  }

  write(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    return data;
  }

  get(key) {
    const data = this.read();
    return data[key] !== undefined ? data[key] : null;
  }

  set(key, value) {
    const data = this.read();
    data[key] = value;
    this.write(data);
    return value;
  }

  update(key, updates) {
    const data = this.read();
    if (!data[key]) data[key] = {};
    data[key] = { ...data[key], ...updates };
    this.write(data);
    return data[key];
  }

  delete(key) {
    const data = this.read();
    delete data[key];
    this.write(data);
  }

  getAll() {
    return this.read();
  }

  find(predicate) {
    const data = this.read();
    return Object.values(data).filter(v => typeof v === 'object' && predicate(v));
  }

  findOne(predicate) {
    const data = this.read();
    return Object.values(data).find(v => typeof v === 'object' && predicate(v)) || null;
  }

  count() {
    return Object.keys(this.read()).length;
  }

  exists(key) {
    return key in this.read();
  }

  // Nested path support: get('ppob.pulsa')
  getPath(dotPath) {
    const keys = dotPath.split('.');
    let obj = this.read();
    for (const k of keys) {
      if (obj == null || typeof obj !== 'object') return null;
      obj = obj[k];
    }
    return obj !== undefined ? obj : null;
  }

  setPath(dotPath, value) {
    const keys = dotPath.split('.');
    const data = this.read();
    let obj = data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this.write(data);
    return value;
  }

  updatePath(dotPath, updates) {
    const existing = this.getPath(dotPath) || {};
    return this.setPath(dotPath, { ...existing, ...updates });
  }
}

// ─── Singleton Instances ───────────────────────────────────────────────────────

const usersDB = new JsonDB('./bot/database/users.json', {});

const transactionsDB = new JsonDB('./bot/database/transactions.json', {});

const productsDB = new JsonDB('./bot/database/products.json', {
  game: {},
  ppob: {
    pulsa: {}, data: {}, pln_prepaid: {}, pln_postpaid: {},
    pdam: {}, internet: {}, tv: {}, ewallet: {},
    voucher: {}, etoll: {}, bpjs: {}, pendidikan: {}, lainnya: {}
  },
  _meta: { last_sync: null, total_products: 0 }
});

const resellerDB = new JsonDB('./bot/database/reseller.json', {});

module.exports = { JsonDB, usersDB, transactionsDB, productsDB, resellerDB };
