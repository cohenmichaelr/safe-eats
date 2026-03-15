require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const googleMaps = require('./adapters/google-maps');
const floridaDbpr = require('./adapters/florida-dbpr');
const floridaFdacs = require('./adapters/florida-fdacs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'pbp_restaurants.db');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/config', (req, res) => {
    res.json({ googleMapsKey: process.env.GOOGLE_MAPS_API_KEY });
});

app.post('/admin/rebuild-db', (req, res) => {
    const { spawn } = require('child_process');
    console.log('[Admin] Starting Database Rebuild...');
    const crawler = spawn('node', ['scripts/build-pbp-database.js']);
    crawler.stdout.on('data', (data) => console.log(`[Crawler]: ${data}`));
    crawler.stderr.on('data', (data) => console.error(`[Crawler Error]: ${data}`));
    res.json({ status: 'started' });
});

/**
 * Enhanced Route: /map
 * Now automatically checks the database for EVERY search result
 * to provide instant color-coded pins.
 */
app.get('/map', async (req, res) => {
    const { query, placeId, lat, lng } = req.query;
    try {
        if (placeId) {
            const details = await googleMaps.getPlaceDetails(placeId);
            return res.json(details);
        } else if (query) {
            const results = await googleMaps.searchPlaces(query, { lat, lng });
            
            // AUTOMATIC STATUS LOOKUP FOR COLORS
            if (results.results && fs.existsSync(DB_PATH)) {
                const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
                
                await Promise.all(results.results.map(async (res) => {
                    const firstWord = res.name.toUpperCase().split(' ')[0] + '%';
                    const streetNum = (res.formatted_address || '').split(' ')[0] + '%';
                    const searchCounty = (res.county || '').toLowerCase().replace(' county', '').replace(/\s+/g, '-');
                    
                    return new Promise((resolve) => {
                        let query = 'SELECT status, last_inspection_date FROM restaurants WHERE name LIKE ? AND address LIKE ?';
                        let params = [firstWord, streetNum];

                        if (searchCounty) {
                            query += ' AND county = ?';
                            params.push(searchCounty);
                        }
                        
                        db.get(
                            query,
                            params,
                            (err, row) => {
                                if (err) console.error(`[SQL Error] ${err.message}`);
                                else if (!row) console.log(`[SQL] No match for ${firstWord} at ${streetNum} in ${searchCounty}`);
                                
                                // Default to Unknown if no DB match
                                res.healthStatus = row ? row.status : 'Unknown';
                                res.lastInspectionDate = row ? row.last_inspection_date : null;
                                resolve();
                            }
                        );
                    });
                }));
                db.close();
            }
            
            return res.json(results);
        }
        res.status(400).json({ error: 'Missing params' });
    } catch (error) {
        console.error('[Map Error]:', error.message);
        res.status(500).json({ error: 'Internal Error' });
    }
});

app.get('/health', async (req, res) => {
    const { name, address, placeId, county } = req.query;
    try {
        let locationDetails = { county };
        
        // If county is missing but placeId is present, fetch it from Google
        if (!locationDetails.county && placeId) {
            const details = await googleMaps.getPlaceDetails(placeId);
            if (details.result) {
                locationDetails = {
                    city: details.result.city,
                    state: details.result.state,
                    county: details.result.county
                };
            }
        }
        
        // Try DBPR first (most common for restaurants)
        let fullData = await floridaDbpr.getFullRecord(name, address, locationDetails);
        
        // If not found in DBPR, try FDACS (grocery stores, convenience stores, etc.)
        if (!fullData || fullData.status === 'Not Found') {
            console.log(`[Server] Not found in DBPR, trying FDACS for ${name}...`);
            const fdacsData = await floridaFdacs.getFullRecord(name, address, locationDetails);
            if (fdacsData && fdacsData.status === 'Found') {
                fullData = fdacsData;
            }
        }

        res.json(fullData);
    } catch (error) {
        res.status(500).json({ error: 'Health Data Error' });
    }
});

/**
 * Route: /api/database/search
 * Searches both local tables (restaurants and food_entities).
 */
app.get('/api/database/search', (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    if (!fs.existsSync(DB_PATH)) {
        return res.status(500).json({ error: 'Database not found' });
    }

    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
    const searchTerm = `%${query.toUpperCase()}%`;
    const countyTerm = query.toLowerCase().replace(' county', '').replace(/\s+/g, '-');

    const sql = `
        SELECT id, name, address, county, status, last_inspection_date, latitude, longitude, 'DBPR' as source 
        FROM restaurants 
        WHERE name LIKE ? OR address LIKE ? OR county = ?
        UNION ALL
        SELECT id, name, address, county, status, last_inspection_date, latitude, longitude, 'FDACS' as source
        FROM food_entities
        WHERE name LIKE ? OR address LIKE ? OR county = ?
        LIMIT 300
    `;

    db.all(sql, [searchTerm, searchTerm, countyTerm, searchTerm, searchTerm, countyTerm], (err, rows) => {
        db.close();
        if (err) {
            console.error('[DB Search Error]:', err.message);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ results: rows });
    });
});

/**
 * Route: /api/database/update-location
 * Saves geocoded coordinates for a restaurant or food entity.
 */
app.post('/api/database/update-location', (req, res) => {
    const { id, lat, lng, source } = req.body;
    if (!id || lat === undefined || lng === undefined) return res.status(400).json({ error: 'Missing data' });

    const db = new sqlite3.Database(DB_PATH);
    const table = source === 'FDACS' ? 'food_entities' : 'restaurants';
    
    db.run(`UPDATE ${table} SET latitude = ?, longitude = ? WHERE id = ?`, [lat, lng, id], (err) => {
        db.close();
        if (err) return res.status(500).json({ error: 'Update failed' });
        res.json({ status: 'updated' });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`DB found at ${DB_PATH}: ${fs.existsSync(DB_PATH) ? 'YES' : 'NO'}`);
    if (fs.existsSync(DB_PATH)) {
        const stats = fs.statSync(DB_PATH);
        console.log(`DB Size: ${(stats.size / 1024).toFixed(2)} KB`);
    }
});
