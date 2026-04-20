require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const axios = require('axios');

const DB_PATH = path.join(__dirname, '../pbp_restaurants.db');
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const BATCH_SIZE = 50; // Process in small batches
const LIMIT = process.argv[2] ? parseInt(process.argv[2]) : 50; // Total to process in this run

if (!API_KEY) {
    console.error('Error: GOOGLE_MAPS_API_KEY not found in .env');
    process.exit(1);
} else {
    console.log(`Using API Key: ${API_KEY.substring(0, 5)}...${API_KEY.substring(API_KEY.length - 5)}`);
}

async function geocodeAddress(address, county) {
    const fullQuery = `${address}, ${county}, FL`;
    try {
        const response = await axios.post('https://places.googleapis.com/v1/places:searchText', 
            { textQuery: fullQuery, maxResultCount: 1 },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': API_KEY.trim(),
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location'
                }
            }
        );

        if (response.data.places && response.data.places.length > 0) {
            const location = response.data.places[0].location;
            return { lat: location.latitude, lng: location.longitude };
        } else {
            console.log(`[Places API] No results for: ${fullQuery}`);
            return 'ZERO_RESULTS';
        }
    } catch (error) {
        if (error.response) {
            console.error(`[Places API] Error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
        } else {
            console.error(`[Places API] Request failed: ${error.message}`);
        }
        return null;
    }
}

async function run() {
    console.log(`--- Bulk Geocoding Starting (Limit: ${LIMIT}) ---`);
    const db = new sqlite3.Database(DB_PATH);

    const rows = await new Promise((resolve, reject) => {
        db.all('SELECT id, name, address, county FROM restaurants WHERE latitude IS NULL AND address != "NONE" LIMIT ?', [LIMIT], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    console.log(`Found ${rows.length} records to geocode.`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

        await Promise.all(batch.map(async (row) => {
            const coords = await geocodeAddress(row.address, row.county);
            
            if (coords && coords !== 'ZERO_RESULTS') {
                return new Promise((resolve) => {
                    db.run('UPDATE restaurants SET latitude = ?, longitude = ? WHERE id = ?', [coords.lat, coords.lng, row.id], (err) => {
                        if (err) {
                            console.error(`[DB] Update failed for ${row.name}: ${err.message}`);
                            failCount++;
                        } else {
                            successCount++;
                        }
                        resolve();
                    });
                });
            } else {
                // If ZERO_RESULTS, mark with a placeholder so we don't try again
                if (coords === 'ZERO_RESULTS') {
                    return new Promise((resolve) => {
                        db.run('UPDATE restaurants SET latitude = 0, longitude = 0 WHERE id = ?', [row.id], () => {
                            failCount++;
                            resolve();
                        });
                    });
                }
                failCount++;
                return Promise.resolve();
            }
        }));
        
        // Brief pause to respect rate limits if needed
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\n--- Geocoding Complete ---`);
    console.log(`Successfully geocoded: ${successCount}`);
    console.log(`Failed/No results: ${failCount}`);

    db.close();
}

run();
