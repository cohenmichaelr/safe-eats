const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.join(__dirname, '..', 'pbp_restaurants.db');

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
    if (err) {
        console.error('Error listing tables:', err.message);
        db.close();
        return;
    }

    console.log('Tables in database:', tables.map(t => t.name).join(', '));

    tables.forEach(table => {
        db.get(`SELECT COUNT(*) as count FROM ${table.name}`, (err, row) => {
            if (err) {
                console.error(`Error counting ${table.name}:`, err.message);
            } else {
                console.log(`${table.name} count: ${row.count}`);
            }
        });
    });
    
    // Check first few rows of restaurants if it exists
    if (tables.some(t => t.name === 'restaurants')) {
        db.all("SELECT * FROM restaurants LIMIT 5", (err, rows) => {
            if (rows && rows.length > 0) {
                console.log('\nSample from restaurants:');
                console.log(JSON.stringify(rows, null, 2));
            }
        });
    }

    // Give it a bit of time to complete async operations before closing
    setTimeout(() => {
        db.close();
    }, 1000);
});
