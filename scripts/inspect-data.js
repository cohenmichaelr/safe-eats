const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'pbp_restaurants.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.get("SELECT COUNT(*) as count FROM restaurants", (err, row) => {
        console.log('Restaurants count:', row ? row.count : 'Error');
    });
    db.get("SELECT COUNT(*) as count FROM food_entities", (err, row) => {
        console.log('Food Entities count:', row ? row.count : 'Error');
    });
    db.all("SELECT * FROM restaurants LIMIT 3", (err, rows) => {
        console.log('Sample Restaurants:', rows);
    });
});

db.close();
