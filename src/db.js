var sqlite3 = require("sqlite3").verbose();
const debug = require("debug");

const d = debug("d:-KVDB");

module.exports = class KVDB {
  constructor(path) {
    this._db = new sqlite3.Database(path);
    this._db.serialize(() => {
      this._db.run(`CREATE TABLE IF NOT EXISTS "kv" (
                "key"	TEXT NOT NULL UNIQUE,
                "value"	TEXT,
                PRIMARY KEY("key")
            );`);
    });
    d("constructed...");
  }

  cleanDB() {
    return new Promise((resolve, reject) => {
      this._db.serialize(() => {
        this._db.run(
          `DROP table if exists "kv";
        CREATE TABLE IF NOT EXISTS "kv" (
            "key"	TEXT NOT NULL UNIQUE,
            "value"	TEXT,
            PRIMARY KEY("key")
        );`,
          resolve
        );
      });
    });
  }

  saveMany(kvArray) {
    return new Promise((resolve, reject) => {
      this._db.serialize(() => {
        d("saveMany --> %d", kvArray.length);
        var stmt = this._db.prepare("INSERT OR REPLACE INTO kv VALUES (?, ?)");
        for (const kv of kvArray) {
          d("save key: %s", kv.key);
          stmt.run([kv.key, kv.value]);
        }
        stmt.finalize();
        d("ok");
        resolve();
      });
    });
  }

  close() {
    return new Promise(async res => {
      await this._db.close(res);
      d("db closed.");
    });
  }
};
