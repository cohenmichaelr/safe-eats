const axios = require('axios');

/**
 * Yelp Fusion API adapter
 */
const getBusinessReviews = async (businessId) => {
    const apiKey = process.env.YELP_API_KEY;
    if (!apiKey || apiKey === 'your_yelp_key_here') {
        return { message: 'Yelp API key not configured. Returning mock data.', reviews: [] };
    }

    try {
        const response = await axios.get(`https://api.yelp.com/v3/businesses/${businessId}/reviews`, {
            headers: {
                Authorization: `Bearer ${apiKey}`
            }
        });
        return response.data;
    } catch (error) {
        console.error('Yelp API error:', error.response?.data || error.message);
        throw new Error('Failed to fetch reviews from Yelp API');
    }
};

const searchBusinesses = async (term, location) => {
    const apiKey = process.env.YELP_API_KEY;
    if (!apiKey || apiKey === 'your_yelp_key_here') {
        return { message: 'Yelp API key not configured. Returning mock data.', businesses: [] };
    }

    try {
        const response = await axios.get('https://api.yelp.com/v3/businesses/search', {
            headers: {
                Authorization: `Bearer ${apiKey}`
            },
            params: {
                term,
                location
            }
        });
        return response.data;
    } catch (error) {
        console.error('Yelp API error:', error.response?.data || error.message);
        throw new Error('Failed to search businesses on Yelp');
    }
};

module.exports = {
    getBusinessReviews,
    searchBusinesses
};
