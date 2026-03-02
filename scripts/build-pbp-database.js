const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../pbp_restaurants.db');
const COUNTIES = ['palm-beach', 'broward', 'miami-dade'];

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
                status TEXT
            )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_county ON restaurants(county)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_name ON restaurants(name)`);
            resolve(db);
        });
    });
}

async function scrapeCounty(db, county) {
    console.log(`\n--- Starting Headless Crawl for ${county.toUpperCase()} ---`);
    const browser = await puppeteer.launch({ headless: "new" });
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

            const pageData = await page.evaluate(() => {
                const results = [];
                const rows = Array.from(document.querySelectorAll('table tr')).slice(1);
                
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 4) return;
                    
                    // Column 0 contains BOTH name and address in this format:
                    // <a href="..."><b>NAME</b></a><br><span class="xsmall">ADDRESS</span>
                    const mainCell = cells[0];
                    const nameLink = mainCell.querySelector('a');
                    const addressSpan = mainCell.querySelector('span.xsmall');
                    const statusCell = cells[2]; // Index 2 is Disposition in county list
                    
                    if (!nameLink) return;

                    const href = nameLink.getAttribute('href');
                    // ID is the last numeric part of the URL
                    const match = href.match(/\/(\d+)\/$/);
                    const id = match ? match[1] : href;

                    results.push({
                        id: id,
                        name: nameLink.innerText.trim().toUpperCase(),
                        url: `https://data.palmbeachpost.com${href}`,
                        address: addressSpan ? addressSpan.innerText.trim().toUpperCase() : 'UNKNOWN',
                        status: statusCell ? statusCell.innerText.trim() : 'Satisfactory'
                    });
                });
                return results;
            });

            if (pageData.length === 0) {
                keepGoing = false;
                break;
            }

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                const stmt = db.prepare('INSERT OR REPLACE INTO restaurants (id, county, name, address, url, status) VALUES (?, ?, ?, ?, ?, ?)');
                for (const r of pageData) {
                    stmt.run(r.id, county, r.name, r.address, r.url, r.status);
                }
                stmt.finalize();
                db.run('COMMIT');
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
