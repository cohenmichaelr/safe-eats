const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Florida DBPR Bulk Data Downloader
 * Downloads the complete list of active Food Service Licenses in Florida.
 */
const LICENSE_FILE_URL = 'https://www.myfloridalicense.com/dbpr/hr/inspections/StatewideFoodServiceLicenses.csv';
const OUTPUT_FILE = path.join(__dirname, '../data/statewide_licenses.csv');

async function downloadLicenses() {
    console.log('--- Florida License Downloader ---');
    console.log(`Target: ${LICENSE_FILE_URL}`);
    
    if (!fs.existsSync(path.join(__dirname, '../data'))) fs.mkdirSync(path.join(__dirname, '../data'));

    try {
        const response = await axios({
            method: 'get',
            url: LICENSE_FILE_URL,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(OUTPUT_FILE);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                const size = fs.statSync(OUTPUT_FILE).size;
                console.log(`Success! Saved to: ${OUTPUT_FILE} (${(size / 1024 / 1024).toFixed(2)} MB)`);
                resolve();
            });
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('Download failed. You may need to download this manually in your browser:', LICENSE_FILE_URL);
    }
}

downloadLicenses();
