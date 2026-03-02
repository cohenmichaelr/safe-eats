const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = path.join(__dirname, '../data');
const DB_PATH = path.join(__dirname, '../inspections.db');

async function run() {
    console.log('--- Florida Inspection DB Importer ---');
    
    const db = new sqlite3.Database(DB_PATH);

    // 1. Create Table
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS inspections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            address TEXT,
            city TEXT,
            date TEXT,
            type TEXT,
            status TEXT,
            violations INTEGER
        )`);
        
        db.run(`CREATE INDEX IF NOT EXISTS idx_name ON inspections(name)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_city ON inspections(city)`);
    });

    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'));
    
    if (files.length === 0) {
        console.log('No CSV files found in data folder. Please download them first!');
        db.close();
        return;
    }

    console.log(`Found ${files.length} files. Starting import...`);

    for (const file of files) {
        const filePath = path.join(DATA_DIR, file);
        const stats = fs.statSync(filePath);
        
        if (stats.size < 1000000) {
            console.log(`Skipping ${file} (too small, likely an HTML block page)`);
            continue;
        }

        console.log(`Processing ${file}...`);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('
');
        
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            const stmt = db.prepare('INSERT INTO inspections (name, address, city, date, type, status, violations) VALUES (?, ?, ?, ?, ?, ?, ?)');
            
            let count = 0;
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                if (!line || line.trim() === '') continue;
                
                // Very basic CSV split (FL DBPR uses standard comma separation)
                const cols = line.split(',');
                if (cols.length < 10) continue;

                stmt.run(
                    cols[1], // Name
                    cols[2], // Address
                    cols[3], // City
                    cols[7], // Date
                    cols[8], // Type
                    cols[9], // Status
                    parseInt(cols[10]) || 0 // Violations
                );
                count++;
            }
            stmt.finalize();
            db.run('COMMIT');
            console.log(`Imported ${count} records from ${file}.`);
        });
    }

    console.log('
Import complete! Your database is ready.');
    // db.close(); // Closed automatically by process exit
}

run();
