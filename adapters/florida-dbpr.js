const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const Fuse = require('fuse.js');

const DB_PATH = path.join(__dirname, '../pbp_restaurants.db');

/**
 * Palm Beach Post Data Adapter (Advanced Fuzzy Version)
 * Searches by Name and County first, then refines with fuzzy matching.
 */
const getFullRecord = async (businessName, address, details = {}) => {
    try {
        const targetName = businessName.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
        const searchCounty = (details.county || '').toLowerCase().replace(' county', '').replace(/\s+/g, '-');
        
        console.log(`[Adapter] Deep Search: "${targetName}" in ${searchCounty}`);

        // STEP 1: Search the LOCAL SQLite Database
        if (fs.existsSync(DB_PATH)) {
            const localResult = await searchLocalDB(targetName, searchCounty, address);
            if (localResult) {
                console.log(`[Adapter] Local DB HIT: ${localResult.url}`);
                return await fetchHistoryFromProfile(localResult.url, businessName, address);
            }
        }

        // STEP 2: FALLBACK to live search
        console.log(`[Adapter] Local DB MISS: Performing live search...`);
        return await performLiveScrape(businessName, address, details);

    } catch (error) {
        console.error('[Adapter Error]:', error.message);
        return { status: 'Not Found' };
    }
};

async function searchLocalDB(name, county, fullAddress) {
    return new Promise((resolve) => {
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
        const firstWord = name.split(' ')[0] + '%';

        // 1. Get all restaurants in the correct county that share the first word of the name
        db.all(
            'SELECT * FROM restaurants WHERE county = ? AND name LIKE ?',
            [county, firstWord],
            (err, rows) => {
                db.close();
                if (err || !rows || rows.length === 0) return resolve(null);

                // 2. Use Fuse.js to find the closest match based on the FULL restaurant name
                const fuse = new Fuse(rows, { 
                    keys: ['name'], 
                    threshold: 0.5,
                    includeScore: true 
                });
                
                const results = fuse.search(name);
                
                if (results.length > 0) {
                    console.log(`[DB Match] Found "${results[0].item.name}" (Score: ${results[0].score.toFixed(2)})`);
                    resolve(results[0].item);
                } else {
                    resolve(null);
                }
            }
        );
    });
}

async function performLiveScrape(businessName, address, details) {
    const rawCounty = (details.county || 'palm-beach').toLowerCase().replace(' county', '').replace(/\s+/g, '-');
    const searchName = businessName.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').slice(0, 2).join(' ');
    const searchUrl = `https://data.palmbeachpost.com/restaurant-inspections/search/`;
    
    try {
        const response = await axios.get(searchUrl, {
            params: { county: rawCounty, tsv: searchName.replace(/\s+/g, '+') },
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const resultRegex = /<a[^>]*href="(\/restaurant-inspections\/[^\/]+\/([^\/]+)\/[^\/]+\/(\d+)\/)"[^>]*>.*?<\/a>/gs;
        let match;
        const candidates = [];

        while ((match = resultRegex.exec(response.data)) !== null) {
            candidates.push({
                url: `https://data.palmbeachpost.com${match[1]}`,
                name: match[2].replace(/-/g, ' ').toUpperCase()
            });
        }

        if (candidates.length === 0) return { status: 'Not Found' };

        // Fuzzy match name
        const fuse = new Fuse(candidates, { keys: ['name'], threshold: 0.6 });
        const bestMatch = fuse.search(businessName)[0]?.item || candidates[0];

        return await fetchHistoryFromProfile(bestMatch.url, businessName, address);
    } catch (e) {
        return { status: 'Not Found' };
    }
}

async function fetchHistoryFromProfile(profileUrl, businessName, address) {
    const res = await axios.get(profileUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = res.data;
    const history = [];
    const historyRegex = /<tr>\s*<td>(\d{2}\/\d{2}\/\d{4})<\/td>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>/gs;
    let m;
    while ((m = historyRegex.exec(html)) !== null) {
        const [_, date, type, status, viol] = m;
        history.push({
            date: date.trim(),
            type: type.replace(/<[^>]*>/g, '').trim(),
            status: status.replace(/<[^>]*>/g, '').trim(),
            violations: parseInt(viol.replace(/<[^>]*>/g, '').trim()) || 0
        });
    }
    return {
        status: 'Found',
        source: 'Palm Beach Post',
        profileUrl: profileUrl,
        current: {
            name: businessName,
            address: address,
            status: (history[0]?.status.includes('Met') || history[0]?.status.includes('Satisfactory')) ? 'Pass' : 'Warning',
            lastDate: history[0]?.date || 'N/A'
        },
        history: history
    };
}

module.exports = { getFullRecord };
