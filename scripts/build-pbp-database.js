const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../pbp_restaurants.db');
const COUNTIES = ['palm-beach']; // Focusing on Palm Beach for the demo

async function initDB() {
    return new Promise((resolve) => {
        const db = new sqlite3.Database(DB_PATH);
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS restaurants (
                id TEXT PRIMARY KEY,
                county TEXT,
                name TEXT,
                address TEXT,
                url TEXT
            )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_county ON restaurants(county)`);
            resolve(db);
        });
    });
}

async function scrapeCounty(db, county) {
    console.log(`\n--- Starting Headless Crawl for ${county.toUpperCase()} ---`);
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    // Block unnecessary resources to speed up crawling
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

            // Extract links from the page using DOM evaluation
            const pageData = await page.evaluate(() => {
                const results = [];
                // Find all links that look like a restaurant profile
                const links = document.querySelectorAll('a[href*="/restaurant-inspections/"]');
                
                links.forEach(link => {
                    const href = link.getAttribute('href');
                    // Check if it matches the profile pattern /county/slug/license/id/
                    const match = href.match(/\/restaurant-inspections\/[^\/]+\/[^\/]+\/[^\/]+\/(\d+)\//);
                    if (match) {
                        // Attempt to find the address (usually near the link in modern layouts)
                        let address = 'UNKNOWN';
                        let currentElement = link.parentElement;
                        // Search up to 3 levels up for text that looks like an address
                        for(let i=0; i<3; i++) {
                           if(currentElement) {
                               const text = currentElement.innerText;
                               // Basic heuristic: contains a number and is longer than the name
                               if (/\d/.test(text) && text.length > link.innerText.length) {
                                   address = text.replace(link.innerText, '').trim();
                                   break;
                               }
                               currentElement = currentElement.parentElement;
                           }
                        }

                        results.push({
                            id: match[1],
                            name: link.innerText.trim().toUpperCase(),
                            url: `https://data.palmbeachpost.com${href}`,
                            address: address.toUpperCase()
                        });
                    }
                });
                return results;
            });

            // De-duplicate results on the page
            const uniqueResults = [];
            const seenIds = new Set();
            for (const item of pageData) {
                if (!seenIds.has(item.id)) {
                    seenIds.add(item.id);
                    uniqueResults.push(item);
                }
            }

            if (uniqueResults.length === 0) {
                console.log(`No more restaurants found. Stopping.`);
                keepGoing = false;
                break;
            }

            // Save to DB
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                const stmt = db.prepare('INSERT OR REPLACE INTO restaurants (id, county, name, address, url) VALUES (?, ?, ?, ?, ?)');
                for (const r of uniqueResults) {
                    stmt.run(r.id, county, r.name, r.address, r.url);
                }
                stmt.finalize();
                db.run('COMMIT');
            });

            totalAdded += uniqueResults.length;
            console.log(`Found ${uniqueResults.length} unique profiles on this page.`);

            // Check for pagination (Next button)
            const nextButton = await page.$('a[aria-label="Next"]');
            if (nextButton) {
                currentPage++;
            } else {
                console.log(`No "Next" button found. Finished ${county}. Total recorded: ${totalAdded}`);
                keepGoing = false;
            }

            // Safety limit
            if (currentPage > 3) {
                console.log(`[Demo] Stopping at page 3. Total recorded: ${totalAdded}`);
                keepGoing = false;
            }

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
    console.log('\n✅ Database build complete!');
    db.close();
}

run();
