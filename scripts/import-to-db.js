const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = path.join(__dirname, '../data');
const DB_PATH = path.join(__dirname, '../pbp_restaurants.db');

async function run() {
    console.log('--- Florida Inspection DB Importer (Fixed) ---');
    
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    
    const db = new sqlite3.Database(DB_PATH);

    // Ensure the table exists with the correct schema
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS restaurants (
            id TEXT PRIMARY KEY,
            county TEXT,
            name TEXT,
            address TEXT,
            city TEXT,
            zip TEXT,
            type TEXT,
            url TEXT,
            status TEXT,
            last_inspection_date TEXT,
            violation_count INTEGER,
            latitude REAL,
            longitude REAL
        )`);
        
        db.run(`CREATE INDEX IF NOT EXISTS idx_name ON restaurants(name)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_county ON restaurants(county)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_city ON restaurants(city)`);
    });

    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'));
    
    if (files.length === 0) {
        console.log('No CSV files found in data folder.');
        db.close();
        return;
    }

    console.log(`Found ${files.length} files. Starting import...`);

    for (const file of files) {
        const filePath = path.join(DATA_DIR, file);
        
        // Skip HTML-as-CSV error files
        const contentSample = fs.readFileSync(filePath, 'utf8').substring(0, 100);
        if (contentSample.trim().startsWith('<!DOCTYPE')) {
            console.log(`Skipping ${file} (HTML error page detected)`);
            continue;
        }

        console.log(`Processing ${file}...`);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const header = lines[0].split(',');
        
        const isOldFormat = header.includes('DBA_NAME') && header.includes('LOC_ADDRESS');

        await new Promise((resolve) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO restaurants 
                    (id, name, address, city, zip, county, type, status, last_inspection_date, violation_count, url) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                
                let count = 0;
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i];
                    if (!line || line.trim() === '') continue;
                    
                    // Handle quoted CSV values
                    const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
                    
                    let id, name, address, city, zip, county, type, lastDate, status, violations;

                    if (isOldFormat) {
                        if (cols.length < 82) continue;
                        id = cols[81]; // LIC_ID
                        name = (cols[5] || 'UNKNOWN').toUpperCase();
                        address = (cols[6] || 'UNKNOWN').toUpperCase();
                        city = (cols[7] || '').toUpperCase();
                        zip = cols[8] || '';
                        county = (cols[2] || '').toLowerCase().replace(/\s+/g, '-');
                        
                        // Map Profession Code
                        const profCode = cols[3];
                        let profName = 'Restaurant';
                        if (profCode === '2010') profName = 'Seating';
                        else if (profCode === '2011') profName = 'No Seating';
                        else if (profCode === '2012') profName = 'Mobile Food';
                        else if (profCode === '2013') profName = 'Catering';
                        else if (profCode === '2014') profName = 'Temporary Food';
                        else if (profCode === '2015') profName = 'Vending';
                        
                        type = profName;
                        lastDate = cols[14] || '';
                        status = cols[13] || 'Unknown';
                        violations = parseInt(cols[17]) || 0;
                    } else {
                        if (cols.length < 8) continue;
                        id = cols[0];
                        name = (cols[1] || 'UNKNOWN').toUpperCase();
                        address = (cols[2] || 'UNKNOWN').toUpperCase();
                        city = cols[3] ? cols[3].toUpperCase() : '';
                        zip = cols[4] || '';
                        county = cols[5] ? cols[5].toLowerCase().replace(/\s+/g, '-') : '';
                        type = cols[6] || 'Restaurant';
                        lastDate = cols[7];
                        status = cols[8] || 'Unknown';
                        violations = parseInt(cols[9]) || 0;
                    }

                    if (!id) continue;

                    const profileUrl = `https://www.myfloridalicense.com/inspections.asp?id=${id}`;
                    stmt.run(id, name, address, city, zip, county, type, status, lastDate, violations, profileUrl);
                    count++;
                }
                stmt.finalize();
                db.run('COMMIT', () => {
                    console.log(`Imported/Updated ${count} records from ${file}.`);
                    resolve();
                });
            });
        });
    }

    console.log('\nImport complete! Primary database updated.');
    db.close();
}

run();
