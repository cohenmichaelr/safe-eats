require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const googleMaps = require('./adapters/google-maps');
const floridaDbpr = require('./adapters/florida-dbpr');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/config', (req, res) => {
    res.json({ googleMapsKey: process.env.GOOGLE_MAPS_API_KEY });
});

/**
 * Route: /admin/rebuild-db
 * Triggers the Puppeteer crawler to refresh local database.
 */
app.post('/admin/rebuild-db', (req, res) => {
    const { spawn } = require('child_process');
    console.log('[Admin] Starting Database Rebuild...');
    
    const crawler = spawn('node', ['scripts/build-pbp-database.js']);
    
    crawler.stdout.on('data', (data) => console.log(`[Crawler]: ${data}`));
    crawler.stderr.on('data', (data) => console.error(`[Crawler Error]: ${data}`));
    
    res.json({ status: 'started', message: 'Crawl process initiated in background.' });
});

/**
 * Route: /map
 * Fast Search: Just returns Google Maps results. No health scraping here.
 */
app.get('/map', async (req, res) => {
    const { query, placeId, lat, lng } = req.query;
    try {
        if (placeId) {
            const details = await googleMaps.getPlaceDetails(placeId);
            return res.json(details);
        } else if (query) {
            const results = await googleMaps.searchPlaces(query, { lat, lng });
            return res.json(results);
        }
        res.status(400).json({ error: 'Missing params' });
    } catch (error) {
        console.error('[Map Error]:', error.message);
        res.status(500).json({ error: 'Internal Error' });
    }
});

/**
 * Route: /health
 * Triggered ONLY when a restaurant is clicked.
 */
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
});
