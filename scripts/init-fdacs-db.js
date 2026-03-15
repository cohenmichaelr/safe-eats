const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../pbp_restaurants.db');

async function initFDACS() {
    const db = new sqlite3.Database(DB_PATH);
    
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            console.log('--- Initializing FDACS Table ---');
            
            // Create the food_entities table
            db.run(`CREATE TABLE IF NOT EXISTS food_entities (
                id TEXT PRIMARY KEY,
                name TEXT,
                address TEXT,
                city TEXT,
                zip TEXT,
                county TEXT,
                status TEXT,
                last_inspection_date TEXT,
                url TEXT,
                latitude REAL,
                longitude REAL
            )`, (err) => {
                if (err) return reject(err);
            });

            db.run(`CREATE INDEX IF NOT EXISTS idx_fe_name ON food_entities(name)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_fe_county ON food_entities(county)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_fe_city ON food_entities(city)`);
            
            console.log('✅ food_entities table created successfully.');
            db.close();
            resolve();
        });
    });
}

initFDACS().catch(err => {
    console.error('Error initializing FDACS table:', err.message);
    process.exit(1);
});
