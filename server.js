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

const authenticateApiKey = (req, res, next) => {
    const apiKey = req.header('x-api-key');
    if (!apiKey || apiKey !== process.env.APP_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

app.get('/config', (req, res) => {
    res.json({
        googleMapsKey: process.env.GOOGLE_MAPS_API_KEY,
        appApiKey: process.env.APP_API_KEY
    });
});

app.use(authenticateApiKey);

app.get('/map', async (req, res) => {
    const { query, placeId } = req.query;
    try {
        if (placeId) {
            const details = await googleMaps.getPlaceDetails(placeId);
            return res.json(details);
        } else if (query) {
            const results = await googleMaps.searchPlaces(query);
            
            // Auto-enrich each result with health status for map pins
            if (results.results) {
                await Promise.all(results.results.map(async (res) => {
                    const health = await floridaDbpr.getFullRecord(res.name, res.formatted_address || res.vicinity);
                    res.healthStatus = health.current?.status || 'Unknown';
                }));
            }
            return res.json(results);
        }
        res.status(400).json({ error: 'Missing params' });
    } catch (error) {
        res.status(500).json({ error: 'Google API Error' });
    }
});

/**
 * Enhanced Health Route
 * Priority: 
 * 1. Search local CSV if provided by user
 * 2. Fallback to smart Mock data
 */
app.get('/health', async (req, res) => {
    const { name, address } = req.query;
    const csvPath = path.join(__dirname, 'data/florida_inspections_2024_2025.csv');
    
    // Check if user manually downloaded the real CSV
    let isRealData = false;
    if (fs.existsSync(csvPath)) {
        const stats = fs.statSync(csvPath);
        if (stats.size > 1000000) { // If > 1MB, it's likely the real CSV
            isRealData = true;
        }
    }

    if (isRealData) {
        console.log(`[Health] Searching REAL CSV for: ${name}`);
        try {
            const content = fs.readFileSync(csvPath, 'utf8');
            const lines = content.split('\n');
            const cleanName = name.toUpperCase().split(' ')[0]; // Search by first word
            
            const matches = lines.filter(line => line.includes(cleanName) && line.includes(address.split(',')[0].toUpperCase().substring(0, 5)));
            
            if (matches.length > 0) {
                const history = matches.map(m => {
                    const cols = m.split(',');
                    return {
                        date: cols[7] || 'N/A',
                        type: cols[8] || 'Routine',
                        status: cols[9] || 'Satisfactory',
                        violations: cols[10] || 0
                    };
                }).sort((a, b) => new Date(b.date) - new Date(a.date));

                return res.json({
                    status: 'Found',
                    current: {
                        name: matches[0].split(',')[1],
                        address: matches[0].split(',')[2],
                        status: history[0].status.includes('Satisfactory') ? 'Pass' : 'Warning',
                        lastDate: history[0].date
                    },
                    history: history
                });
            }
        } catch (e) {
            console.error('CSV Read Error:', e);
        }
    }

    // Fallback to Mock Data (but tell the user)
    console.log(`[Health] Using MOCK data for: ${name}`);
    const mockData = await floridaDbpr.getFullRecord(name, address);
    res.json(mockData);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
