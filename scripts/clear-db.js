const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'pbp_restaurants.db');
const db = new sqlite3.Database(dbPath);

db.run("DELETE FROM restaurants", (err) => {
    if (err) console.error(err);
    else console.log('Cleared restaurants table.');
    db.close();
});
