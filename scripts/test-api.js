const http = require('http');

http.get('http://localhost:3000/api/restaurants/all', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log('Success! Items found:', json.results.length);
            console.log('First item:', json.results[0]);
        } catch (e) {
            console.log('Failed to parse JSON. Response was:', data.substring(0, 200));
        }
    });
}).on('error', (err) => {
    console.log('Error:', err.message);
});
