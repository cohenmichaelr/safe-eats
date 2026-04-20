const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'pbp_restaurants.db');
const db = new sqlite3.Database(dbPath);

const columns = [
    { name: 'city', type: 'TEXT' },
    { name: 'zip', type: 'TEXT' },
    { name: 'type', type: 'TEXT' },
    { name: 'violation_count', type: 'INTEGER' }
];

function runMigration() {
    return new Promise((resolve, reject) => {
        db.all("PRAGMA table_info(restaurants)", (err, rows) => {
            if (err) return reject(err);
            const existing = rows.map(r => r.name);
            const needed = columns.filter(col => !existing.includes(col.name));
            
            if (needed.length === 0) {
                console.log('No migration needed.');
                return resolve();
            }

            let completed = 0;
            needed.forEach(col => {
                console.log(`Adding ${col.name} to restaurants...`);
                db.run(`ALTER TABLE restaurants ADD COLUMN ${col.name} ${col.type}`, (err) => {
                    if (err) console.error(`Error adding ${col.name}:`, err.message);
                    completed++;
                    if (completed === needed.length) resolve();
                });
            });
        });
    });
}

runMigration()
    .then(() => {
        db.close();
        console.log('Migration finished.');
    })
    .catch(err => {
        console.error('Migration failed:', err);
        db.close();
    });
