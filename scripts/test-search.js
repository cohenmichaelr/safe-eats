const http = require('http');

http.get('http://localhost:3000/map?query=pizza&lat=26.3683&lng=-80.1289', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log('Search Result Count:', json.results ? json.results.length : 0);
            if (json.results && json.results.length > 0) {
                console.log('First Result Name:', json.results[0].name);
                console.log('First Result Health Status:', json.results[0].healthStatus);
            } else {
                console.log('No results found. Full response:', data);
            }
        } catch (e) {
            console.log('Failed to parse JSON. Response:', data.substring(0, 500));
        }
    });
}).on('error', (err) => {
    console.log('Error:', err.message);
});
