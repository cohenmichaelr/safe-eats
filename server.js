require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const googleMaps = require('./adapters/google-maps');
const floridaDbpr = require('./adapters/florida-dbpr');

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
                    
                    return new Promise((resolve) => {
                        db.get(
                            'SELECT status FROM restaurants WHERE name LIKE ? AND address LIKE ?',
                            [firstWord, streetNum],
                            (err, row) => {
                                // Default to Unknown if no DB match
                                res.healthStatus = row ? row.status : 'Unknown';
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
    const { name, address, city, state, county } = req.query;
    try {
        const fullData = await floridaDbpr.getFullRecord(name, address, { city, state, county });
        res.json(fullData);
    } catch (error) {
        res.status(500).json({ error: 'Health Data Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`DB found at ${DB_PATH}: ${fs.existsSync(DB_PATH) ? 'YES' : 'NO'}`);
    if (fs.existsSync(DB_PATH)) {
        const stats = fs.statSync(DB_PATH);
        console.log(`DB Size: ${(stats.size / 1024).toFixed(2)} KB`);
    }
});
