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
        const streetNum = (fullAddress || '').split(' ')[0] + '%';

        let query = 'SELECT * FROM restaurants WHERE name LIKE ? AND address LIKE ?';
        let params = [firstWord, streetNum];

        if (county) {
            query += ' AND county = ?';
            params.push(county);
        }

        console.log(`[SQL Query] ${query} | Params: ${JSON.stringify(params)}`);

        // Try to match by name first word, street number AND county for higher precision
        db.all(
            query,
            params,
            (err, rows) => {
                if (err || !rows || rows.length === 0) {
                    console.log(`[SQL] No direct match found for ${firstWord}, ${streetNum}, and ${county}. Trying fallback...`);
                    // Fallback: Just name and county
                    let fallbackQuery = 'SELECT * FROM restaurants WHERE name LIKE ?';
                    let fallbackParams = [firstWord];
                    if (county) {
                        fallbackQuery += ' AND county = ?';
                        fallbackParams.push(county);
                    }
                    fallbackQuery += ' LIMIT 100';
                    
                    console.log(`[SQL Fallback] ${fallbackQuery} | Params: ${JSON.stringify(fallbackParams)}`);
                    db.all(fallbackQuery, fallbackParams, (err2, rows2) => {
                        db.close();
                        processMatches(name, rows2 || [], resolve);
                    });
                } else {
                    console.log(`[SQL] Found ${rows.length} potential matches.`);
                    db.close();
                    processMatches(name, rows, resolve);
                }
            }
        );
    });
}

function processMatches(targetName, rows, resolve) {
    if (!rows.length) return resolve(null);
    
    const fuse = new Fuse(rows, { 
        keys: ['name', 'address'], 
        threshold: 0.4,
        includeScore: true 
    });
    
    const results = fuse.search(targetName);
    if (results.length > 0) {
        console.log(`[DB Match] Best: "${results[0].item.name}" at "${results[0].item.address}" (Score: ${results[0].score.toFixed(2)})`);
        resolve(results[0].item);
    } else {
        resolve(null);
    }
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
    try {
        const res = await axios.get(profileUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = res.data;
        
        // Remove scripts and styles for cleaner regex matching on text
        const cleanText = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, ' ')
                             .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gm, ' ')
                             .replace(/<[^>]*>/g, ' '); // Replace remaining HTML tags with spaces

        const history = [];
        // Improved regex based on site structure analysis
        const historyRegex = /([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})\s+([\w\s-]+?)(?:\s*\(([^)]+)\))?\s*(?:View Inspection Detail\s*)?(\d+)\s+Hide Inspection Detail/g;
        
        let m;
        while ((m = historyRegex.exec(cleanText)) !== null) {
            const [_, dateStr, type, status, viol] = m;
            history.push({
                date: normalizeDate(dateStr.trim()),
                type: type.trim(),
                status: status ? status.trim() : type.trim(),
                violations: parseInt(viol) || 0
            });
        }

        if (history.length === 0) {
            // Fallback: try matching simple table rows if the text-based one failed
            const tableRegex = /<tr>\s*<td>([\d\/]+)<\/td>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>\s*<td>(\d+)<\/td>/gs;
            while ((m = tableRegex.exec(html)) !== null) {
                const [_, date, type, status, viol] = m;
                history.push({
                    date: date.trim(),
                    type: type.replace(/<[^>]*>/g, '').trim(),
                    status: status.replace(/<[^>]*>/g, '').trim(),
                    violations: parseInt(viol) || 0
                });
            }
        }

        return {
            status: history.length > 0 ? 'Found' : 'Not Found',
            source: 'Palm Beach Post',
            profileUrl: profileUrl,
            current: {
                name: businessName,
                address: address,
                status: history.length > 0 ? history[0].status : 'Unknown',
                lastDate: history.length > 0 ? history[0].date : 'N/A'
            },
            history: history
        };
    } catch (e) {
        console.error('[fetchHistoryFromProfile] Error:', e.message);
        return { status: 'Not Found' };
    }
}

function normalizeDate(dateStr) {
    if (!dateStr) return 'N/A';
    // If it's already MM/DD/YYYY, return it
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) return dateStr;
    
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    } catch (e) {
        return dateStr;
    }
}

module.exports = { getFullRecord };
