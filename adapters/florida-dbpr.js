/**
 * Florida DBPR Health Inspection Adapter
 * Note: Florida DBPR does not offer a public REST API for restaurant inspections.
 * They only offer manual CSV downloads which block automated scripts.
 * This adapter generates realistic mock data based on the requested restaurant to demonstrate the UI.
 */

const getFullRecord = async (businessName, address) => {
    // Safety check for businessName
    if (!businessName) return { status: 'Not Found' };
    
    // Clean name for display
    const cleanName = businessName.split(',')[0].trim();
    
    // Generate deterministic but "random" looking data based on the restaurant name's length
    const nameLength = cleanName.length;
    
    // Determine status based on name length to give variety
    let status = 'Pass';
    let displayStatus = 'Satisfactory';
    let currentViolations = 0;
    
    if (nameLength % 3 === 0) {
        status = 'Warning';
        displayStatus = 'Warning Issued';
        currentViolations = 3;
    } else if (nameLength % 7 === 0) {
        status = 'Fail';
        displayStatus = 'Temporarily Closed';
        currentViolations = 8;
    }

    // Generate dates based on current date
    const today = new Date();
    const lastInspDate = new Date(today);
    lastInspDate.setDate(today.getDate() - (nameLength * 5)); // Random days ago
    
    const prevInsp1 = new Date(lastInspDate);
    prevInsp1.setMonth(prevInsp1.getMonth() - 6);
    
    const prevInsp2 = new Date(prevInsp1);
    prevInsp2.setMonth(prevInsp2.getMonth() - 5);

    // Mock history
    const history = [
        {
            date: lastInspDate.toISOString().split('T')[0],
            type: 'Routine - Food',
            status: displayStatus,
            violations: currentViolations
        },
        {
            date: prevInsp1.toISOString().split('T')[0],
            type: 'Routine - Food',
            status: 'Satisfactory',
            violations: 1
        },
        {
            date: prevInsp2.toISOString().split('T')[0],
            type: 'Complaint Investigation',
            status: 'Satisfactory',
            violations: 0
        }
    ];

    return {
        status: 'Found',
        current: {
            name: cleanName,
            address: address,
            status: status, // Pass, Warning, Fail
            lastDate: lastInspDate.toISOString().split('T')[0]
        },
        history: history
    };
};

module.exports = { getFullRecord };
