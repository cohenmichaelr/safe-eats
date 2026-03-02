const axios = require('axios');

const API_KEY = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
const BASE_URL = 'https://places.googleapis.com/v1/places';

/**
 * Helper to extract specific address components
 */
const extractAddressInfo = (components) => {
    const info = { city: '', state: '', county: '' };
    if (!components) return info;

    components.forEach(c => {
        if (c.types.includes('locality')) info.city = c.longText;
        if (c.types.includes('administrative_area_level_1')) info.state = c.shortText;
        if (c.types.includes('administrative_area_level_2')) info.county = c.longText.replace(' County', '');
    });
    return info;
};

const searchPlaces = async (query, locationContext = null) => {
    if (!API_KEY || API_KEY.includes('your_google_maps_key_here')) return { results: [], status: 'MISSING_KEY' };

    try {
        const payload = { textQuery: query, maxResultCount: 15 };
        if (locationContext?.lat && locationContext?.lng) {
            payload.locationBias = { circle: { center: { latitude: parseFloat(locationContext.lat), longitude: parseFloat(locationContext.lng) }, radius: 5000.0 } };
        }

        const response = await axios.post(`${BASE_URL}:searchText`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': API_KEY,
                'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.location,places.photos,places.addressComponents'
            }
        });

        const mappedResults = (response.data.places || []).map(p => {
            const addr = extractAddressInfo(p.addressComponents);
            return {
                place_id: p.id,
                name: p.displayName?.text,
                formatted_address: p.formattedAddress,
                city: addr.city,
                state: addr.state,
                county: addr.county,
                rating: p.rating,
                user_ratings_total: p.userRatingCount,
                geometry: { location: { lat: p.location?.latitude, lng: p.location?.longitude } },
                photos: p.photos ? [{ photo_reference: p.photos[0].name }] : []
            };
        });

        return { results: mappedResults, status: 'OK' };
    } catch (error) { throw new Error('Search Failed'); }
};

const getPlaceDetails = async (placeId) => {
    if (!API_KEY) return { result: {}, status: 'MISSING_KEY' };
    try {
        const response = await axios.get(`${BASE_URL}/${placeId}`, {
            headers: {
                'X-Goog-Api-Key': API_KEY,
                'X-Goog-FieldMask': 'id,displayName,formattedAddress,rating,userRatingCount,location,photos,internationalPhoneNumber,websiteUri,regularOpeningHours,priceLevel,reviews,addressComponents'
            }
        });
        const p = response.data;
        const addr = extractAddressInfo(p.addressComponents);
        const mappedResult = {
            place_id: p.id,
            name: p.displayName?.text,
            formatted_address: p.formattedAddress,
            city: addr.city,
            state: addr.state,
            county: addr.county,
            rating: p.rating,
            user_ratings_total: p.userRatingCount,
            geometry: { location: { lat: p.location?.latitude, lng: p.location?.longitude } },
            formatted_phone_number: p.internationalPhoneNumber,
            website: p.websiteUri,
            opening_hours: { open_now: p.regularOpeningHours?.openNow },
            price_level: p.priceLevel === 'PRICE_LEVEL_INEXPENSIVE' ? 1 : (p.priceLevel === 'PRICE_LEVEL_MODERATE' ? 2 : 3),
            photos: p.photos ? [{ photo_reference: p.photos[0].name }] : [],
            reviews: (p.reviews || []).map(r => ({ author_name: r.authorAttribution?.displayName, rating: r.rating, text: r.text?.text }))
        };
        return { result: mappedResult, status: 'OK' };
    } catch (error) { throw new Error('Details Failed'); }
};

module.exports = { searchPlaces, getPlaceDetails };
