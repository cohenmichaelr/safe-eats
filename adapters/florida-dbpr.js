const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const Fuse = require('fuse.js');

const DB_PATH = path.join(__dirname, '../pbp_restaurants.db');

/**
 * Palm Beach Post Data Adapter (Hybrid Local + Scraper)
 * Prioritizes the local pre-built database for instant results.
 */
const getFullRecord = async (businessName, address, details = {}) => {
    try {
        // STEP 1: Search the LOCAL SQLite Database first
        if (fs.existsSync(DB_PATH)) {
            const localResult = await searchLocalDB(businessName, address, details.county);
            if (localResult) {
                console.log(`[Adapter] Local DB HIT: Found URL for ${businessName}`);
                return await fetchHistoryFromProfile(localResult.url, businessName, address);
            }
        }

        // STEP 2: FALLBACK to live scraper if not in database
        console.log(`[Adapter] Local DB MISS: Falling back to live scraper for ${businessName}`);
        return await performLiveScrape(businessName, address, details);

    } catch (error) {
        console.error('[Adapter Error]:', error.message);
        return { status: 'Error' };
    }
};

/**
 * Fast local DB lookup
 */
async function searchLocalDB(name, address, county) {
    return new Promise((resolve) => {
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
        const searchName = name.toUpperCase().split(' ')[0] + '%';
        const searchCounty = (county || '').toLowerCase().replace(' county', '').replace(/\s+/g, '-');

        db.all(
            'SELECT * FROM restaurants WHERE name LIKE ? AND county = ?',
            [searchName, searchCounty],
            (err, rows) => {
                db.close();
                if (err || !rows || rows.length === 0) return resolve(null);

                // Fuzzy match the exact address from candidates
                const fuse = new Fuse(rows, { keys: ['address'], threshold: 0.5 });
                const match = fuse.search(address)[0]?.item || rows[0];
                resolve(match);
            }
        );
    });
}

/**
 * Scrapes history from a known Palm Beach Post Profile URL
 */
async function fetchHistoryFromProfile(profileUrl, businessName, address) {
    try {
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
    } catch (e) {
        throw new Error('Failed to fetch profile details');
    }
}

/**
 * Original live scraper logic (kept as fallback)
 */
async function performLiveScrape(businessName, address, details) {
    const rawCounty = (details.county || 'palm-beach').toLowerCase().replace(' county', '').replace(/\s+/g, '-');
    const searchName = businessName.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
    const searchUrl = `https://data.palmbeachpost.com/restaurant-inspections/search/`;
    
    const response = await axios.get(searchUrl, {
        params: { county: rawCounty, tsv: searchName.replace(/\s+/g, '+') },
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const resultRegex = /<a[^>]*href="(\/restaurant-inspections\/[^\/]+\/[^\/]+\/[^\/]+\/(\d+)\/)"[^>]*>.*?<\/a>.*?<td[^>]*>(.*?)<\/td>/gs;
    let match;
    const candidates = [];

    while ((match = resultRegex.exec(response.data)) !== null) {
        candidates.push({
            url: `https://data.palmbeachpost.com${match[1]}`,
            address: match[3].replace(/<[^>]*>/g, '').trim().toUpperCase()
        });
    }

    if (candidates.length === 0) return { status: 'Not Found' };

    const fuse = new Fuse(candidates, { keys: ['address'], threshold: 0.5 });
    const bestMatch = fuse.search(address)[0]?.item || candidates[0];

    return await fetchHistoryFromProfile(bestMatch.url, businessName, address);
}

module.exports = { getFullRecord };
