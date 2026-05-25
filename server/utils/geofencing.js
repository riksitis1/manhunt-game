/**
 * Point-in-Polygon (PIP) algorithm to determine if a coordinate is inside a boundary.
 * @param {Array} point - [lat, lng]
 * @param {Array} polygon - Array of [lat, lng] points
 * @returns {boolean}
 */
function isPointInPolygon(point, polygon) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];

        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

module.exports = { isPointInPolygon };
