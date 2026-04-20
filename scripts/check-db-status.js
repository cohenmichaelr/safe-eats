const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.join(__dirname, '..', 'pbp_restaurants.db');

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

db.serialize(() => {
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='restaurants'", (err, row) => {
        if (row) {
            db.get("SELECT COUNT(*) as count FROM restaurants", (err, row) => {
                console.log(`Restaurants count: ${row.count}`);
            });
        } else {
            console.log('Table "restaurants" does not exist.');
        }
    });

    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='food_entities'", (err, row) => {
        if (row) {
            db.get("SELECT COUNT(*) as count FROM food_entities", (err, row) => {
                console.log(`Food entities count: ${row.count}`);
            });
        } else {
            console.log('Table "food_entities" does not exist.');
        }
    });
});

db.close();
