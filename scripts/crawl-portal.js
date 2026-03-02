const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Florida DBPR Crawler (v3)
 * Usage: node scripts/crawl-portal.js "Boca Raton"
 */
const CITY = process.argv[2] || 'Boca Raton';
const OUTPUT_FILE = path.join(__dirname, `../data/scraped_${CITY.replace(/\s/g, '_').toLowerCase()}.csv`);

async function crawl() {
    console.log(`--- Starting Crawl for: ${CITY} ---`);
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    try {
        // 1. Go to Search Portal
        console.log('Opening DBPR Portal...');
        await page.goto('https://www.myfloridalicense.com/wl11.asp?mode=0&SID=&brd=H', { waitUntil: 'networkidle2' });

        // 2. Fill Form with specific waits
        console.log('Filling search form...');
        
        // Wait for the form to be ready
        await page.waitForSelector('select', { timeout: 5000 });

        // Find the License Type dropdown (it might not be named "typ" exactly)
        await page.evaluate(() => {
            const selects = Array.from(document.querySelectorAll('select'));
            const typeSelect = selects.find(s => s.innerText.includes('Food Service') || s.name === 'typ');
            if (typeSelect) typeSelect.value = 'Food Service';
            
            const cityInput = document.querySelector('input[name="city"]');
            if (cityInput) cityInput.value = window.cityName; // Pass from node context
        }, { cityName: CITY });

        // Manual type for city just in case evaluate didn't catch it
        const cityInput = await page.$('input[name="city"]');
        if (cityInput) await cityInput.type(CITY);

        // Click Search
        console.log('Submitting search...');
        await Promise.all([
            page.keyboard.press('Enter'),
            page.waitForNavigation({ waitUntil: 'networkidle2' })
        ]);

        const results = [];
        let hasNextPage = true;
        let pageCount = 1;

        while (hasNextPage && pageCount <= 5) {
            console.log(`Scraping page ${pageCount}...`);

            const pageData = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('table tr'));
                return rows.map(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 4) return null;
                    const link = cells[1]?.querySelector('a');
                    if (!link || !link.href.includes('id=')) return null;

                    return {
                        name: cells[0].innerText.trim(),
                        license: cells[1].innerText.trim(),
                        address: cells[2].innerText.trim(),
                        city: cells[3].innerText.trim(),
                        status: cells[4]?.innerText.trim() || 'Unknown',
                        id: link.href.split('id=')[1].split('&')[0]
                    };
                }).filter(r => r !== null);
            });

            results.push(...pageData);

            // Check for "Next" button
            const nextButton = await page.$('input[value="Next"]');
            if (nextButton) {
                await Promise.all([
                    nextButton.click(),
                    page.waitForNavigation({ waitUntil: 'networkidle2' })
                ]);
                pageCount++;
            } else {
                hasNextPage = false;
            }
        }

        if (results.length === 0) {
            console.log('No results found. The website might be blocking the crawl.');
        } else {
            const headers = 'Name,License,Address,City,Status,ID\n';
            const rows = results.map(r => `"${r.name}","${r.license}","${r.address}","${r.city}","${r.status}","${r.id}"`).join('\n');
            if (!fs.existsSync(path.join(__dirname, '../data'))) fs.mkdirSync(path.join(__dirname, '../data'));
            fs.writeFileSync(OUTPUT_FILE, headers + rows);
            console.log(`\nSuccess! Scraped ${results.length} establishments for ${CITY}.`);
            console.log(`File saved to: ${OUTPUT_FILE}`);
        }

    } catch (error) {
        console.error('Crawl Error:', error.message);
    } finally {
        await browser.close();
    }
}

crawl();
