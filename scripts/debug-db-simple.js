const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'pbp_restaurants.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log('Tables:', tables);
        tables.forEach(table => {
            db.get(`SELECT COUNT(*) as count FROM ${table.name}`, (err, row) => {
                if (err) {
                    console.error(`Error counting ${table.name}:`, err.message);
                } else {
                    console.log(`${table.name} count:`, row.count);
                }
            });
        });
    });
});

db.close();
