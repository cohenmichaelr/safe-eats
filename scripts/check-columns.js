const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'pbp_restaurants.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.all("PRAGMA table_info(restaurants)", (err, rows) => {
        console.log('Columns in restaurants:', rows.map(r => `${r.name} (${r.type})`));
    });
    db.all("PRAGMA table_info(food_entities)", (err, rows) => {
        console.log('Columns in food_entities:', rows.map(r => `${r.name} (${r.type})`));
    });
});

db.close();
