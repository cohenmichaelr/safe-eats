const axios = require('axios');

const API_KEY = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
const BASE_URL = 'https://places.googleapis.com/v1/places';

/**
 * Google Places API (New) adapter
 */
const searchPlaces = async (query) => {
    if (!API_KEY || API_KEY.includes('your_google_maps_key_here')) {
        return { results: [], status: 'MISSING_KEY' };
    }

    try {
        const response = await axios.post(`${BASE_URL}:searchText`, {
            textQuery: query,
            maxResultCount: 15
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': API_KEY,
                'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.location,places.photos'
            }
        });

        // Map NEW API format back to our LEGACY format for frontend compatibility
        const mappedResults = (response.data.places || []).map(p => ({
            place_id: p.id,
            name: p.displayName?.text,
            formatted_address: p.formattedAddress,
            rating: p.rating,
            user_ratings_total: p.userRatingCount,
            geometry: {
                location: {
                    lat: p.location?.latitude,
                    lng: p.location?.longitude
                }
            },
            photos: p.photos ? [{ photo_reference: p.photos[0].name }] : []
        }));

        return { results: mappedResults, status: 'OK' };
    } catch (error) {
        console.error('[Google Maps New] Search Error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.error?.message || 'Failed to fetch data from Google Maps API');
    }
};

const getPlaceDetails = async (placeId) => {
    if (!API_KEY) return { result: {}, status: 'MISSING_KEY' };

    try {
        // Endpoint for getting a specific place's details
        const response = await axios.get(`${BASE_URL}/${placeId}`, {
            headers: {
                'X-Goog-Api-Key': API_KEY,
                'X-Goog-FieldMask': 'id,displayName,formattedAddress,rating,userRatingCount,location,photos,internationalPhoneNumber,websiteUri,regularOpeningHours,priceLevel,reviews'
            }
        });

        const p = response.data;
        
        // Map NEW API format back to our LEGACY format
        const mappedResult = {
            place_id: p.id,
            name: p.displayName?.text,
            formatted_address: p.formattedAddress,
            rating: p.rating,
            user_ratings_total: p.userRatingCount,
            geometry: {
                location: {
                    lat: p.location?.latitude,
                    lng: p.location?.longitude
                }
            },
            formatted_phone_number: p.internationalPhoneNumber,
            website: p.websiteUri,
            opening_hours: {
                open_now: p.regularOpeningHours?.openNow
            },
            price_level: p.priceLevel === 'PRICE_LEVEL_INEXPENSIVE' ? 1 : (p.priceLevel === 'PRICE_LEVEL_MODERATE' ? 2 : 3),
            photos: p.photos ? [{ photo_reference: p.photos[0].name }] : [],
            reviews: (p.reviews || []).map(r => ({
                author_name: r.authorAttribution?.displayName,
                rating: r.rating,
                text: r.text?.text
            }))
        };

        return { result: mappedResult, status: 'OK' };
    } catch (error) {
        console.error('[Google Maps New] Details Error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.error?.message || 'Failed to fetch place details');
    }
};

module.exports = {
    searchPlaces,
    getPlaceDetails
};
