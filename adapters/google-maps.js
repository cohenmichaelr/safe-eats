const axios = require('axios');

// Create a reusable axios instance with better defaults
const googleClient = axios.create({
    baseURL: 'https://maps.googleapis.com/maps/api/place',
    timeout: 10000, // 10 seconds
    headers: {
        'User-Agent': 'SafeEatsUSA/1.0.0',
        'Accept': 'application/json'
    }
});

/**
 * Google Maps Places API adapter
 */
const searchPlaces = async (query) => {
    const apiKey = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
    if (!apiKey || apiKey === 'your_google_maps_key_here') {
        return { results: [], status: 'MISSING_KEY' };
    }

    try {
        const response = await googleClient.get('/textsearch/json', {
            params: {
                query,
                key: apiKey,
                type: 'restaurant'
            }
        });

        if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
            console.error('[Google Maps] Search Error Status:', response.data.status, response.data.error_message || '');
            throw new Error(`Google API Error: ${response.data.status}`);
        }

        return response.data;
    } catch (error) {
        if (error.code === 'ECONNRESET') {
            console.error('[Google Maps] Connection Reset! Check your firewall or VPN.');
        }
        console.error('[Google Maps] Search Request Failed:', error.message);
        throw error;
    }
};

const getPlaceDetails = async (placeId) => {
    const apiKey = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
    if (!apiKey || apiKey === 'your_google_maps_key_here') {
        return { result: {}, status: 'MISSING_KEY' };
    }

    try {
        const response = await googleClient.get('/details/json', {
            params: {
                place_id: placeId,
                fields: 'name,formatted_address,rating,user_ratings_total,reviews,geometry,photos,formatted_phone_number,website,opening_hours,price_level',
                key: apiKey
            }
        });

        if (response.data.status !== 'OK') {
            console.error('[Google Maps] Details Error Status:', response.data.status, response.data.error_message || '');
            throw new Error(`Google API Error: ${response.data.status}`);
        }

        return response.data;
    } catch (error) {
        console.error('[Google Maps] Details Request Failed:', error.message);
        throw error;
    }
};

module.exports = {
    searchPlaces,
    getPlaceDetails
};
