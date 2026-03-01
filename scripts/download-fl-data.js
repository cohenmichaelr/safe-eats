const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Florida DBPR Statewide Food Service Inspections Download Script
 * Improved version with browser-like headers to bypass simple bot protection.
 */
const DATASETS = [
    { name: 'FY2324', url: 'https://www.myfloridalicense.com/dbpr/hr/inspections/StatewideFoodServiceInspectionsFY2324.csv', file: 'florida_inspections_2023_2024.csv' },
    { name: 'FY2425', url: 'https://www.myfloridalicense.com/dbpr/hr/inspections/StatewideFoodServiceInspectionsFY2425.csv', file: 'florida_inspections_2024_2025.csv' }
];

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/csv,application/csv,text/plain',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.myfloridalicense.com/dbpr/hr/public-records/food-service-public-records/',
    'Connection': 'keep-alive'
};

async function downloadDataset(dataset) {
    const outputPath = path.join(__dirname, '../data', dataset.file);
    console.log(`\n--- Downloading ${dataset.name} ---`);
    console.log(`Target: ${dataset.url}`);

    try {
        const response = await axios({
            method: 'get',
            url: dataset.url,
            headers: HEADERS,
            responseType: 'stream',
            maxRedirects: 5
        });

        // Check if the response is actually a CSV (or at least not HTML)
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
            console.warn(`Warning: Received HTML instead of CSV for ${dataset.name}. The server might be blocking the request or redirecting to a landing page.`);
        }

        const writer = fs.createWriteStream(outputPath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                const stats = fs.statSync(outputPath);
                const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
                
                if (stats.size < 5000) { // If less than 5KB, it's almost certainly not the full dataset
                    console.warn(`Warning: ${dataset.file} is very small (${stats.size} bytes). It likely contains an error page or redirect HTML.`);
                } else {
                    console.log(`Success! File saved to: ${outputPath}`);
                    console.log(`File Size: ${fileSizeInMB} MB`);
                }
                resolve();
            });
            writer.on('error', (err) => {
                console.error(`File write error for ${dataset.name}:`, err.message);
                reject(err);
            });
        });

    } catch (error) {
        console.error(`\nDownload failed for ${dataset.name}!`);
        if (error.response) {
            console.error(`Server Status: ${error.response.status}`);
        } else {
            console.error(`Error: ${error.message}`);
        }
    }
}

async function run() {
    console.log('--- Florida DBPR Data Downloader (v2) ---');
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }

    for (const dataset of DATASETS) {
        await downloadDataset(dataset);
    }
    console.log('\nAll download attempts completed.');
}

run();
