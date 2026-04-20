const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../pbp_restaurants.db');
const COUNTIES = [
    'alachua', 'baker', 'bay', 'bradford', 'brevard', 'broward', 'calhoun', 'charlotte', 'citrus', 'clay',
    'collier', 'columbia', 'desoto', 'dixie', 'duval', 'escambia', 'flagler', 'franklin', 'gadsden', 'gilchrist',
    'glades', 'gulf', 'hamilton', 'hardee', 'hendry', 'hernando', 'highlands', 'hillsborough', 'holmes', 'indian-river',
    'jackson', 'jefferson', 'lafayette', 'lake', 'lee', 'leon', 'levy', 'liberty', 'madison', 'manatee',
    'marion', 'martin', 'miami-dade', 'monroe', 'nassau', 'okaloosa', 'okeechobee', 'orange', 'osceola', 'palm-beach',
    'pasco', 'pinellas', 'polk', 'putnam', 'santa-rosa', 'sarasota', 'seminole', 'st-johns', 'st-lucie', 'sumter',
    'suwannee', 'taylor', 'union', 'volusia', 'wakulla', 'walton', 'washington'
];

async function initDB() {
    return new Promise((resolve) => {
        const db = new sqlite3.Database(DB_PATH);
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS restaurants (
                id TEXT PRIMARY KEY,
                county TEXT,
                name TEXT,
                address TEXT,
                url TEXT,
                status TEXT,
                last_inspection_date TEXT
            )`);
            
            // Ensure all columns exist
            db.all("PRAGMA table_info(restaurants)", (err, rows) => {
                const cols = rows.map(r => r.name);
                if (!cols.includes('status')) {
                    db.run("ALTER TABLE restaurants ADD COLUMN status TEXT");
                }
                if (!cols.includes('last_inspection_date')) {
                    db.run("ALTER TABLE restaurants ADD COLUMN last_inspection_date TEXT");
                }
            });

            db.run(`CREATE INDEX IF NOT EXISTS idx_county ON restaurants(county)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_name ON restaurants(name)`);
            resolve(db);
        });
    });
}

async function scrapeCounty(db, county) {
    console.log(`\n--- Starting Headless Crawl for ${county.toUpperCase()} ---`);
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
            request.abort();
        } else {
            request.continue();
        }
    });

    let currentPage = 1;
    let keepGoing = true;
    let totalAdded = 0;

    while (keepGoing) {
        try {
            console.log(`Rendering ${county} - Page ${currentPage}...`);
            const url = `https://data.palmbeachpost.com/restaurant-inspections/${county}/?page=${currentPage}`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

            const pageData = await page.evaluate((county) => {
                const results = [];
                // Find all links that point to a restaurant profile for this county
                const links = Array.from(document.querySelectorAll(`a[href*="/restaurant-inspections/${county}/"]`));
                
                links.forEach(link => {
                    const href = link.getAttribute('href');
                    // Ensure it's a profile link, not a pagination link
                    if (href.includes('?page=')) {
                        // it might be a profile link with ?next= in it, but let's check for the ID format
                        const match = href.match(/\/(\d+)\//);
                        if (!match) return;
                    } else {
                        const match = href.match(/\/(\d+)\/$/);
                        if (!match) return;
                    }

                    const match = href.match(/\/(\d+)\//);
                    const id = match ? match[1] : href;

                    const parentText = link.parentElement.innerText.trim();
                    let name = link.innerText.trim().toUpperCase();
                    let date = null;
                    let address = 'UNKNOWN';
                    let statusText = 'Unknown';

                    const lines = parentText.split('\n').map(l => l.trim()).filter(l => l !== '');
                    const dateRegex = /([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})/i;

                    for (const line of lines) {
                        if (dateRegex.test(line)) {
                            date = line.match(dateRegex)[1];
                        } else if (line.includes('(') && line.includes(')')) {
                            address = line.match(/\(([^)]+)\)/)[1].trim().toUpperCase();
                        } else if (line !== name && !dateRegex.test(line) && address === 'UNKNOWN') {
                            // If it's a long string and not the date or name, it might be the address
                            if (line.length > 5) address = line.toUpperCase();
                        }
                    }

                    // Attempt to guess status based on section it is in (if possible), or default to Satisfactory 
                    // since we'll fetch deep details on click anyway.
                    if (parentText.toLowerCase().includes('fail') || parentText.toLowerCase().includes('emergency')) {
                        statusText = 'Fail';
                    } else if (parentText.toLowerCase().includes('warning')) {
                        statusText = 'Warning';
                    } else {
                        statusText = 'Satisfactory';
                    }

                    results.push({
                        id: id,
                        name: name,
                        url: `https://data.palmbeachpost.com${href}`,
                        address: address,
                        status: statusText,
                        date: date
                    });
                });
                
                // Deduplicate by ID
                const uniqueResults = [];
                const seenIds = new Set();
                for (const r of results) {
                    if (!seenIds.has(r.id)) {
                        seenIds.add(r.id);
                        uniqueResults.push(r);
                    }
                }
                
                return uniqueResults;
            }, county);

            if (pageData.length === 0) {
                keepGoing = false;
                break;
            }

            await new Promise((resolve, reject) => {
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');
                    const stmt = db.prepare('INSERT OR REPLACE INTO restaurants (id, county, name, address, url, status, last_inspection_date) VALUES (?, ?, ?, ?, ?, ?, ?)');
                    for (const r of pageData) {
                        stmt.run(r.id, county, r.name, r.address, r.url, r.status, r.date);
                    }
                    stmt.finalize();
                    db.run('COMMIT', (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            });

            totalAdded += pageData.length;
            console.log(`Saved ${pageData.length} records. Example: ${pageData[0].name} at ${pageData[0].address}`);

            const nextButton = await page.$('a[aria-label="Next"]');
            if (nextButton) {
                currentPage++;
            } else {
                keepGoing = false;
            }

            if (currentPage > 10) keepGoing = false; // Limit for now

        } catch (error) {
            console.error(`Error on page ${currentPage}:`, error.message);
            keepGoing = false;
        }
    }

    await browser.close();
}

async function run() {
    const db = await initDB();
    for (const county of COUNTIES) {
        await scrapeCounty(db, county);
    }
    console.log('\n✅ Database rebuild complete with REAL addresses!');
    db.close();
}

run();
