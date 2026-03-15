const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../pbp_restaurants.db');

/**
 * FDACS (Florida Department of Agriculture and Consumer Services) Adapter
 * Regulates grocery stores, convenience stores, and food processors.
 */
const getFullRecord = async (businessName, address, details = {}) => {
    try {
        const targetName = businessName.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
        const city = (details.city || '').toUpperCase();
        
        // STEP 1: Search the local food_entities table
        const localMatch = await searchLocalFE(targetName, city, address);
        if (localMatch) {
            console.log(`[FDACS Adapter] Local FE HIT: ${localMatch.url}`);
            return await fetchHistoryWithPuppeteer(localMatch.url, businessName, address);
        }

        // STEP 2: Fallback to live scrape
        console.log(`[FDACS Adapter] Local FE MISS: Performing live scrape...`);
        return await performLiveScrape(businessName, address, details);

    } catch (error) {
        console.error('[FDACS Adapter Error]:', error.message);
        return { status: 'Not Found' };
    }
};

async function searchLocalFE(name, city, address) {
    return new Promise((resolve) => {
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
        const firstWord = name.split(' ')[0] + '%';
        
        let query = 'SELECT * FROM food_entities WHERE name LIKE ?';
        let params = [firstWord];

        if (city) {
            query += ' AND city = ?';
            params.push(city);
        }

        db.get(query, params, (err, row) => {
            db.close();
            if (err) resolve(null);
            else resolve(row);
        });
    });
}

async function performLiveScrape(businessName, address, details) {
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
        
        const url = 'https://foodpermit.fdacs.gov/Reports/SearchFoodEntity.aspx';
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        await page.type('#MainContent_txtEntityName', businessName);
        if (details.city) await page.type('#MainContent_txtCity', details.city);
        
        await Promise.all([
            page.click('#MainContent_btnSearch'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
        ]);

        const results = await page.evaluate(() => {
            const table = document.querySelector('table[id*="gvResults"]');
            if (!table) return [];
            const rows = Array.from(table.querySelectorAll('tr')).slice(1);
            return rows.map(row => {
                const cells = row.querySelectorAll('td');
                const link = cells[0].querySelector('a');
                return {
                    name: cells[0].innerText.trim(),
                    address: cells[1].innerText.trim(),
                    city: cells[2].innerText.trim(),
                    zip: cells[3].innerText.trim(),
                    county: cells[4].innerText.trim(),
                    permit: cells[5].innerText.trim(),
                    lastDate: cells[6].innerText.trim(),
                    lastResult: cells[7].innerText.trim(),
                    url: link ? link.href : null
                };
            });
        });

        if (results.length === 0) {
            await browser.close();
            return { status: 'Not Found' };
        }

        const bestMatch = results[0];
        
        // Save this entity to our local table for next time
        saveToLocalFE(bestMatch);

        if (bestMatch.url) {
            const result = await fetchHistoryWithPuppeteer(bestMatch.url, businessName, address, page);
            await browser.close();
            return result;
        }

        await browser.close();
        return { status: 'Not Found' };
    } catch (e) {
        if (browser) await browser.close();
        throw e;
    }
}

async function fetchHistoryWithPuppeteer(profileUrl, businessName, address, existingPage = null) {
    let browser;
    let page = existingPage;
    
    try {
        if (!page) {
            browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
            page = await browser.newPage();
        }
        
        await page.goto(profileUrl, { waitUntil: 'networkidle2' });
        
        const history = await page.evaluate(() => {
            const historyTable = document.querySelector('table[id*="gvHistory"]');
            if (!historyTable) return [];
            const hRows = Array.from(historyTable.querySelectorAll('tr')).slice(1);
            return hRows.map(hr => {
                const hCells = hr.querySelectorAll('td');
                return {
                    date: hCells[1].innerText.trim(),
                    type: hCells[2].innerText.trim(),
                    status: hCells[3].innerText.trim(),
                    violations: parseInt(hCells[4].innerText.trim()) || 0
                };
            });
        });

        const currentData = await page.evaluate(() => {
            return {
                name: document.getElementById('MainContent_lblFEName')?.innerText.trim(),
                address: document.getElementById('MainContent_lblFEAddress')?.innerText.trim(),
                status: document.getElementById('MainContent_lblFEResult')?.innerText.trim()
            };
        });

        if (browser) await browser.close();
        
        return {
            status: 'Found',
            source: 'FDACS',
            profileUrl: profileUrl,
            current: {
                name: currentData.name || businessName,
                address: currentData.address || address,
                status: currentData.status || 'Unknown',
                lastDate: history.length > 0 ? history[0].date : 'N/A'
            },
            history: history
        };
    } catch (e) {
        if (browser) await browser.close();
        return { status: 'Not Found' };
    }
}

function saveToLocalFE(entity) {
    const db = new sqlite3.Database(DB_PATH);
    const sql = `INSERT OR REPLACE INTO food_entities 
                 (id, name, address, city, zip, county, status, last_inspection_date, url) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [
        entity.permit,
        entity.name.toUpperCase(),
        entity.address.toUpperCase(),
        entity.city.toUpperCase(),
        entity.zip,
        entity.county.toLowerCase().replace(/\s+/g, '-'),
        entity.lastResult,
        entity.lastDate,
        entity.url
    ], (err) => {
            if (err) console.error('[SQL Save FE Error]:', err.message);
            db.close();
        });
}

module.exports = { getFullRecord };
