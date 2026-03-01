const axios = require('axios');
const qs = require('querystring');

/**
 * Florida DBPR Real-Time Scraper
 * Visits the official search portal to get 100% real data on-demand.
 */
const getFullRecord = async (businessName, address) => {
    try {
        // 1. Prepare search parameters
        const cleanName = businessName.toUpperCase().split(' ')[0]; // Search by first word
        const cityMatch = address.match(/,\s*([^,]+),\s*[A-Z]{2}/);
        const city = cityMatch ? cityMatch[1].trim().toUpperCase() : '';

        console.log(`[Scraper] Searching Florida DBPR for: "${cleanName}" in "${city}"`);

        // 2. Perform the Search
        // Note: The FL DBPR portal uses a specific search URL
        const searchUrl = 'https://www.myfloridalicense.com/wlpro/wpsearch.asp';
        const formData = qs.stringify({
            'search': 'insp',
            'county': '',
            'lic_name': cleanName,
            'street': '',
            'city': city,
            'zip': ''
        });

        const response = await axios.post(searchUrl, formData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;

        // 3. Parse the results
        // We look for the "Inspection List" in the HTML.
        // This regex looks for the pattern of the inspection table rows.
        const inspectionRegex = /<tr[^>]*>.*?<td[^>]*>(.*?)<\/td>.*?<td[^>]*>(.*?)<\/td>.*?<td[^>]*>(.*?)<\/td>.*?<td[^>]*>(.*?)<\/td>.*?<\/tr>/gs;
        let matches;
        const history = [];

        while ((matches = inspectionRegex.exec(html)) !== null) {
            const [_, date, type, status, violations] = matches;
            
            // Basic cleanup of the scraped text
            const cleanDate = date.replace(/<[^>]*>/g, '').trim();
            if (cleanDate.includes('/') && cleanDate.length < 15) {
                history.push({
                    date: cleanDate,
                    type: type.replace(/<[^>]*>/g, '').trim(),
                    status: status.replace(/<[^>]*>/g, '').trim(),
                    violations: parseInt(violations.replace(/<[^>]*>/g, '').trim()) || 0
                });
            }
        }

        if (history.length === 0) {
            console.log('[Scraper] No results found on DBPR portal.');
            return { status: 'Not Found' };
        }

        console.log(`[Scraper] Found ${history.length} real inspection records!`);

        return {
            status: 'Found',
            current: {
                name: businessName,
                address: address,
                status: history[0].status.includes('Met') || history[0].status.includes('Satisfactory') ? 'Pass' : 'Warning',
                lastDate: history[0].date
            },
            history: history
        };

    } catch (error) {
        console.error('[Scraper Error]:', error.message);
        return { status: 'Error', message: 'Could not connect to live DBPR portal.' };
    }
};

module.exports = { getFullRecord };
